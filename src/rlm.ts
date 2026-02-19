import { JsEnvironment } from "./environment.js";
import { buildModelTable, buildSystemPrompt } from "./system-prompt.js";

export interface CallLLMResponse {
	reasoning: string;
	code: string | null;
	/** Tool use ID from the API response, used to match tool results in conversation history. */
	toolUseId?: string;
}

export type CallLLM = (messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<CallLLMResponse>;

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
	/** When true, child rlm() traces are captured in parent trace entries. Default: false. */
	traceChildren?: boolean;
	/** When true, sandbox variable snapshots are captured after each iteration. Default: false. */
	traceSnapshots?: boolean;
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
	children?: ChildTrace[];
	envSnapshot?: Record<string, unknown>;
}

export interface ChildTrace {
	query: string;
	depth: number;
	answer: string | null;
	iterations: number;
	trace: TraceEntry[];
	error?: string;
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


/** Keys to exclude from environment snapshots (sandbox infrastructure, not user variables). */
const SNAPSHOT_EXCLUDE_KEYS = new Set([
	'console', 'require', 'setTimeout', 'setInterval',
	'clearTimeout', 'clearInterval', 'URL', 'URLSearchParams',
	'TextEncoder', 'TextDecoder',
]);

export async function rlm(query: string, context: string | undefined, options: RlmOptions): Promise<RlmResult> {
	const opts = {
		callLLM: options.callLLM,
		maxIterations: options.maxIterations ?? 15,
		maxDepth: options.maxDepth ?? 3,
		pluginBodies: options.pluginBodies,
		models: options.models,
		sandboxGlobals: options.sandboxGlobals,
		globalDocs: options.globalDocs,
		childApps: options.childApps,
		traceChildren: options.traceChildren ?? false,
		traceSnapshots: options.traceSnapshots ?? false,
	};

	const modelTable = buildModelTable(opts.models);

	const env = new JsEnvironment();

	if (opts.sandboxGlobals) {
		for (const [name, value] of Object.entries(opts.sandboxGlobals)) {
			env.set(name, value);
		}
	}

	const childTraceSlot: { current: ChildTrace[] | null } = { current: null };

	const snapshotExcludeKeys = new Set(SNAPSHOT_EXCLUDE_KEYS);
	snapshotExcludeKeys.add('rlm');
	snapshotExcludeKeys.add('__rlm');
	snapshotExcludeKeys.add('__ctx');
	snapshotExcludeKeys.add('context');
	if (opts.sandboxGlobals) {
		for (const key of Object.keys(opts.sandboxGlobals)) {
			snapshotExcludeKeys.add(key);
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

		// Build unified system prompt
		let programContent: string | undefined;
		if (customSystemPrompt) {
			programContent = customSystemPrompt;
		} else if (depth === 0 && opts.pluginBodies) {
			programContent = opts.pluginBodies;
		}

		const effectiveSystemPrompt = buildSystemPrompt({
			canDelegate,
			invocationId,
			parentId,
			depth,
			maxDepth: opts.maxDepth,
			maxIterations: effectiveMaxIterations,
			lineage,
			programContent,
			globalDocs: opts.globalDocs,
			modelTable,
		});

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

		/** Build an iteration context line for the next LLM turn. */
		function buildIterationContext(nextIteration: number): string {
			const remaining = effectiveMaxIterations - nextIteration;
			if (remaining <= 1) {
				return (
					`[ITERATION ${nextIteration + 1}/${effectiveMaxIterations} — FINAL ITERATION] ` +
					`You MUST return a result NOW. Call return(answer) with your best answer. ` +
					`Do not start new work. Wrap up and return immediately.`
				);
			}
			if (remaining === 2) {
				return (
					`[ITERATION ${nextIteration + 1}/${effectiveMaxIterations} — SECOND TO LAST] ` +
					`Next iteration is your last. Finalize your work and prepare to return a result.`
				);
			}
			return (
				`[ITERATION ${nextIteration + 1}/${effectiveMaxIterations}] ` +
				`${remaining} iterations remaining.`
			);
		}

		const messages: Array<{ role: string; content: string }> = [{ role: "user", content: query }];
		const trace: TraceEntry[] = [];

		for (let iteration = 0; iteration < effectiveMaxIterations; iteration++) {
			if (opts.traceChildren) {
				childTraceSlot.current = [];
			}

			let response: CallLLMResponse;
			try {
				response = await callLLM(messages, effectiveSystemPrompt);
			} catch (err) {
				throw new RlmError(
					err instanceof Error ? err.message : String(err),
					trace,
					iteration,
				);
			}

			const reasoning = response.reasoning;
			const codeBlocks = response.code !== null ? [response.code] : [];
			const toolUseId = response.toolUseId ?? null;

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
					const entry: TraceEntry = { reasoning, code: codeBlocks, output: combinedOutput, error: combinedError };
					if (opts.traceChildren && childTraceSlot.current && childTraceSlot.current.length > 0) {
						entry.children = childTraceSlot.current;
					}
					if (opts.traceSnapshots) {
						entry.envSnapshot = env.snapshot(snapshotExcludeKeys);
					}
					trace.push(entry);
					return { answer, iterations: iteration + 1, trace };
				}
			}

			const entry: TraceEntry = { reasoning, code: codeBlocks, output: combinedOutput, error: combinedError };
			if (opts.traceChildren && childTraceSlot.current && childTraceSlot.current.length > 0) {
				entry.children = childTraceSlot.current;
			}
			if (opts.traceSnapshots) {
				entry.envSnapshot = env.snapshot(snapshotExcludeKeys);
			}
			trace.push(entry);

			// Build iteration context for the next turn (if there will be one)
			const nextIterContext = (effectiveMaxIterations > 1 && iteration + 1 < effectiveMaxIterations)
				? buildIterationContext(iteration + 1) + "\n"
				: "";

			// Use __TOOL_CALL__ / __TOOL_RESULT__ markers so the driver can
			// reconstruct the proper API message format
			let outputMsg = combinedOutput || "(no output)";
			if (combinedError) outputMsg += `\nERROR: ${combinedError}`;

			if (codeBlocks.length > 0 && toolUseId) {
				// Assistant message with tool call
				const code = codeBlocks[0];
				messages.push({
					role: "assistant",
					content: `__TOOL_CALL__\n${toolUseId}\n${reasoning}\n__CODE__\n${code}`,
				});
				// Tool result
				messages.push({
					role: "user",
					content: `__TOOL_RESULT__\n${toolUseId}\n${nextIterContext}${outputMsg}`,
				});
			} else {
				// No code in response (model sent text-only)
				messages.push({ role: "assistant", content: reasoning || "" });
				messages.push({
					role: "user",
					content: nextIterContext +
						"[WARNING] No code was executed. Use the execute_code tool to run JavaScript and make progress.",
				});
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
			// Save and isolate the parent's childTraceSlot so the child's
			// rlmInternal (which resets childTraceSlot.current per-iteration)
			// doesn't clobber the parent's accumulator — preventing circular refs.
			const parentTraceSlot = childTraceSlot.current;
			childTraceSlot.current = null;
			try {
				const result = await rlmInternal(q, c, savedDepth + 1, childLineage, childInvocationId, callerInvocationId, resolvedSystemPrompt, modelCallLLM, rlmOpts?.maxIterations);
				childTraceSlot.current = parentTraceSlot;
				if (opts.traceChildren && childTraceSlot.current) {
					childTraceSlot.current.push({
						query: q,
						depth: savedDepth + 1,
						answer: result.answer,
						iterations: result.iterations,
						trace: result.trace,
					});
				}
				return result.answer;
			} catch (err) {
				childTraceSlot.current = parentTraceSlot;
				if (opts.traceChildren && childTraceSlot.current && err instanceof RlmError) {
					childTraceSlot.current.push({
						query: q,
						depth: savedDepth + 1,
						answer: null,
						iterations: err.iterations,
						trace: err.trace,
						error: err.message,
					});
				}
				throw err;
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
