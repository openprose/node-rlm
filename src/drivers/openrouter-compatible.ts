/**
 * OpenRouter-compatible CallLLM driver with OpenAI-format tool calls.
 *
 * Talks to any API that uses the OpenAI chat completions format:
 * OpenRouter, OpenAI, Groq, Together, Ollama, vLLM, etc.
 *
 * Uses a single `execute_code` tool with `parallel_tool_calls: false`
 * to guarantee exactly one code execution per LLM response.
 *
 * Retries with exponential backoff, request timeouts, per-request
 * timing/logging to stderr, and both HTTP-level and JSON-level error handling.
 */

import type { CallLLM, CallLLMOptions, CallLLMResponse } from "../rlm.js";
import { EXECUTE_CODE_TOOL, TOOL_CHOICE } from "../system-prompt.js";

interface ChatMessage {
	role: string;
	content: string | null;
	reasoning?: string | null;
	reasoning_details?: Array<Record<string, unknown>> | null;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

interface ChatCompletionResponse {
	choices: Array<{
		message: {
			content: string | null;
			reasoning?: string | null;
			reasoning_details?: Array<Record<string, unknown>> | null;
			tool_calls?: Array<{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}>;
		};
		finish_reason?: string;
		native_finish_reason?: string;
	}>;
	error?: { message: string; code?: number };
}

export interface OpenRouterCompatibleOptions {
	/** API base URL (e.g. "https://openrouter.ai/api/v1", "https://api.openai.com/v1"). */
	baseUrl: string;
	/** Bearer token for the Authorization header. */
	apiKey: string;
	/** Model ID to send in the request body. */
	model: string;
	/** Request timeout in milliseconds (default 120000). */
	timeoutMs?: number;
	/** Number of retries on 429/5xx (default 3). */
	maxRetries?: number;
	/** max_tokens for the response (default 16384). */
	maxTokens?: number;
	/** Reasoning effort level (default: none). Set to enable OpenRouter reasoning tokens. */
	reasoningEffort?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 16384;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate the engine's flat message array into OpenAI chat completions format
 * with tool_calls / tool role messages.
 *
 * The engine maintains messages as `{ role: string; content: string }`. When the
 * engine uses the tool-call path, assistant messages contain the full reasoning
 * text followed by a tool-call marker, and the subsequent user message contains
 * the tool result. This driver uses a convention to detect tool-call history:
 *
 * - Assistant messages starting with `__TOOL_CALL__` are tool-call responses
 *   (format: `__TOOL_CALL__\n<tool_use_id>\n<reasoning>\n__CODE__\n<code>`)
 * - User messages starting with `__TOOL_RESULT__` are tool results
 *   (format: `__TOOL_RESULT__\n<tool_use_id>\n<content>`)
 *
 * Plain string messages (initial user query) are passed through as-is.
 */
export function translateMessages(
	engineMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }>,
): ChatMessage[] {
	const result: ChatMessage[] = [];

	for (const msg of engineMessages) {
		if (msg.role === "assistant" && msg.content.startsWith("__TOOL_CALL__\n")) {
			// Reconstruct assistant message with content + tool_calls
			const parts = msg.content.split("\n__CODE__\n");
			const header = parts[0]; // "__TOOL_CALL__\n<id>\n<reasoning>"
			const code = parts[1] ?? "";
			const headerLines = header.split("\n");
			const toolUseId = headerLines[1];
			const reasoning = headerLines.slice(2).join("\n");

			const chatMsg: ChatMessage = {
				role: "assistant",
				content: reasoning || null,
				tool_calls: [{
					id: toolUseId,
					type: "function",
					function: {
						name: "execute_code",
						arguments: JSON.stringify({ code }),
					},
				}],
			};

			// Attach reasoning details for round-trip if present
			if (msg.meta?.reasoningDetails) {
				chatMsg.reasoning_details = msg.meta.reasoningDetails as Array<Record<string, unknown>>;
			}

			result.push(chatMsg);
		} else if (msg.role === "user" && msg.content.startsWith("__TOOL_RESULT__\n")) {
			// Reconstruct tool result message
			const lines = msg.content.split("\n");
			const toolUseId = lines[1];
			const content = lines.slice(2).join("\n");

			result.push({
				role: "tool",
				content,
				tool_call_id: toolUseId,
			});
		} else {
			// Plain text message (initial user query)
			result.push({ role: msg.role, content: msg.content });
		}
	}

	return result;
}

/**
 * Create a CallLLM function that calls any OpenAI-compatible chat completions API
 * with tool-call-based REPL execution.
 *
 * Returns `CallLLMResponse` objects: `{ reasoning, code, toolUseId }`.
 */
export function fromOpenRouterCompatible(options: OpenRouterCompatibleOptions): CallLLM {
	const {
		baseUrl,
		apiKey,
		model,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxRetries = DEFAULT_MAX_RETRIES,
		maxTokens = DEFAULT_MAX_TOKENS,
		reasoningEffort: defaultReasoningEffort,
	} = options;

	// Normalize: strip trailing slash so we can append /chat/completions reliably.
	const base = baseUrl.replace(/\/+$/, "");
	const endpoint = `${base}/chat/completions`;

	let callCount = 0;

	return async (messages, systemPrompt, callOptions?: CallLLMOptions) => {
		const chatMessages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...translateMessages(messages),
		];
		const callId = ++callCount;
		const inputChars = chatMessages.reduce((n, m) => n + (m.content?.length ?? 0), 0);

		// Per-call reasoning effort overrides the default from options
		const effort = callOptions?.reasoningEffort ?? defaultReasoningEffort;

		const useReasoning = !!(effort && effort !== "none");

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const t0 = Date.now();

			const reqBody: Record<string, unknown> = {
				model,
				messages: chatMessages,
				max_tokens: maxTokens,
				tools: [EXECUTE_CODE_TOOL],
				// Anthropic extended thinking is incompatible with forced tool_choice.
				// When reasoning is enabled, fall back to "auto" so the API accepts it.
				tool_choice: useReasoning ? "auto" : TOOL_CHOICE,
				parallel_tool_calls: false,
			};

			// Add reasoning tokens request if effort is specified.
			// Always include `enabled: true` — required by Claude 4.6+ adaptive thinking.
			// The `effort` field is additive for models that support it; ignored by others.
			if (useReasoning) {
				reqBody.reasoning = { enabled: true, effort };
			}

			const abortController = new AbortController();
			const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

			let response: Response;
			try {
				response = await fetch(endpoint, {
					signal: abortController.signal,
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(reqBody),
				});
			} catch (err) {
				clearTimeout(timeoutId);
				if (err instanceof Error && err.name === "AbortError") {
					throw new Error(`${model}: request timed out after ${timeoutMs}ms`);
				}
				throw err;
			}

			if (!response.ok) {
				clearTimeout(timeoutId);
				const text = await response.text();
				const status = response.status;

				if ((status === 429 || status >= 500) && attempt < maxRetries) {
					const delay = BASE_DELAY_MS * 2 ** attempt;
					console.error(`[${model}] HTTP ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
					await sleep(delay);
					continue;
				}

				throw new Error(`${model} API error (${status}): ${text}`);
			}

			clearTimeout(timeoutId);
			const data = (await response.json()) as ChatCompletionResponse;

			if (data.error) {
				const code = data.error.code ?? 0;
				if ((code === 429 || code >= 500) && attempt < maxRetries) {
					const delay = BASE_DELAY_MS * 2 ** attempt;
					console.error(`[${model}] error ${code}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
					await sleep(delay);
					continue;
				}
				throw new Error(`${model} error: ${data.error.message}`);
			}

			if (!data.choices || data.choices.length === 0) {
				throw new Error(`${model} returned no choices`);
			}

			const choice = data.choices[0];
			const reasoning = choice.message.reasoning
				?? choice.message.content
				?? "";
			const reasoningDetails = choice.message.reasoning_details ?? null;
			let code: string | null = null;
			let toolUseId: string | null = null;

			const toolCall = choice.message.tool_calls?.[0];
			if (toolCall && toolCall.function.name === "execute_code") {
				toolUseId = toolCall.id;
				try {
					const args = JSON.parse(toolCall.function.arguments);
					code = args.code ?? null;
				} catch {
					// Malformed JSON in arguments — treat as no code
					code = null;
				}
			}

			const elapsed = Date.now() - t0;
			const outChars = reasoning.length + (code?.length ?? 0);
			console.error(
				`[${model} #${callId}] ${elapsed}ms, in=${inputChars}c, out=${outChars}c, finish=${choice.finish_reason}`,
			);

			const result: CallLLMResponse = { reasoning, code };
			if (toolUseId) {
				result.toolUseId = toolUseId;
			}
			if (reasoningDetails) {
				result.reasoningDetails = reasoningDetails;
			}
			return result;
		}

		throw new Error(`${model}: exhausted all retries`);
	};
}

