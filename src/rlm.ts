import { JsEnvironment } from "./environment.js";
import { buildChildRepl, buildModelTable, formatGlobalDocs, SYSTEM_PROMPT } from "./system-prompt.js";

export type CallLLM = (messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<string>;

export interface ModelEntry {
	callLLM: CallLLM;
	tags?: string[];
	description?: string;
}

export interface RlmOptions {
	callLLM: CallLLM;
	maxIterations?: number;
	maxDepth?: number;
	/** Concatenated plugin bodies to append to the root agent's system prompt. */
	pluginBodies?: string;
	/** Named model aliases available for child delegation. */
	models?: Record<string, ModelEntry>;
	/**
	 * Maximum code blocks to execute per LLM response.
	 * When set to 1, only the first code block is executed and extra blocks
	 * are discarded with a warning appended to the output.
	 * Default: undefined (no limit).
	 */
	maxBlocksPerIteration?: number;
	/** Extra globals to inject into the REPL sandbox. */
	sandboxGlobals?: Record<string, unknown>;
	/**
	 * Documentation for sandbox globals, appended to the Environment section
	 * of every agent's system prompt at every depth (root, children, flat).
	 * Use this to document APIs injected via sandboxGlobals so that all agents
	 * — including children spawned via rlm() — know they exist.
	 */
	globalDocs?: string;
	/**
	 * Pre-loaded app plugin bodies keyed by name, available for child agents.
	 * When a parent calls `rlm(query, context, { app: "name" })`, the named
	 * app body is looked up here and used as the child's system prompt.
	 */
	childApps?: Record<string, string>;
}

export interface RlmResult {
	answer: string;
	iterations: number;
	trace: TraceEntry[];
}

export interface TraceEntry {
	reasoning: string;
	code: string[];
	output: string;
	error: string | null;
}

/** Error with partial trace for diagnostics. */
export class RlmError extends Error {
	readonly trace: TraceEntry[];
	readonly iterations: number;

	constructor(message: string, trace: TraceEntry[], iterations: number) {
		super(message);
		this.name = "RlmError";
		this.trace = trace;
		this.iterations = iterations;
	}
}

/** Thrown when the iteration limit is reached. */
export class RlmMaxIterationsError extends RlmError {
	constructor(maxIterations: number, trace: TraceEntry[]) {
		super(`RLM reached max iterations (${maxIterations}) without returning an answer`, trace, maxIterations);
		this.name = "RlmMaxIterationsError";
	}
}

/** Read-only metadata injected into the sandbox as `__rlm`. */
export interface DelegationContext {
	depth: number;
	maxDepth: number;
	iteration: number;
	maxIterations: number;
	lineage: readonly string[];
	invocationId: string;
	parentId: string | null;
}

interface LocalStore {
	[key: string]: unknown;
}

interface ContextStore {
	shared: { data: unknown };
	locals: Map<string, LocalStore>;
}


function buildOrientationBlock(
	invocationId: string,
	parentId: string | null,
	depth: number,
	maxDepth: number,
	effectiveMaxIterations: number,
	lineage: readonly string[],
): string {
	const rootTask = lineage[0].length > 200 ? lineage[0].substring(0, 200) + "..." : lineage[0];

	const roleDesc = depth === 0
		? "You are the root orchestrator."
		: `Parent: "${parentId}". Root task: "${rootTask}"`;
	const delegationDesc = depth < maxDepth
		? `You can delegate to child RLMs at depth ${depth + 1} (max depth: ${maxDepth}).`
		: "You are at the maximum delegation depth and cannot spawn child agents.";

	return (
		`\n\n## Your Position\n\n` +
		`Agent "${invocationId}" — depth ${depth} of ${maxDepth} (0-indexed).\n` +
		`${roleDesc}\n` +
		`Iteration budget: ${effectiveMaxIterations} iterations (use them wisely).\n` +
		`${delegationDesc}`
	);
}

function extractCodeBlocks(text: string): string[] {
	const blocks: string[] = [];
	const regex = /```(?:javascript|js|repl)\n([\s\S]*?)```/g;
	for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
		blocks.push(match[1].trimEnd());
	}
	return blocks;
}

