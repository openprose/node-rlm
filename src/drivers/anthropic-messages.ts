/**
 * Anthropic Messages API driver with tool-call-based REPL execution.
 *
 * Uses a single `execute_code` tool with `disable_parallel_tool_use: true`
 * to guarantee exactly one code execution per LLM response. This solves the
 * multi-block hallucination problem: the model physically cannot emit more
 * than one tool call per turn.
 *
 * The driver translates between the engine's simple message format
 * ({ role, content } strings) and the Anthropic Messages API format
 * (content blocks with tool_use/tool_result types).
 */

import type { CallLLM, CallLLMResponse } from "../rlm.js";

/** Content block types in Anthropic Messages API responses. */
interface TextBlock {
	type: "text";
	text: string;
}

interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

type ContentBlock = TextBlock | ToolUseBlock;

/** Anthropic Messages API response shape (subset we care about). */
interface AnthropicMessagesResponse {
	id: string;
	type: "message";
	role: "assistant";
	content: ContentBlock[];
	model: string;
	stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal";
	usage?: { input_tokens?: number; output_tokens?: number };
	error?: { type: string; message: string };
}

/** Anthropic Messages API error response. */
interface AnthropicErrorResponse {
	type: "error";
	error: { type: string; message: string };
}

/** Anthropic Messages API request message format. */
interface AnthropicMessage {
	role: "user" | "assistant";
	content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessagesOptions {
	/** API base URL (e.g. "https://openrouter.ai/api/v1"). */
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
}

const EXECUTE_CODE_TOOL = {
	name: "execute_code",
	description:
		"Execute JavaScript in a persistent Node.js REPL. console.log() output is returned. Call return(value) to produce your final answer.",
	input_schema: {
		type: "object" as const,
		properties: {
			code: { type: "string" as const, description: "JavaScript code to execute" },
		},
		required: ["code"],
	},
};

const TOOL_CHOICE = {
	type: "tool" as const,
	name: "execute_code",
	disable_parallel_tool_use: true,
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 16384;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate the engine's flat message array into Anthropic Messages API format.
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
 * Plain string messages (from the text-block code path) are passed through as-is.
 */
function translateMessages(
	engineMessages: Array<{ role: string; content: string }>,
): AnthropicMessage[] {
	const result: AnthropicMessage[] = [];

	for (const msg of engineMessages) {
		const role = msg.role as "user" | "assistant";

		if (role === "assistant" && msg.content.startsWith("__TOOL_CALL__\n")) {
			// Reconstruct assistant message with text + tool_use blocks
			const parts = msg.content.split("\n__CODE__\n");
			const header = parts[0]; // "__TOOL_CALL__\n<id>\n<reasoning>"
			const code = parts[1] ?? "";
			const headerLines = header.split("\n");
			const toolUseId = headerLines[1];
			const reasoning = headerLines.slice(2).join("\n");

			const content: AnthropicContentBlock[] = [];
			if (reasoning) {
				content.push({ type: "text", text: reasoning });
			}
			content.push({
				type: "tool_use",
				id: toolUseId,
				name: "execute_code",
				input: { code },
			});

			result.push({ role: "assistant", content });
		} else if (role === "user" && msg.content.startsWith("__TOOL_RESULT__\n")) {
			// Reconstruct user message with tool_result block
			const lines = msg.content.split("\n");
			const toolUseId = lines[1];
			const content = lines.slice(2).join("\n");

			result.push({
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: toolUseId, content },
				],
			});
		} else {
			// Plain text message (initial user query or text-block path)
			result.push({ role, content: msg.content });
		}
	}

	return result;
}

/**
 * Create a CallLLM function that uses the Anthropic Messages API with tool calls.
 *
 * Returns `CallLLMResponse` objects: `{ reasoning, code, toolUseId }`.
 */
export function fromAnthropicMessages(options: AnthropicMessagesOptions): CallLLM {
	const {
		baseUrl,
		apiKey,
		model,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxRetries = DEFAULT_MAX_RETRIES,
		maxTokens = DEFAULT_MAX_TOKENS,
	} = options;

	// Normalize: strip trailing slash so we can append /messages reliably.
	const base = baseUrl.replace(/\/+$/, "");
	const endpoint = `${base}/messages`;

	let callCount = 0;

	return async (messages, systemPrompt) => {
		const anthropicMessages = translateMessages(messages);
		const callId = ++callCount;
		const inputChars = anthropicMessages.reduce((n, m) => {
			if (typeof m.content === "string") return n + m.content.length;
			return n + m.content.reduce((acc, block) => {
				if ("text" in block) return acc + block.text.length;
				if ("content" in block && typeof block.content === "string") return acc + block.content.length;
				return acc;
			}, 0);
		}, 0) + systemPrompt.length;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const t0 = Date.now();

			const reqBody = {
				model,
				max_tokens: maxTokens,
				system: systemPrompt,
				messages: anthropicMessages,
				tools: [EXECUTE_CODE_TOOL],
				tool_choice: TOOL_CHOICE,
			};

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
					console.error(
						`[${model}] HTTP ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`,
					);
					await sleep(delay);
					continue;
				}

				throw new Error(`${model} API error (${status}): ${text}`);
			}

			clearTimeout(timeoutId);
			const data = (await response.json()) as AnthropicMessagesResponse | AnthropicErrorResponse;

			// Handle API-level error response
			if ("type" in data && data.type === "error") {
				const errData = data as AnthropicErrorResponse;
				throw new Error(`${model} error: ${errData.error.message}`);
			}

			const msgData = data as AnthropicMessagesResponse;

			// Extract reasoning (text blocks) and code (tool_use block)
			let reasoning = "";
			let code: string | null = null;
			let toolUseId: string | null = null;

			for (const block of msgData.content) {
				if (block.type === "text") {
					reasoning += (reasoning ? "\n" : "") + block.text;
				} else if (block.type === "tool_use" && block.name === "execute_code") {
					code = (block.input as { code?: string }).code ?? null;
					toolUseId = block.id;
				}
			}

			const elapsed = Date.now() - t0;
			const outChars = reasoning.length + (code?.length ?? 0);
			console.error(
				`[${model} #${callId}] ${elapsed}ms, in=${inputChars}c, out=${outChars}c, stop=${msgData.stop_reason}`,
			);

			const result: CallLLMResponse = { reasoning, code };
			if (toolUseId) {
				result.toolUseId = toolUseId;
			}
			return result;
		}

		throw new Error(`${model}: exhausted all retries`);
	};
}
