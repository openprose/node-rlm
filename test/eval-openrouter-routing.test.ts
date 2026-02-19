import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { translateMessages } from "../src/drivers/openrouter-compatible.js";
import type { CallLLMResponse } from "../src/rlm.js";

/**
 * Build a mock OpenAI-format chat completions response with tool calls.
 */
function mockToolCallResponse(options: {
	reasoning?: string;
	code?: string;
	toolCallId?: string;
	finishReason?: string;
}) {
	const message: Record<string, unknown> = {
		content: options.reasoning ?? null,
	};
	if (options.code !== undefined) {
		message.tool_calls = [{
			id: options.toolCallId ?? "call_test123",
			type: "function",
			function: {
				name: "execute_code",
				arguments: JSON.stringify({ code: options.code }),
			},
		}];
	}
	return {
		choices: [{
			message,
			finish_reason: options.finishReason ?? (options.code !== undefined ? "tool_calls" : "stop"),
		}],
	};
}

describe("eval/drivers/openrouter — universal tool-call driver", () => {
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

	it("routes ALL models through /chat/completions (not /messages)", async () => {
		// Even anthropic/* models should use /chat/completions now
		setupMockResponse(mockToolCallResponse({ code: "1+1", toolCallId: "call_a" }));

		const callLLM = fromOpenRouter("anthropic/claude-opus-4-6", "test-key");
		await callLLM([{ role: "user", content: "test" }], "system prompt");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
	});

	it("sends tools, tool_choice, and parallel_tool_calls in request body", async () => {
		setupMockResponse(mockToolCallResponse({ code: "1+1" }));

		const callLLM = fromOpenRouter("anthropic/claude-opus-4-6", "test-key", { maxTokens: 8192 });
		await callLLM([{ role: "user", content: "test" }], "system prompt");

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.model).toBe("anthropic/claude-opus-4-6");
		expect(body.max_tokens).toBe(8192);

		// Tool definition
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].type).toBe("function");
		expect(body.tools[0].function.name).toBe("execute_code");
		expect(body.tools[0].function.parameters.properties.code.type).toBe("string");

		// Tool choice forces execute_code
		expect(body.tool_choice.type).toBe("function");
		expect(body.tool_choice.function.name).toBe("execute_code");

		// No parallel tool calls
		expect(body.parallel_tool_calls).toBe(false);
	});

	it("parses tool-call response as CallLLMResponse", async () => {
		setupMockResponse(mockToolCallResponse({
			reasoning: "Let me compute that.",
			code: 'console.log("hello")',
			toolCallId: "call_abc123",
		}));

		const callLLM = fromOpenRouter("anthropic/claude-opus-4-6", "test-key");
		const result = await callLLM(
			[{ role: "user", content: "Run some code" }],
			"You are a test agent.",
		);

		expect(typeof result).toBe("object");
		const response = result as CallLLMResponse;
		expect(response.reasoning).toBe("Let me compute that.");
		expect(response.code).toBe('console.log("hello")');
		expect(response.toolUseId).toBe("call_abc123");
	});

	it("handles text-only response (no tool_calls)", async () => {
		setupMockResponse(mockToolCallResponse({
			reasoning: "I cannot do that.",
			finishReason: "stop",
		}));

		const callLLM = fromOpenRouter("google/gemini-3-flash-preview", "test-key");
		const result = await callLLM(
			[{ role: "user", content: "test" }],
			"system",
		);

		const response = result as CallLLMResponse;
		expect(response.reasoning).toBe("I cannot do that.");
		expect(response.code).toBeNull();
		expect(response.toolUseId).toBeUndefined();
	});

	it("handles code-only response (null content)", async () => {
		setupMockResponse(mockToolCallResponse({
			code: 'return "fast"',
			toolCallId: "call_fast",
		}));

		const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-5-20250929", "test-key");
		const result = await callLLM(
			[{ role: "user", content: "test" }],
			"system",
		);

		const response = result as CallLLMResponse;
		expect(response.reasoning).toBe("");
		expect(response.code).toBe('return "fast"');
		expect(response.toolUseId).toBe("call_fast");
	});

	it("retries on HTTP 429", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429,
			text: async () => "Rate limited",
		});
		setupMockResponse(mockToolCallResponse({ code: "1+1", toolCallId: "t1" }));

		const callLLM = fromOpenRouter("anthropic/claude-opus-4-6", "test-key");
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

		const callLLM = fromOpenRouter("anthropic/claude-opus-4-6", "test-key");
		await expect(
			callLLM([{ role: "user", content: "test" }], "system"),
		).rejects.toThrow("API error (400)");
	});
});

describe("translateMessages", () => {
	it("passes plain messages through unchanged", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		const result = translateMessages(messages);
		expect(result).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]);
	});

	it("converts __TOOL_CALL__ to assistant with tool_calls", () => {
		const messages = [
			{ role: "assistant", content: '__TOOL_CALL__\ncall-123\nI will compute.\n__CODE__\nconsole.log("hello")' },
		];
		const result = translateMessages(messages);

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("assistant");
		expect(result[0].content).toBe("I will compute.");
		expect(result[0].tool_calls).toHaveLength(1);
		expect(result[0].tool_calls![0].id).toBe("call-123");
		expect(result[0].tool_calls![0].type).toBe("function");
		expect(result[0].tool_calls![0].function.name).toBe("execute_code");
		expect(JSON.parse(result[0].tool_calls![0].function.arguments).code).toBe('console.log("hello")');
	});

	it("converts __TOOL_RESULT__ to tool role message", () => {
		const messages = [
			{ role: "user", content: "__TOOL_RESULT__\ncall-123\nhello" },
		];
		const result = translateMessages(messages);

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("tool");
		expect(result[0].tool_call_id).toBe("call-123");
		expect(result[0].content).toBe("hello");
	});

	it("handles reasoning-only tool call (no reasoning text)", () => {
		const messages = [
			{ role: "assistant", content: "__TOOL_CALL__\ncall-456\n\n__CODE__\nreturn 42" },
		];
		const result = translateMessages(messages);

		expect(result[0].content).toBeNull(); // empty reasoning → null
		expect(JSON.parse(result[0].tool_calls![0].function.arguments).code).toBe("return 42");
	});

	it("roundtrips a full conversation with mixed message types", () => {
		const messages = [
			{ role: "user", content: "What is 2+2?" },
			{ role: "assistant", content: '__TOOL_CALL__\ncall-1\nLet me compute.\n__CODE__\nconsole.log(2+2)' },
			{ role: "user", content: "__TOOL_RESULT__\ncall-1\n4" },
		];
		const result = translateMessages(messages);

		expect(result).toHaveLength(3);
		// Plain user message
		expect(result[0]).toEqual({ role: "user", content: "What is 2+2?" });
		// Assistant with tool call
		expect(result[1].role).toBe("assistant");
		expect(result[1].content).toBe("Let me compute.");
		expect(result[1].tool_calls![0].id).toBe("call-1");
		// Tool result
		expect(result[2].role).toBe("tool");
		expect(result[2].tool_call_id).toBe("call-1");
		expect(result[2].content).toBe("4");
	});
});