export async function rlm(query: string, context: string | undefined, options: RlmOptions): Promise<RlmResult> {
	const opts = {
		callLLM: options.callLLM,
		maxIterations: options.maxIterations ?? 15,
		maxDepth: options.maxDepth ?? 3,
		pluginBodies: options.pluginBodies,
		models: options.models,
		maxBlocksPerIteration: options.maxBlocksPerIteration,
		sandboxGlobals: options.sandboxGlobals,
		globalDocs: options.globalDocs,
		childApps: options.childApps,
	};

	const modelTable = buildModelTable(opts.models);
	const globalDocsSection = formatGlobalDocs(opts.globalDocs);
	const basePrompt = SYSTEM_PROMPT + globalDocsSection + modelTable;
	const rootSystemPrompt = opts.pluginBodies ? `${basePrompt}\n\n---\n\n${opts.pluginBodies}` : basePrompt;

	const env = new JsEnvironment();

	if (opts.sandboxGlobals) {
		for (const [name, value] of Object.entries(opts.sandboxGlobals)) {
			env.set(name, value);
		}
	}

	let activeDepth = 0;
	const pendingRlmCalls = new Set<Promise<string>>();

	const contextStore: ContextStore = {
		shared: { data: undefined },
		locals: new Map(),
	};

	const invocationStack: string[] = [];

	let childCounter = 0;

	// Create a Proxy for __ctx.local that routes based on active invocation ID
	const localProxy = new Proxy({} as Record<string, unknown>, {
		get(_target, prop: string) {
			const activeId = invocationStack[invocationStack.length - 1];
			if (!activeId) return undefined;
			const store = contextStore.locals.get(activeId);
			if (!store) return undefined;
			return store[prop];
		},
		set(_target, prop: string, value: unknown) {
			const activeId = invocationStack[invocationStack.length - 1];
			if (!activeId) return false;
			let store = contextStore.locals.get(activeId);
			if (!store) {
				store = {};
				contextStore.locals.set(activeId, store);
			}
			store[prop] = value;
			return true;
		},
		has(_target, prop: string) {
			const activeId = invocationStack[invocationStack.length - 1];
			if (!activeId) return false;
			const store = contextStore.locals.get(activeId);
			return store ? prop in store : false;
		},
		ownKeys() {
			const activeId = invocationStack[invocationStack.length - 1];
			if (!activeId) return [];
			const store = contextStore.locals.get(activeId);
			return store ? Object.keys(store) : [];
		},
		getOwnPropertyDescriptor(_target, prop: string) {
			const activeId = invocationStack[invocationStack.length - 1];
			if (!activeId) return undefined;
			const store = contextStore.locals.get(activeId);
			if (!store || !(prop in store)) return undefined;
			return { configurable: true, enumerable: true, writable: true, value: store[prop] };
		},
	});

	const readLocal = (id: string): Readonly<Record<string, unknown>> => {
		const store = contextStore.locals.get(id);
		if (!store) return Object.freeze({});
		return Object.freeze({ ...store });
	};

	if (context !== undefined) {
		contextStore.shared = Object.freeze({ data: context });
	}

	env.set("__ctx", {
		shared: contextStore.shared,
		local: localProxy,
		readLocal,
	});

	async function rlmInternal(
		query: string,
		context: string | undefined,
		depth: number,
		lineage: readonly string[],
		invocationId: string,
		parentId: string | null,
		customSystemPrompt?: string,
		callLLMOverride?: CallLLM,
		maxIterationsOverride?: number,
	): Promise<RlmResult> {
		const callLLM = callLLMOverride ?? opts.callLLM;

		// Children inherit parent's budget by default; parent can override via maxIterations option
		const effectiveMaxIterations = maxIterationsOverride !== undefined
			? Math.min(maxIterationsOverride, opts.maxIterations)
			: opts.maxIterations;

		const canDelegate = depth < opts.maxDepth;

		// Build orientation block and effective system prompt
		const orientationBlock = buildOrientationBlock(
			invocationId, parentId, depth, opts.maxDepth,
			effectiveMaxIterations, lineage,
		);
		let effectiveSystemPrompt: string;
		if (customSystemPrompt) {
			// Parent provided custom instructions — use child base template
			const childBase = buildChildRepl(canDelegate);
			effectiveSystemPrompt = customSystemPrompt + childBase + globalDocsSection + modelTable + orientationBlock;
		} else if (depth === 0) {
			// Root agent gets the full system prompt with plugins
			effectiveSystemPrompt = rootSystemPrompt + orientationBlock;
		} else {
			// Non-root child without custom prompt — use base system prompt, no plugins
			effectiveSystemPrompt = SYSTEM_PROMPT + globalDocsSection + modelTable + orientationBlock;
		}

		// Initialize local store for this invocation
		if (!contextStore.locals.has(invocationId)) {
			contextStore.locals.set(invocationId, {});
		}

		// Set context in the local store for this invocation
		if (context !== undefined) {
			contextStore.locals.get(invocationId)!.context = context;
		}

		invocationStack.push(invocationId);
		try {
			await env.exec(
				`Object.defineProperty(globalThis, 'context', {\n` +
				`  get() {\n` +
				`    const local = __ctx.local.context;\n` +
				`    if (local !== undefined) return local;\n` +
				`    return __ctx.shared.data;\n` +
				`  },\n` +
				`  set(v) { __ctx.local.context = v; },\n` +
				`  configurable: true,\n` +
				`  enumerable: true,\n` +
				`})`,
			);
		} finally {
			invocationStack.pop();
		}

		const messages: Array<{ role: string; content: string }> = [{ role: "user", content: query }];
		const trace: TraceEntry[] = [];

		for (let iteration = 0; iteration < effectiveMaxIterations; iteration++) {
			let response: string;
			try {
				response = await callLLM(messages, effectiveSystemPrompt);
			} catch (err) {
				throw new RlmError(
					err instanceof Error ? err.message : String(err),
					trace,
					iteration,
				);
			}
			let codeBlocks = extractCodeBlocks(response);

			// Auto-fix malformed fence: "javascript\n" without opening ```
			if (codeBlocks.length === 0 && /(?:^|\n)\s*javascript\s*\n/.test(response)) {
				const fixed = response.replace(/(?:^|\n)(\s*)javascript(\s*\n)/g, "\n$1```javascript$2");
				codeBlocks = extractCodeBlocks(fixed);
				if (codeBlocks.length > 0) {
					// Use the fixed version for the rest of this iteration
					response = fixed;
				}
			}

			// Enforce max blocks per iteration (discard extra blocks with a warning)
			let blocksDiscardedWarning: string | undefined;
			if (opts.maxBlocksPerIteration && codeBlocks.length > opts.maxBlocksPerIteration) {
				const discarded = codeBlocks.length - opts.maxBlocksPerIteration;
				codeBlocks = codeBlocks.slice(0, opts.maxBlocksPerIteration);
				blocksDiscardedWarning =
					`[WARNING] ${discarded} extra code block(s) were discarded. ` +
					`Only the first block was executed. Write ONE code block per response ` +
					`and wait for real output before writing the next step.`;
			}

			let combinedOutput = "";
			let combinedError: string | null = null;

			for (const block of codeBlocks) {
				activeDepth = depth;

				// Inject __rlm delegation context before each exec
				env.set(
					"__rlm",
					Object.freeze({
						depth,
						maxDepth: opts.maxDepth,
						iteration,
						maxIterations: effectiveMaxIterations,
						lineage: Object.freeze([...lineage]),
						invocationId,
						parentId,
					} satisfies DelegationContext),
				);

				// Push invocation onto stack before exec, pop after
				invocationStack.push(invocationId);
				let execResult: { output: string; error: string | null; returnValue?: unknown };
				try {
					execResult = await env.exec(block);
				} finally {
					invocationStack.pop();
				}

				const { output, error, returnValue } = execResult;

				if (output) combinedOutput += (combinedOutput ? "\n" : "") + output;
				if (error) combinedError = error;

				// Check for unawaited rlm() calls
				if (pendingRlmCalls.size > 0) {
					await new Promise((r) => setTimeout(r, 0));
					if (pendingRlmCalls.size > 0) {
						const count = pendingRlmCalls.size;
						const warning =
							`[ERROR] ${count} rlm() call(s) were NOT awaited. Their results are LOST and the API calls were wasted. ` +
							`You MUST write: const result = await rlm("query", context). ` +
							`Never call rlm() without await.`;
						combinedOutput += (combinedOutput ? "\n" : "") + warning;
						pendingRlmCalls.clear();
					}
				}

				if (returnValue !== undefined) {
					if (iteration === 0) {
						// Force verification: reject first-iteration returns
						combinedOutput +=
							(combinedOutput ? "\n" : "") +
							`[early return intercepted] You returned: ${String(returnValue)}\nVerify this is correct by examining the data before returning.`;
						break;
					}
					const answer = typeof returnValue === "object" ? JSON.stringify(returnValue) : String(returnValue);
					trace.push({ reasoning: response, code: codeBlocks, output: combinedOutput, error: combinedError });
					return { answer, iterations: iteration + 1, trace };
				}
			}

			// Append block-discard warning so the model knows extra blocks were dropped
			if (blocksDiscardedWarning) {
				combinedOutput += (combinedOutput ? "\n" : "") + blocksDiscardedWarning;
			}

			trace.push({ reasoning: response, code: codeBlocks, output: combinedOutput, error: combinedError });

			if (codeBlocks.length > 0) {
				let outputMsg = combinedOutput || "(no output)";
				if (combinedError) outputMsg += `\nERROR: ${combinedError}`;
				messages.push({ role: "assistant", content: response });
				messages.push({ role: "user", content: outputMsg });
			} else if (!response.trim()) {
				// Empty response (e.g., MALFORMED_FUNCTION_CALL from Gemini)
				messages.push({ role: "assistant", content: response });
				messages.push({
					role: "user",
					content:
						"[ERROR] Your response was empty. You must respond with a ```javascript code block " +
						"containing code to execute. Write code to explore the data, compute a result, " +
						"and eventually return(answer).",
				});
			} else {
				// Text-only response (prose without code blocks)
				messages.push({ role: "assistant", content: response });

				// Detect malformed fence: "javascript\n" without opening ```
				const hasMalformedFence = /(?:^|\n)\s*javascript\s*\n/.test(response);
				const nudge = hasMalformedFence
					? "[ERROR] Your code block is missing the opening fence. Write ```javascript " +
						"(triple backticks followed by 'javascript'), not just 'javascript' on a line by itself. " +
						"Fix the opening fence and retry."
					: "[WARNING] No code block found. Your response must include a ```javascript fenced " +
						"code block to make progress. Plain text alone does nothing — write code to execute.";
				messages.push({ role: "user", content: nudge });
			}
		}

		throw new RlmMaxIterationsError(effectiveMaxIterations, trace);
	}

	env.set("rlm", (q: string, c?: string, rlmOpts?: { systemPrompt?: string; model?: string; maxIterations?: number; app?: string }): Promise<string> => {
		// Reject delegation at max depth
		if (activeDepth >= opts.maxDepth) {
			return Promise.reject(
				new Error(`Cannot delegate: you are at maximum depth (${opts.maxDepth}).`),
			);
		}

		// Resolve app plugin if requested
		let resolvedSystemPrompt: string | undefined = rlmOpts?.systemPrompt;
		if (rlmOpts?.app) {
			const appBody = opts.childApps?.[rlmOpts.app];
			if (!appBody) {
				const available = Object.keys(opts.childApps ?? {});
				return Promise.reject(
					new Error(
						`Unknown app "${rlmOpts.app}". Available: ${available.length > 0 ? available.join(", ") : "none configured"}`,
					),
				);
			}
			// App body comes first; if systemPrompt is also provided, concatenate
			resolvedSystemPrompt = resolvedSystemPrompt
				? appBody + "\n\n" + resolvedSystemPrompt
				: appBody;
		}

		// Resolve model override if requested
		let modelCallLLM: CallLLM | undefined;
		if (rlmOpts?.model) {
			const entry = opts.models?.[rlmOpts.model];
			if (!entry) {
				return Promise.reject(
					new Error(
						`Unknown model alias "${rlmOpts.model}". Available: ${Object.keys(opts.models ?? {}).join(", ") || "none configured"}`,
					),
				);
			}
			modelCallLLM = entry.callLLM;
		}

		const savedDepth = activeDepth;
		const childLineage = [...((env.get("__rlm") as DelegationContext | undefined)?.lineage ?? [q]), q];
		const callerInvocationId = (env.get("__rlm") as DelegationContext | undefined)?.invocationId ?? "root";

		// Generate child invocation ID: "d{depth+1}-c{counter}"
		// For nested children, prefix with parent's ID path
		const childIndex = childCounter++;
		const childDepthLabel = `d${savedDepth + 1}-c${childIndex}`;
		const childInvocationId = callerInvocationId === "root"
			? childDepthLabel
			: `${callerInvocationId}.${childDepthLabel}`;

		const promise = (async () => {
			try {
				const result = await rlmInternal(q, c, savedDepth + 1, childLineage, childInvocationId, callerInvocationId, resolvedSystemPrompt, modelCallLLM, rlmOpts?.maxIterations);
				return result.answer;
			} finally {
				activeDepth = savedDepth;
			}
		})();

		pendingRlmCalls.add(promise);
		promise.finally(() => pendingRlmCalls.delete(promise));

		return promise;
	});

	return rlmInternal(query, context, 0, [query], "root", null);
}
