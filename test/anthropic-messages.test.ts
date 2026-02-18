import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromAnthropicMessages } from "../src/drivers/anthropic-messages.js";
import type { CallLLMResponse } from "../src/rlm.js";

/**
 * Build a mock Anthropic Messages API response.
 */
function mockAnthropicResponse(options: {
	text?: string;
	code?: string;
	toolUseId?: string;
	stopReason?: string;
}) {
	const content: Array<Record<string, unknown>> = [];
	if (options.text) {
		content.push({ type: "text", text: options.text });
	}
	if (options.code !== undefined) {
		content.push({
			type: "tool_use",
			id: options.toolUseId ?? "toolu_test123",
			name: "execute_code",
			input: { code: options.code },
		});
	}
	return {
		id: "msg_test123",
		type: "message",
		role: "assistant",
		content,
		model: "claude-opus-4-6-20250929",
		stop_reason: options.stopReason ?? (options.code !== undefined ? "tool_use" : "end_turn"),
		usage: { input_tokens: 100, output_tokens: 50 },
	};
}

describe("fromAnthropicMessages", () => {
	let originalFetch: typeof globalThis.fetch;
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		mockFetch = vi.fn();
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function setupMockResponse(body: unknown, status = 200) {
		mockFetch.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
			text: async () => JSON.stringify(body),
		});
	}

	it("parses text + tool_use response correctly", async () => {
		const responseBody = mockAnthropicResponse({
			text: "Let me compute that.",
			code: 'console.log("hello")',
			toolUseId: "toolu_abc123",
		});
		setupMockResponse(responseBody);

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		const result = await callLLM(
			[{ role: "user", content: "Run some code" }],
			"You are a test agent.",
		);

		expect(typeof result).toBe("object");
		const response = result as CallLLMResponse;
		expect(response.reasoning).toBe("Let me compute that.");
		expect(response.code).toBe('console.log("hello")');
		expect(response.toolUseId).toBe("toolu_abc123");
	});

	it("sends correct request body with tool definition and tool_choice", async () => {
		setupMockResponse(mockAnthropicResponse({ code: "1+1" }));

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
			maxTokens: 8192,
		});

		await callLLM(
			[{ role: "user", content: "test" }],
			"system prompt",
		);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe("https://openrouter.ai/api/v1/messages");
		expect(options.method).toBe("POST");
		expect(options.headers["Authorization"]).toBe("Bearer test-key");

		const body = JSON.parse(options.body);
		expect(body.model).toBe("anthropic/claude-opus-4-6");
		expect(body.max_tokens).toBe(8192);
		expect(body.system).toBe("system prompt");

		// Tool definition
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].name).toBe("execute_code");
		expect(body.tools[0].input_schema.properties.code.type).toBe("string");

		// Tool choice with disable_parallel_tool_use
		expect(body.tool_choice.type).toBe("tool");
		expect(body.tool_choice.name).toBe("execute_code");
		expect(body.tool_choice.disable_parallel_tool_use).toBe(true);
	});

	it("handles text-only response (no tool_use block)", async () => {
		const responseBody = mockAnthropicResponse({
			text: "I cannot do that.",
			stopReason: "end_turn",
		});
		setupMockResponse(responseBody);

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		const result = await callLLM(
			[{ role: "user", content: "test" }],
			"system",
		);

		const response = result as CallLLMResponse;
		expect(response.reasoning).toBe("I cannot do that.");
		expect(response.code).toBeNull();
		expect(response.toolUseId).toBeUndefined();
	});

	it("handles tool_use-only response (no text block)", async () => {
		const responseBody = mockAnthropicResponse({
			code: 'return "fast"',
			toolUseId: "toolu_fast",
		});
		setupMockResponse(responseBody);

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		const result = await callLLM(
			[{ role: "user", content: "test" }],
			"system",
		);

		const response = result as CallLLMResponse;
		expect(response.reasoning).toBe("");
		expect(response.code).toBe('return "fast"');
		expect(response.toolUseId).toBe("toolu_fast");
	});

	it("handles HTTP error with retry on 429", async () => {
		// First attempt: 429
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429,
			text: async () => "Rate limited",
		});
		// Second attempt: success
		setupMockResponse(mockAnthropicResponse({ code: "1+1", toolUseId: "t1" }));

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
			maxRetries: 1,
		});

		const result = await callLLM(
			[{ role: "user", content: "test" }],
			"system",
		);

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const response = result as CallLLMResponse;
		expect(response.code).toBe("1+1");
	});

	it("throws on non-retryable HTTP error", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			text: async () => "Bad request",
		});

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		await expect(
			callLLM([{ role: "user", content: "test" }], "system"),
		).rejects.toThrow("API error (400)");
	});

	it("throws on API-level error response", async () => {
		setupMockResponse({
			type: "error",
			error: { type: "invalid_request_error", message: "Invalid model" },
		});

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		await expect(
			callLLM([{ role: "user", content: "test" }], "system"),
		).rejects.toThrow("Invalid model");
	});

	it("translates __TOOL_CALL__ messages in conversation history", async () => {
		// Second call: the engine will have formatted previous tool-call exchange
		setupMockResponse(mockAnthropicResponse({ code: 'return "done"', toolUseId: "t2" }));

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		const messages = [
			{ role: "user", content: "test query" },
			{ role: "assistant", content: '__TOOL_CALL__\ntool-123\nI will compute.\n__CODE__\nconsole.log("hello")' },
			{ role: "user", content: "__TOOL_RESULT__\ntool-123\nhello" },
		];

		await callLLM(messages, "system");

		const [, options] = mockFetch.mock.calls[0];
		const body = JSON.parse(options.body);

		// First message: plain user
		expect(body.messages[0]).toEqual({ role: "user", content: "test query" });

		// Second message: assistant with text + tool_use content blocks
		expect(body.messages[1].role).toBe("assistant");
		expect(Array.isArray(body.messages[1].content)).toBe(true);
		const assistantContent = body.messages[1].content;
		expect(assistantContent[0].type).toBe("text");
		expect(assistantContent[0].text).toBe("I will compute.");
		expect(assistantContent[1].type).toBe("tool_use");
		expect(assistantContent[1].id).toBe("tool-123");
		expect(assistantContent[1].name).toBe("execute_code");
		expect(assistantContent[1].input.code).toBe('console.log("hello")');

		// Third message: user with tool_result content block
		expect(body.messages[2].role).toBe("user");
		expect(Array.isArray(body.messages[2].content)).toBe(true);
		const userContent = body.messages[2].content;
		expect(userContent[0].type).toBe("tool_result");
		expect(userContent[0].tool_use_id).toBe("tool-123");
		expect(userContent[0].content).toBe("hello");
	});

	it("strips trailing slashes from base URL", async () => {
		setupMockResponse(mockAnthropicResponse({ code: "1" }));

		const callLLM = fromAnthropicMessages({
			baseUrl: "https://openrouter.ai/api/v1///",
			apiKey: "test-key",
			model: "anthropic/claude-opus-4-6",
		});

		await callLLM([{ role: "user", content: "test" }], "system");

		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe("https://openrouter.ai/api/v1/messages");
	});
});
