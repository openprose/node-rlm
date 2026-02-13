/**
 * OpenRouter-compatible CallLLM driver.
 *
 * Talks to any API that uses the OpenAI chat completions format:
 * OpenRouter, OpenAI, Groq, Together, Ollama, vLLM, etc.
 *
 * Retries with exponential backoff, request timeouts, per-request
 * timing/logging to stderr, and both HTTP-level and JSON-level error handling.
 */

import type { CallLLM } from "../rlm.js";

interface ChatMessage {
	role: string;
	content: string;
}

interface ChatCompletionResponse {
	choices: Array<{ message: { content: string }; finish_reason?: string; native_finish_reason?: string }>;
	error?: { message: string; code?: number };
}

export interface OpenRouterCompatibleOptions {
	/** API base URL (e.g. "https://openrouter.ai/api/v1", "https://api.openai.com/v1"). */
	baseUrl: string;
	/** Bearer token for the Authorization header. */
	apiKey: string;
	/** Model ID to send in the request body. */
	model: string;
	/** Request timeout in milliseconds (default 60000). */
	timeoutMs?: number;
	/** Number of retries on 429/5xx (default 3). */
	maxRetries?: number;
	/** max_tokens for the response (default 4096). */
	maxTokens?: number;
	/**
	 * Whether to send `tools: [], tool_choice: "none"` in the request body.
	 * Needed for Gemini to suppress MALFORMED_FUNCTION_CALL errors.
	 * Default false.
	 */
	tools?: boolean;
	/**
	 * Use SSE streaming and abort generation after the first complete code block.
	 * When the model starts writing a second ```javascript fence, the stream is
	 * cancelled and accumulated content (up to the second fence) is returned.
	 * Saves 80%+ of generation time on responses with multiple code blocks.
	 */
	stopAfterFirstBlock?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 4096;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a CallLLM function that calls any OpenAI-compatible chat completions API.
 */
/** Find the byte offset where a second ```javascript/js/repl fence begins. */
function findSecondFenceIndex(text: string): number | null {
	const re = /```(?:javascript|js|repl)\n/g;
	let count = 0;
	let match;
	while ((match = re.exec(text))) {
		count++;
		if (count === 2) return match.index;
	}
	return null;
}

/**
 * Read an SSE stream, accumulating content tokens. If a second code-fence
 * opening is detected, cancel the stream early and return the content
 * truncated just before the second fence.
 */
async function readStreamUntilSecondBlock(
	body: ReadableStream<Uint8Array>,
	abortController: AbortController,
): Promise<{ content: string; aborted: boolean }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let content = "";
	let sseBuffer = "";
	let aborted = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			sseBuffer += decoder.decode(value, { stream: true });

			// Parse complete SSE lines
			const lines = sseBuffer.split("\n");
			sseBuffer = lines.pop()!; // keep incomplete line

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				const data = line.slice(6).trim();
				if (data === "[DONE]") continue;
				try {
					const chunk = JSON.parse(data);
					const delta = chunk.choices?.[0]?.delta?.content;
					if (delta) content += delta;
				} catch {
					// Skip malformed chunks
				}
			}

			// Check if a second code block is starting
			const secondFence = findSecondFenceIndex(content);
			if (secondFence !== null) {
				content = content.slice(0, secondFence);
				aborted = true;
				abortController.abort();
				break;
			}
		}
	} catch (err) {
		// AbortError is expected when we cancel the stream
		if (err instanceof Error && err.name === "AbortError" && aborted) {
			// Expected — we aborted intentionally
		} else {
			throw err;
		}
	} finally {
		try { await reader.cancel(); } catch {}
	}

	return { content, aborted };
}

export function fromOpenRouterCompatible(options: OpenRouterCompatibleOptions): CallLLM {
	const {
		baseUrl,
		apiKey,
		model,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxRetries = DEFAULT_MAX_RETRIES,
		maxTokens = DEFAULT_MAX_TOKENS,
		tools = false,
		stopAfterFirstBlock = false,
	} = options;

	// Normalize: strip trailing slash so we can append /chat/completions reliably.
	const base = baseUrl.replace(/\/+$/, "");
	const endpoint = `${base}/chat/completions`;

	let callCount = 0;

	return async (messages, systemPrompt) => {
		const chatMessages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...messages.map((m) => ({ role: m.role, content: m.content })),
		];
		const callId = ++callCount;
		const inputChars = chatMessages.reduce((n, m) => n + m.content.length, 0);

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const t0 = Date.now();

			const reqBody: Record<string, unknown> = {
				model,
				messages: chatMessages,
				max_tokens: maxTokens,
			};
			if (tools) {
				reqBody.tools = [];
				reqBody.tool_choice = "none";
			}
			if (stopAfterFirstBlock) {
				reqBody.stream = true;
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

			// --- Streaming path: read SSE tokens, abort at second code fence ---
			if (stopAfterFirstBlock && response.body) {
				const { content, aborted } = await readStreamUntilSecondBlock(response.body, abortController);
				clearTimeout(timeoutId);
				const elapsed = Date.now() - t0;
				const suffix = aborted ? ", early-stop=second-fence" : "";
				console.error(`[${model} #${callId}] ${elapsed}ms, in=${inputChars}c, out=${content.length}c, finish=stream${suffix}`);

				if (!content) {
					console.error(`[${model}] Empty streaming content`);
				}
				return content;
			}

			// --- Non-streaming path: read full JSON response ---
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
			const content = choice.message.content ?? "";
			const elapsed = Date.now() - t0;
			const outChars = content.length;
			console.error(`[${model} #${callId}] ${elapsed}ms, in=${inputChars}c, out=${outChars}c, finish=${choice.finish_reason}`);

			if (!content) {
				console.error(`[${model}] Empty content. finish_reason=${(choice as any).native_finish_reason ?? choice.finish_reason}, keys=${Object.keys(choice.message).join(",")}`);
			}

			return content;
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
	options?: { apiKey?: string; baseUrl?: string; timeoutMs?: number },
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
	});
}