interface ProviderConfig {
	baseUrl: string;
	envVar: string;
}

const KNOWN_PROVIDERS: Record<string, ProviderConfig> = {
	openrouter: {
		baseUrl: "https://openrouter.ai/api/v1",
		envVar: "OPENROUTER_API_KEY",
	},
	openai: {
		baseUrl: "https://api.openai.com/v1",
		envVar: "OPENAI_API_KEY",
	},
};

/**
 * Convenience factory that parses a "provider/model" string and routes to the
 * right base URL and API key automatically.
 *
 * Examples:
 *   fromProviderModel("openrouter/google/gemini-3-flash-preview")
 *   fromProviderModel("openai/gpt-4o")
 *   fromProviderModel("custom/my-model", { baseUrl: "http://localhost:11434/v1", apiKey: "ollama" })
 *
 * For known providers (openrouter, openai), the base URL is inferred and the
 * API key is read from the corresponding environment variable. Both can be
 * overridden via the options parameter.
 */
export function fromProviderModel(
	providerSlashModel: string,
	options?: { apiKey?: string; baseUrl?: string; timeoutMs?: number; reasoningEffort?: string },
): CallLLM {
	const slashIdx = providerSlashModel.indexOf("/");
	if (slashIdx === -1) {
		throw new Error(
			`fromProviderModel: expected "provider/model" format, got "${providerSlashModel}"`,
		);
	}

	const provider = providerSlashModel.slice(0, slashIdx);
	const model = providerSlashModel.slice(slashIdx + 1);

	if (!model) {
		throw new Error(
			`fromProviderModel: empty model in "${providerSlashModel}"`,
		);
	}

	const known = KNOWN_PROVIDERS[provider];

	let baseUrl: string;
	let apiKey: string;

	if (known) {
		baseUrl = options?.baseUrl ?? known.baseUrl;
		apiKey = options?.apiKey ?? process.env[known.envVar] ?? "";
		if (!apiKey) {
			throw new Error(
				`fromProviderModel: no API key for provider "${provider}". ` +
				`Set ${known.envVar} or pass options.apiKey.`,
			);
		}
	} else {
		baseUrl = options?.baseUrl ?? "";
		apiKey = options?.apiKey ?? "";
		if (!baseUrl || !apiKey) {
			throw new Error(
				`fromProviderModel: unknown provider "${provider}". ` +
				`You must pass both options.baseUrl and options.apiKey.`,
			);
		}
	}

	return fromOpenRouterCompatible({
		baseUrl,
		apiKey,
		model,
		timeoutMs: options?.timeoutMs,
		reasoningEffort: options?.reasoningEffort,
	});
}
