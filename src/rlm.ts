import { JsEnvironment } from "./environment.js";
import type { RlmEvent, RlmEventSink } from "./events.js";
import { buildModelTable, buildSystemPrompt } from "./system-prompt.js";

export interface CallLLMResponse {
	reasoning: string;
	code: string | null;
	toolUseId?: string;
	/** Opaque; round-tripped to the API without inspection. */
	reasoningDetails?: Array<Record<string, unknown>> | null;
}

export type CallLLM = (messages: Array<{ role: string; content: string; meta?: Record<string, unknown> }>, systemPrompt: string, options?: CallLLMOptions) => Promise<CallLLMResponse>;

export interface CallLLMOptions {
	/** Override reasoning effort level for this call. */
	reasoningEffort?: string;
}

export interface ModelEntry {
	callLLM: CallLLM;
	tags?: string[];
	description?: string;
}

export interface RlmOptions {
	callLLM: CallLLM;
	maxIterations?: number;
	maxDepth?: number;
	pluginBodies?: string;
	models?: Record<string, ModelEntry>;
	sandboxGlobals?: Record<string, unknown>;
	/** Visible at all depths (root, children, flat). Document sandboxGlobals here. */
	globalDocs?: string;
	/** Keyed by name; looked up when a parent calls `rlm(query, ctx, { app: "name" })`. */
	childApps?: Record<string, string>;
	reasoningEffort?: string;
	observer?: RlmEventSink;
}

export interface RlmResult {
	answer: string;
	iterations: number;
}

export class RlmError extends Error {
	readonly iterations: number;

	constructor(message: string, iterations: number) {
		super(message);
		this.name = "RlmError";
		this.iterations = iterations;
	}
}

/** Thrown when the iteration limit is reached. */
export class RlmMaxIterationsError extends RlmError {
	constructor(maxIterations: number) {
		super(`RLM reached max iterations (${maxIterations}) without returning an answer`, maxIterations);
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
		reasoningEffort: options.reasoningEffort,
	};

	const emit: ((event: RlmEvent) => void) | undefined = options.observer
		? (event) => options.observer!.emit(event)
		: undefined;
	const runId = globalThis.crypto.randomUUID();

	const modelTable = buildModelTable(opts.models);

	const env = new JsEnvironment();

