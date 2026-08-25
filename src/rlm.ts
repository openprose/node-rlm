import { JsEnvironment } from "./environment.js";
import type { PressEvent, PressEventSink } from "./events.js";
import { buildModelTable, buildSystemPrompt, renderContextStack } from "./system-prompt.js";

export interface CallLLMResponse {
	reasoning: string;
	code: string | null;
	toolUseId?: string;
	/** Opaque; round-tripped to the API without inspection. */
	reasoningDetails?: Array<Record<string, unknown>> | null;
	/** Token usage from the LLM API response. */
	usage?: import("./events.js").TokenUsage;
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

export interface PressOptions {
	callLLM: CallLLM;
	maxIterations?: number;
	maxDepth?: number;
	/** Replace the default system prompt entirely with this content. */
	systemPrompt?: string;
	models?: Record<string, ModelEntry>;
	sandboxGlobals?: Record<string, unknown>;
	/** Visible at all depths (root, children, flat). Document sandboxGlobals here. */
	globalDocs?: string;
	/** Keyed by name; looked up when a parent calls `press(query, ctx, { use: "name" })`. */
	childComponents?: Record<string, string>;
	reasoningEffort?: string;
	observer?: PressEventSink;
	/** Layout mode for context stack in child system prompts. Default: "mirror". */
	contextLayout?: ContextLayout;
}

export interface PressResult {
	answer: string;
	iterations: number;
}

export class PressError extends Error {
	readonly iterations: number;