	if (opts.sandboxGlobals) {
		for (const [name, value] of Object.entries(opts.sandboxGlobals)) {
			env.set(name, value);
		}
	}

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
		reasoningEffortOverride?: string,
	): Promise<RlmResult> {
		const callLLM = callLLMOverride ?? opts.callLLM;
		const effectiveReasoningEffort = reasoningEffortOverride ?? opts.reasoningEffort;

		const effectiveMaxIterations = maxIterationsOverride !== undefined
			? Math.min(maxIterationsOverride, opts.maxIterations)
			: opts.maxIterations;

		const canDelegate = depth < opts.maxDepth;

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

		emit?.({
			type: "invocation:start",
			runId,
			timestamp: performance.now(),
			invocationId,
			parentId,
			depth,
			query,
			systemPrompt: effectiveSystemPrompt,
		});

		if (!contextStore.locals.has(invocationId)) {
			contextStore.locals.set(invocationId, {});
		}

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

		const messages: Array<{ role: string; content: string; meta?: Record<string, unknown> }> = [{ role: "user", content: query }];

		let invocationResult: RlmResult | undefined;
		let invocationError: unknown;
		try {
		for (let iteration = 0; iteration < effectiveMaxIterations; iteration++) {
			emit?.({
				type: "iteration:start",
				runId,
				timestamp: performance.now(),
				invocationId,
				parentId,
				depth,
				iteration,
				budgetRemaining: effectiveMaxIterations - iteration,
			});

			let iterationReturned = false;
			let iterationCode: string | null = null;
			let iterationOutput = "";
			let iterationError: string | null = null;

			try {

			const llmStart = performance.now();
			emit?.({
				type: "llm:request",
				runId,
				timestamp: llmStart,
				invocationId,
				parentId,
				depth,
				iteration,
				messageCount: messages.length,
				systemPromptLength: effectiveSystemPrompt.length,
			});

			let response: CallLLMResponse;
			try {
				response = await callLLM(messages, effectiveSystemPrompt, effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : undefined);
			} catch (err) {
				const llmError = err instanceof Error ? err.message : String(err);
				emit?.({
					type: "llm:error",
					runId,
					timestamp: performance.now(),
					invocationId,
					parentId,
					depth,
					iteration,
					error: llmError,
					duration: performance.now() - llmStart,
				});
				iterationError = llmError;
				throw new RlmError(llmError, iteration);
			}

			emit?.({
				type: "llm:response",
				runId,
				timestamp: performance.now(),
				invocationId,
				parentId,
				depth,
				iteration,
				duration: performance.now() - llmStart,
				reasoning: response.reasoning,
				code: response.code,
				hasToolUse: !!response.toolUseId,
				usage: (response as unknown as Record<string, unknown>).usage as import("./events.js").TokenUsage | undefined,
			});

			const reasoning = response.reasoning;
			const codeBlocks = response.code !== null ? [response.code] : [];
			const toolUseId = response.toolUseId ?? null;
			const reasoningDetails = response.reasoningDetails ?? null;

			iterationCode = response.code;

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
						emit?.({
							type: "delegation:unawaited",
							runId,
							timestamp: performance.now(),
							invocationId,
							parentId,
							depth,
							count,
						});
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
					iterationReturned = true;
					iterationOutput = combinedOutput;
					invocationResult = { answer, iterations: iteration + 1 };
					return invocationResult;
				}
			}

			iterationOutput = combinedOutput;
			iterationError = combinedError;

			// Build iteration context for the next turn (if there will be one)
			const nextIterContext = (effectiveMaxIterations > 1 && iteration + 1 < effectiveMaxIterations)
				? buildIterationContext(iteration + 1) + "\n"
				: "";

			let outputMsg = combinedOutput || "(no output)";
			if (combinedError) outputMsg += `\nERROR: ${combinedError}`;

			if (codeBlocks.length > 0 && toolUseId) {
				// Assistant message with tool call
				const code = codeBlocks[0];
				messages.push({
					role: "assistant",
					content: `__TOOL_CALL__\n${toolUseId}\n${reasoning}\n__CODE__\n${code}`,
					...(reasoningDetails ? { meta: { reasoningDetails } } : {}),
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

			} finally {
				emit?.({
					type: "iteration:end",
					runId,
					timestamp: performance.now(),
					invocationId,
					parentId,
					depth,
					iteration,
					code: iterationCode,
					output: iterationOutput,
					error: iterationError,
					returned: iterationReturned,
				});

				if (emit) {
					emit({
						type: "sandbox:snapshot",
						runId,
						timestamp: performance.now(),
						invocationId,
						parentId,
						depth,
						iteration,
						state: env.snapshot(snapshotExcludeKeys),
					});
				}
			}
		}

		const maxIterErr = new RlmMaxIterationsError(effectiveMaxIterations);
		invocationError = maxIterErr;
		throw maxIterErr;

		} catch (err) {
			invocationError = err;
			throw err;
		} finally {
			emit?.({
				type: "invocation:end",
				runId,
				timestamp: performance.now(),
				invocationId,
				parentId,
				depth,
				answer: invocationResult?.answer ?? null,
				error: invocationError instanceof Error ? invocationError.message : invocationError ? String(invocationError) : null,
				iterations: invocationResult?.iterations ?? (invocationError instanceof RlmError ? invocationError.iterations : 0),
			});
		}
	}

	env.set("rlm", (q: string, c?: string, rlmOpts?: { systemPrompt?: string; model?: string; maxIterations?: number; app?: string; reasoning?: string }): Promise<string> => {
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

		const childIndex = childCounter++;
		const childDepthLabel = `d${savedDepth + 1}-c${childIndex}`;
		const childInvocationId = callerInvocationId === "root"
			? childDepthLabel
			: `${callerInvocationId}.${childDepthLabel}`;

		emit?.({
			type: "delegation:spawn",
			runId,
			timestamp: performance.now(),
			invocationId: callerInvocationId,
			parentId: (env.get("__rlm") as DelegationContext | undefined)?.parentId ?? null,
			depth: savedDepth,
			childId: childInvocationId,
			query: q,
			modelAlias: rlmOpts?.model,
			maxIterations: rlmOpts?.maxIterations,
			appName: rlmOpts?.app,
		});

		const promise = (async () => {
			try {
				const result = await rlmInternal(q, c, savedDepth + 1, childLineage, childInvocationId, callerInvocationId, resolvedSystemPrompt, modelCallLLM, rlmOpts?.maxIterations, rlmOpts?.reasoning);
				emit?.({
					type: "delegation:return",
					runId,
					timestamp: performance.now(),
					invocationId: callerInvocationId,
					parentId: (env.get("__rlm") as DelegationContext | undefined)?.parentId ?? null,
					depth: savedDepth,
					childId: childInvocationId,
					answer: result.answer,
					iterations: result.iterations,
				});
				return result.answer;
			} catch (err) {
				emit?.({
					type: "delegation:error",
					runId,
					timestamp: performance.now(),
					invocationId: callerInvocationId,
					parentId: (env.get("__rlm") as DelegationContext | undefined)?.parentId ?? null,
					depth: savedDepth,
					childId: childInvocationId,
					error: err instanceof Error ? err.message : String(err),
					iterations: err instanceof RlmError ? err.iterations : 0,
				});
				throw err;
			} finally {
				activeDepth = savedDepth;
			}
		})();

		pendingRlmCalls.add(promise);
		promise.finally(() => pendingRlmCalls.delete(promise));

		return promise;
	});

	emit?.({
		type: "run:start",
		runId,
		timestamp: performance.now(),
		invocationId: "root",
		parentId: null,
		depth: 0,
		query,
		maxIterations: opts.maxIterations,
		maxDepth: opts.maxDepth,
	});

	let runResult: RlmResult | undefined;
	let runError: unknown;
	try {
		runResult = await rlmInternal(query, context, 0, [query], "root", null);
		return runResult;
	} catch (err) {
		runError = err;
		throw err;
	} finally {
		emit?.({
			type: "run:end",
			runId,
			timestamp: performance.now(),
			invocationId: "root",
			parentId: null,
			depth: 0,
			answer: runResult?.answer ?? null,
			error: runError instanceof Error ? runError.message : runError ? String(runError) : null,
			iterations: runResult?.iterations ?? (runError instanceof RlmError ? runError.iterations : 0),
		});
	}
}