	constructor(message: string, iterations: number) {
		super(message);
		this.name = "PressError";
		this.iterations = iterations;
	}
}

/** Thrown when the iteration limit is reached. */
export class PressMaxIterationsError extends PressError {
	constructor(maxIterations: number) {
		super(`Press reached max iterations (${maxIterations}) without returning an answer`, maxIterations);
		this.name = "PressMaxIterationsError";
	}
}

/** Read-only metadata injected into the sandbox as `__press`. (Name kept for internal compatibility.) */
export interface DelegationContext {
	depth: number;
	maxDepth: number;
	iteration: number;
	maxIterations: number;
	lineage: readonly string[];
	invocationId: string;
	parentId: string | null;
}

/** A single frame in the context stack. */
export interface ContextFrame {
	depth: number;
	data: Record<string, unknown> | undefined;
	label?: string;
}

export type ContextLayout = "mirror" | "cache-efficient";

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

export async function press(query: string, context: Record<string, unknown> | undefined, options: PressOptions): Promise<PressResult> {
	if (context !== undefined && typeof context === 'string') {
		throw new Error('press() context must be an object, got string. Use { data: yourString } instead.');
	}
	const opts = {
		callLLM: options.callLLM,
		maxIterations: options.maxIterations ?? 15,
		maxDepth: options.maxDepth ?? 3,
		models: options.models,
		sandboxGlobals: options.sandboxGlobals,
		globalDocs: options.globalDocs,
		childComponents: options.childComponents ?? {},
		reasoningEffort: options.reasoningEffort,
		contextLayout: options.contextLayout ?? "mirror" as ContextLayout,
	};

	const emit: ((event: PressEvent) => void) | undefined = options.observer
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
	snapshotExcludeKeys.add('press');
	snapshotExcludeKeys.add('__press');
	snapshotExcludeKeys.add('__ctxInternal');
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

	// Internal context routing proxy — NOT exposed to the sandbox as __ctx.
	// The sandbox only sees `context` (with __root and __stack getters).
	const ctxInternalProxy = new Proxy({} as Record<string, unknown>, {
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

	if (context !== undefined) {
		contextStore.shared = Object.freeze({ data: context });
	}

	// Internal-only: used by context getter to route per-invocation. Not model-facing.
	env.set("__ctxInternal", {
		shared: contextStore.shared,
		local: ctxInternalProxy,
		getStack() {
			const activeId = invocationStack[invocationStack.length - 1];
			if (!activeId) return [];
			const store = contextStore.locals.get(activeId);
			return store?.__contextStack ?? [];
		},
		getRootData() {
			return contextStore.shared.data;
		},
	});

	async function rlmInternal(
		query: string,
		context: Record<string, unknown> | undefined,
		depth: number,
		lineage: readonly string[],
		invocationId: string,
		parentId: string | null,
		customSystemPrompt?: string,
		callLLMOverride?: CallLLM,
		maxIterationsOverride?: number,
		reasoningEffortOverride?: string,
		ancestorFrames?: readonly ContextFrame[],
		contextLayoutOverride?: ContextLayout,
	): Promise<PressResult> {
		const callLLM = callLLMOverride ?? opts.callLLM;
		const effectiveReasoningEffort = reasoningEffortOverride ?? opts.reasoningEffort;

		const effectiveMaxIterations = maxIterationsOverride !== undefined
			? Math.min(maxIterationsOverride, opts.maxIterations)
			: opts.maxIterations;

		const canDelegate = depth < opts.maxDepth;
		const effectiveContextLayout = contextLayoutOverride ?? opts.contextLayout;

		// Build the context frame for this invocation
		const currentFrame: ContextFrame = {
			depth,
			data: context,
			label: query.length > 80 ? query.substring(0, 80) + "..." : query,
		};
		const allFrames: readonly ContextFrame[] = ancestorFrames
			? [...ancestorFrames, currentFrame]
			: [currentFrame];

		const componentKeys = Object.keys(opts.childComponents);
		const contextStackSection = allFrames.length > 1
			? renderContextStack(allFrames, effectiveContextLayout)
			: (context !== undefined
				? renderContextStack(allFrames, effectiveContextLayout)
				: undefined);

		// When a custom system prompt is provided, use it directly
		// (don't wrap it inside buildSystemPrompt's generic preamble).
		// The custom prompt is self-contained — it has its own preamble and structure.
		const effectiveSystemPrompt = customSystemPrompt
			? customSystemPrompt
			: buildSystemPrompt({
			canDelegate,
			invocationId,
			parentId,
			depth,
			maxDepth: opts.maxDepth,
			maxIterations: effectiveMaxIterations,
			lineage,
			globalDocs: opts.globalDocs,
			modelTable,
			...(componentKeys.length > 0 ? { availableComponents: componentKeys } : {}),
			contextStackContent: contextStackSection,
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

		// Store frozen context stack for this invocation
		const frozenStack = Object.freeze(allFrames.map(f => Object.freeze({
			depth: f.depth,
			data: typeof f.data === 'object' && f.data !== null ? Object.freeze({ ...f.data as Record<string, unknown> }) : f.data,
			label: f.label,
		})));
		contextStore.locals.get(invocationId)!.__contextStack = frozenStack;
		contextStore.locals.get(invocationId)!.__contextDepth = depth;

		invocationStack.push(invocationId);
		try {
			await env.exec(
				`Object.defineProperty(globalThis, 'context', {\n` +
				`  get() {\n` +
				`    let val;\n` +
				`    const local = __ctxInternal.local.context;\n` +
				`    if (local !== undefined) { val = local; }\n` +
				`    else { val = __ctxInternal.shared.data; }\n` +
				`    // Attach __root and __stack for object contexts\n` +
				`    if (val && typeof val === 'object' && !Object.isFrozen(val)) {\n` +
				`      try {\n` +
				`        if (!Object.prototype.hasOwnProperty.call(val, '__root')) {\n` +
				`          Object.defineProperty(val, '__root', { get() { return __ctxInternal.getRootData(); }, enumerable: false, configurable: true });\n` +
				`        }\n` +
				`        if (!Object.prototype.hasOwnProperty.call(val, '__stack')) {\n` +
				`          Object.defineProperty(val, '__stack', { get() { return __ctxInternal.getStack(); }, enumerable: false, configurable: true });\n` +
				`        }\n` +
				`      } catch(e) {}\n` +
				`    }\n` +
				`    return val;\n` +
				`  },\n` +
				`  set(v) { __ctxInternal.local.context = v; },\n` +
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

		let invocationResult: PressResult | undefined;
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
				const llmEnd = performance.now();
				emit?.({
					type: "llm:error",
					runId,
					timestamp: llmEnd,
					invocationId,
					parentId,
					depth,
					iteration,
					error: llmError,
					duration: llmEnd - llmStart,
				});
				iterationError = llmError;
				throw new PressError(llmError, iteration);
			}

			const llmEnd = performance.now();
			emit?.({
				type: "llm:response",
				runId,
				timestamp: llmEnd,
				invocationId,
				parentId,
				depth,
				iteration,
				duration: llmEnd - llmStart,
				reasoning: response.reasoning,
				code: response.code,
				hasToolUse: !!response.toolUseId,
				usage: response.usage,
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

				// Inject __press delegation context before each exec
				env.set(
					"__press",
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

				// Check for unawaited press() calls
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
							`[ERROR] ${count} press() call(s) were NOT awaited. Their results are LOST and the API calls were wasted. ` +
							`You MUST write: const result = await press("query", context). ` +
							`Never call press() without await.`;
						combinedOutput += (combinedOutput ? "\n" : "") + warning;
						pendingRlmCalls.clear();
					}
				}

				if (returnValue !== undefined) {
					if (iteration === 0 && depth === 0) {
						// Force verification: reject first-iteration returns (root only)
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

		const maxIterErr = new PressMaxIterationsError(effectiveMaxIterations);
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
				iterations: invocationResult?.iterations ?? (invocationError instanceof PressError ? invocationError.iterations : 0),
			});
		}
	}

	/** The sandbox delegate function, exposed as `press()`. */
	const pressFn = (q: string, c?: Record<string, unknown>, rlmOpts?: { systemPrompt?: string; model?: string; maxIterations?: number; use?: string; reasoning?: string; contextLayout?: ContextLayout }): Promise<string> => {
		// Reject delegation at max depth
		if (activeDepth >= opts.maxDepth) {
			return Promise.reject(
				new Error(`Cannot delegate: you are at maximum depth (${opts.maxDepth}).`),
			);
		}

		const componentName = rlmOpts?.use;

		// Resolve component plugin if requested
		let resolvedSystemPrompt: string | undefined = rlmOpts?.systemPrompt;
		if (componentName) {
			const componentBody = opts.childComponents?.[componentName];
			if (!componentBody) {
				const available = Object.keys(opts.childComponents ?? {});
				return Promise.reject(
					new Error(
						`Unknown component "${componentName}". Available: ${available.length > 0 ? available.join(", ") : "none configured"}`,
					),
				);
			}
			resolvedSystemPrompt = resolvedSystemPrompt
				? componentBody + "\n\n" + resolvedSystemPrompt
				: componentBody;
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
		const childLineage = [...((env.get("__press") as DelegationContext | undefined)?.lineage ?? [q]), q];
		const callerInvocationId = (env.get("__press") as DelegationContext | undefined)?.invocationId ?? "root";
		const callerParentId = (env.get("__press") as DelegationContext | undefined)?.parentId ?? null;

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
			parentId: callerParentId,
			depth: savedDepth,
			childId: childInvocationId,
			query: q,
			context: c != null ? JSON.stringify(c).slice(0, 5000) : undefined,
			modelAlias: rlmOpts?.model,
			maxIterations: rlmOpts?.maxIterations,
			componentName,
		});

		// Capture the parent's context frames for the child
		const parentFrames: readonly ContextFrame[] = (() => {
			const callerLocals = contextStore.locals.get(callerInvocationId);
			return (callerLocals?.__contextStack as readonly ContextFrame[] | undefined) ?? [];
		})();

		const promise = (async () => {
			try {
				const result = await rlmInternal(q, c, savedDepth + 1, childLineage, childInvocationId, callerInvocationId, resolvedSystemPrompt, modelCallLLM, rlmOpts?.maxIterations, rlmOpts?.reasoning, parentFrames, rlmOpts?.contextLayout);
				emit?.({
					type: "delegation:return",
					runId,
					timestamp: performance.now(),
					invocationId: callerInvocationId,
					parentId: callerParentId,
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
					parentId: callerParentId,
					depth: savedDepth,
					childId: childInvocationId,
					error: err instanceof Error ? err.message : String(err),
					iterations: err instanceof PressError ? err.iterations : 0,
				});
				throw err;
			} finally {
				activeDepth = savedDepth;
			}
		})();

		pendingRlmCalls.add(promise);
		const removeFromPending = () => pendingRlmCalls.delete(promise);
		promise.then(removeFromPending, removeFromPending);

		return promise;
	};

	env.set("press", pressFn);

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

	let runResult: PressResult | undefined;
	let runError: unknown;
	try {
		runResult = await rlmInternal(query, context, 0, [query], "root", null, options.systemPrompt, undefined, undefined, undefined, [], undefined);
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
			iterations: runResult?.iterations ?? (runError instanceof PressError ? runError.iterations : 0),
		});
	}
}
