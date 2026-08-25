import { describe, expect, it } from "vitest";
import { type CallLLM, type CallLLMResponse, press } from "../src/rlm.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function mockToolCallLLM(responses: CallLLMResponse[]): CallLLM {
	let callIndex = 0;
	return async (_messages, _systemPrompt) => {
		if (callIndex >= responses.length) {
			throw new Error(`Unexpected call #${callIndex + 1}, only ${responses.length} responses defined`);
		}
		return responses[callIndex++];
	};
}

function tc(code: string, toolUseId = "t"): CallLLMResponse {
	return { reasoning: "", code, toolUseId };
}

describe("press", () => {
	it("simple return", async () => {
		const callLLM = mockToolCallLLM([tc('return "hello"', "t1"), tc('return "hello"', "t2")]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("hello");
		expect(result.iterations).toBe(2);
	});

	it("multi-iteration", async () => {
		const callLLM = mockToolCallLLM([tc('console.log("thinking...")', "t1"), tc('return "done"', "t2")]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("done");
		expect(result.iterations).toBe(2);
	});

	it("no-code turn followed by code", async () => {
		const callLLM = mockToolCallLLM([
			{ reasoning: "Let me think about this...", code: null, toolUseId: "t1" },
			tc('return "answer"', "t2"),
		]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("answer");
		expect(result.iterations).toBe(2);
	});

	it("error recovery", async () => {
		const callLLM = mockToolCallLLM([tc('throw new Error("oops")', "t1"), tc('return "recovered"', "t2")]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("recovered");
		expect(result.iterations).toBe(2);
	});

	it("max iterations throws", async () => {
		const callLLM = mockToolCallLLM([
			tc('console.log("loop 1")', "t1"),
			tc('console.log("loop 2")', "t2"),
			tc('console.log("loop 3")', "t3"),
		]);
		await expect(press("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
	});

	it("context accessible as variable", async () => {
		const callLLM = mockToolCallLLM([tc("return context.data", "t1"), tc("return context.data", "t2")]);
		const result = await press("test query", { data: "my context data" }, { callLLM });
		expect(result.answer).toBe("my context data");
	});

	it("string context throws error", async () => {
		const callLLM = mockToolCallLLM([tc('return "nope"', "t1")]);
		await expect(
			press("test query", "my context data" as unknown as Record<string, unknown>, { callLLM }),
		).rejects.toThrow("press() context must be an object, got string");
	});

	it("return stringifies non-strings", async () => {
		const callLLM = mockToolCallLLM([tc("return 42", "t1"), tc("return 42", "t2")]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
	});

	it("bare assignment persists across iterations", async () => {
		const callLLM = mockToolCallLLM([tc("x = 42", "t1"), tc("return x", "t2")]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("press(): child returns to parent", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'result = await press("child query")\nreturn result', toolUseId: "tp" };
		};

		const result = await press("parent query", undefined, { callLLM });
		expect(result.answer).toBe("child answer");
	});

	it("child at max depth: REPL without delegation", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";

			if (userMsg === "parent query") {
				return { reasoning: "", code: 'const r = await press("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		const result = await press("parent query", undefined, { callLLM, maxDepth: 1 });
		expect(result.answer).toBe("child answer");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("console.log");
		expect(childPrompt).toContain("return(value)");
		expect(childPrompt).toContain("maximum delegation depth");
	});

	it("press() at max depth rejects", async () => {
		const callLLM: CallLLM = async (messages) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent query") {
				return { reasoning: "", code: 'const r = await press("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'const r = await press("grandchild")\nreturn r', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		// maxDepth=1: root(0) can delegate, child(1) cannot
		await expect(press("parent query", undefined, {
			callLLM,
			maxDepth: 1,
			maxIterations: 2,
		})).rejects.toThrow("max iterations");
	});

	it("let/const persists across iterations", async () => {
		const callLLM = mockToolCallLLM([tc("let x = 42", "t1"), tc("return x", "t2")]);
		const result = await press("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("output fed back as tool result", async () => {
		let secondCallMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'console.log("hello world")', toolUseId: "t1" };
			}
			secondCallMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};

		await press("test query", undefined, { callLLM });

		expect(secondCallMessages).toBeDefined();
		const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
		expect(lastMsg.content).toContain("hello world");
		expect(lastMsg.role).toBe("user");
	});

	it("__press: root depth 0, correct lineage", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'console.log(JSON.stringify(__press))', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};

		await press("my query", undefined, {
			callLLM,
			maxDepth: 3,
			maxIterations: 10,
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		const parsed = JSON.parse(toolResult!.content.split("\n").find((l) => l.startsWith("{"))!);
		expect(parsed.depth).toBe(0);
		expect(parsed.maxDepth).toBe(3);
		expect(parsed.maxIterations).toBe(10);
		expect(parsed.lineage).toEqual(["my query"]);
	});

	it("__press: child depth 1, parent in lineage", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'console.log(JSON.stringify(__press))\nreturn "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await press("child task")\nreturn r', toolUseId: "tp" };
		};

		const result = await press("parent task", undefined, { callLLM, maxDepth: 3 });

		expect(result.answer).toBe("child done");
	});

	it("__press: iteration increments", async () => {
		let lastMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			lastMessages = [...messages];
			if (callIndex <= 2) {
				return { reasoning: "", code: 'console.log("iter=" + __press.iteration)', toolUseId: `t${callIndex}` };
			}
			return { reasoning: "", code: 'console.log("iter=" + __press.iteration)\nreturn "done"', toolUseId: `t${callIndex}` };
		};

		await press("test", undefined, { callLLM });
		const allOutput = lastMessages!
			.filter(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"))
			.map(m => m.content)
			.join("\n");
		const iters = allOutput.match(/iter=(\d+)/g)!.map((m) => Number(m.split("=")[1]));
		expect(iters).toEqual([0, 1]);
	});

	it("__press: frozen", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: '__press.depth = 99\nconsole.log("depth=" + __press.depth)', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};
		await press("test", undefined, { callLLM });
		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		// In sloppy mode, assignment silently fails; depth stays 0
		expect(toolResult!.content).toContain("depth=0");
	});

	it("__press: lineage frozen", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'try { __press.lineage.push("hacked") } catch(e) { console.log("lineage frozen: " + e.message) }', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};
		await press("test", undefined, { callLLM });
		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("lineage frozen:");
	});

	it("context: child isolation", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return { reasoning: "", code: 'console.log("child sees: " + context.data)\nreturn context.data', toolUseId: "tc" };
			}
			// Parent: first call spawns child with different context, second verifies parent context
			if (messages.length <= 1) {
				return { reasoning: "", code: 'const childResult = await press("child query", { data: "child context" })\nconsole.log("parent still sees: " + context.data)', toolUseId: "tp1" };
			}
			return { reasoning: "", code: "return context.data", toolUseId: "tp2" };
		};

		const result = await press("parent query", { data: "parent context" }, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("parent context");
	});

	it("unawaited press() auto-awaited", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "fire and forget") {
				return { reasoning: "", code: 'return "child"', toolUseId: "tc" };
			}
			if (messages.length <= 1) {
				return { reasoning: "", code: 'press("fire and forget")\nconsole.log("continued")', toolUseId: "tp1" };
			}
			const lastMsg = messages[messages.length - 1]?.content || "";
			if (lastMsg.includes("ERROR")) {
				return { reasoning: "", code: 'return "saw warning"', toolUseId: "tp2" };
			}
			return { reasoning: "", code: 'return "no warning"', toolUseId: "tp3" };
		};

		const result = await press("test", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("no warning");
	});

	it("parallel press() via Promise.all", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "task A") {
				return { reasoning: "", code: 'return "result A"', toolUseId: "ta" };
			}
			if (userMsg === "task B") {
				return { reasoning: "", code: 'return "result B"', toolUseId: "tb" };
			}
			return { reasoning: "", code: 'const [a, b] = await Promise.all([press("task A"), press("task B")])\nreturn a + " + " + b', toolUseId: "tp" };
		};

		const result = await press("parent", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("result A + result B");
	});

	it("model selection: child uses specified model", async () => {
		let fastModelCalled = false;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "hello") {
				return { reasoning: "", code: 'return "FAST_MODEL response"', toolUseId: "td" };
			}
			return { reasoning: "", code: 'result = await press("hello", undefined, { model: "fast" })\nreturn result', toolUseId: "tp" };
		};

		const fastCallLLM: CallLLM = async (_messages, _systemPrompt) => {
			fastModelCalled = true;
			return { reasoning: "", code: 'return "FAST_MODEL response"', toolUseId: "tf" };
		};

		const result = await press("parent query", undefined, {
			callLLM: defaultCallLLM,
			maxDepth: 3,
			models: {
				fast: { callLLM: fastCallLLM, tags: ["speed"], description: "A fast model" },
			},
		});

		expect(fastModelCalled).toBe(true);
		expect(result.answer).toBe("FAST_MODEL response");
	});

	it("model selection: invalid alias errors", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'result = await press("hello", undefined, { model: "nonexistent" })\nreturn result', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		await press("test", undefined, {
			callLLM: defaultCallLLM,
			maxDepth: 3,
			models: {
				fast: { callLLM: defaultCallLLM },
			},
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("Unknown model alias");
	});

	it("sandboxGlobals: accessible from agent code", async () => {
		const mockObj = { greet: (name: string) => "hello " + name };
		const callLLM = mockToolCallLLM([
			tc('return myApi.greet("world")', "t1"),
			tc('return myApi.greet("world")', "t2"),
		]);
		const result = await press("test query", undefined, {
			callLLM,
			sandboxGlobals: { myApi: mockObj },
		});
		expect(result.answer).toBe("hello world");
	});

	it("globalDocs: in root prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await press("test", undefined, {
			callLLM,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(capturedSystemPrompt).toContain("## Sandbox Globals");
		expect(capturedSystemPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: in child prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await press("child task")\nreturn r', toolUseId: "tp" };
		};

		await press("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		expect(systemPrompts[1]).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: in child prompt with customSystemPrompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await press("child task", undefined, { systemPrompt: "You are a helper." })\nreturn r', toolUseId: "tp" };
		};

		await press("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a helper.");
		// With customSystemPrompt, it replaces the default prompt entirely.
		// globalDocs are NOT included — the custom prompt is self-contained.
	});

	it("globalDocs: in max-depth child prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent task") {
				return { reasoning: "", code: 'const r = await press("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		await press("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs + sandboxGlobals: child uses documented global", async () => {
		const mockApi = { greet: (name: string) => "hello " + name };
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "greet world") {
				if (!systemPrompt.includes("myApi.greet")) {
					return { reasoning: "", code: 'return "FAIL: no globalDocs"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'return myApi.greet("world")', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await press("greet world")\nreturn r', toolUseId: "tp" };
		};

		const result = await press("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			sandboxGlobals: { myApi: mockApi },
			globalDocs: "`myApi.greet(name)` -- returns a greeting string.",
		});

		expect(result.answer).toBe("hello world");
	});

	it("globalDocs: absent when not provided", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await press("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("## Sandbox Globals");
	});

	it("use: child receives component prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await press("child task", undefined, { use: "test-component" })\nreturn r', toolUseId: "tp" };
		};

		await press("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-component": "You are a test component.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test component.");
		expect(childPrompt).toContain("Do test things.");
		// With customSystemPrompt (from `use`), the component IS the full prompt.
		// No generic <press-environment> wrapping.
	});

	it("use: unknown name errors with list", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'const r = await press("child task", undefined, { use: "nonexistent" })\nreturn r', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		await press("test", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-component": "body1", "other-component": "body2" },
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("Unknown component");
		expect(toolResult!.content).toContain("test-component");
		expect(toolResult!.content).toContain("other-component");
	});

	it("caught delegation failure does not surface as a phantom error", async () => {
		const events: Array<{ type: string; invocationId?: string; error?: string | null }> = [];
		const callLLM = mockToolCallLLM([
			tc(`try { await press("child task", undefined, { model: "failer" }) } catch (e) { console.log("caught:", e.message) }`, "t1"),
			tc('return "ok"', "t2"),
		]);

		const result = await press("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			models: {
				failer: {
					callLLM: async () => {
						throw new Error("child boom");
					},
				},
			},
			observer: { emit: (event) => events.push(event as { type: string; invocationId?: string; error?: string | null }) },
		});

		expect(result.answer).toBe("ok");
		const rootIterationEnds = events.filter((e) => e.type === "iteration:end" && e.invocationId === "root");
		for (const event of rootIterationEnds) {
			expect(event.error).toBeNull();
		}
	});

	it("use + systemPrompt concatenated", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await press("child task", undefined, { use: "test-component", systemPrompt: "Extra instructions." })\nreturn r', toolUseId: "tp" };
		};

		await press("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-component": "You are a test component.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test component.");
		expect(childPrompt).toContain("Do test things.");
		expect(childPrompt).toContain("Extra instructions.");
	});

	it("availableComponents wired from childComponents keys", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await press("test", undefined, {
			callLLM,
			childComponents: { "level-solver": "body1", "oha": "body2" },
		});

		expect(capturedSystemPrompt).toContain("Available components: level-solver, oha");
	});

	it("no available components when childComponents empty", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await press("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("Available components:");
	});

	it("childComponents: not in root prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await press("test", undefined, {
			callLLM,
			childComponents: { "test-component": "You are a test component.\n\nDo test things." },
		});

		expect(capturedSystemPrompt).not.toContain("You are a test component.");
		expect(capturedSystemPrompt).not.toContain("Do test things.");
	});

	describe("tool-call specifics", () => {
		it("null code triggers warning", async () => {
			let secondCallMessages: Array<{ role: string; content: string }> | undefined;
			let callIndex = 0;
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "Let me think about this.", code: null, toolUseId: "t1" };
				}
				secondCallMessages = [...messages];
				return { reasoning: "Now returning.", code: 'return "done"', toolUseId: "t2" };
			};

			await press("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
			expect(lastMsg.content).toContain("[WARNING] No code was executed");
		});

		it("__TOOL_CALL__ / __TOOL_RESULT__ markers", async () => {
			let secondCallMessages: Array<{ role: string; content: string }> | undefined;
			let callIndex = 0;
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "Step one.", code: 'console.log("hello")', toolUseId: "tool-123" };
				}
				secondCallMessages = [...messages];
				return { reasoning: "Done.", code: 'return "done"', toolUseId: "tool-456" };
			};

			await press("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const assistantMsg = secondCallMessages!.find(m => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"));
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.content).toContain("tool-123");
			expect(assistantMsg!.content).toContain("Step one.");
			expect(assistantMsg!.content).toContain("__CODE__");
			expect(assistantMsg!.content).toContain('console.log("hello")');

			const toolResultMsg = secondCallMessages!.find(m => m.role === "user" && m.content.startsWith("__TOOL_RESULT__"));
			expect(toolResultMsg).toBeDefined();
			expect(toolResultMsg!.content).toContain("tool-123");
			expect(toolResultMsg!.content).toContain("hello");
		});

		it("max iterations throws", async () => {
			const callLLM = mockToolCallLLM([
				{ reasoning: "Step 1.", code: 'console.log("loop 1")', toolUseId: "t1" },
				{ reasoning: "Step 2.", code: 'console.log("loop 2")', toolUseId: "t2" },
				{ reasoning: "Step 3.", code: 'console.log("loop 3")', toolUseId: "t3" },
			]);
			await expect(press("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
		});
	});

	describe("reasoning details round-trip", () => {
		it("reasoningDetails round-trip", async () => {
			const mockDetails = [
				{ type: "reasoning.text", id: "rd_abc123", format: "anthropic-claude-v1", index: 0, text: "I'm thinking about this..." },
			];
			let secondCallMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }> | undefined;
			let callIndex = 0;

			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return {
						reasoning: "I'm thinking about this...",
						code: 'console.log("step 1")',
						toolUseId: "t1",
						reasoningDetails: mockDetails,
					};
				}
				secondCallMessages = [...messages];
				return { reasoning: "Done.", code: 'return "done"', toolUseId: "t2" };
			};

			await press("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const assistantMsg = secondCallMessages!.find(
				(m) => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"),
			);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.meta).toBeDefined();
			expect(assistantMsg!.meta!.reasoningDetails).toEqual(mockDetails);
		});

		it("no reasoningDetails: no meta", async () => {
			let secondCallMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }> | undefined;
			let callIndex = 0;

			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "Step one.", code: 'console.log("hello")', toolUseId: "t1" };
				}
				secondCallMessages = [...messages];
				return { reasoning: "Done.", code: 'return "done"', toolUseId: "t2" };
			};

			await press("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const assistantMsg = secondCallMessages!.find(
				(m) => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"),
			);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.meta).toBeUndefined();
		});
	});

	describe("context stack", () => {
		it("context.__stack exists on object context", async () => {
			let capturedMessages: Array<{ role: string; content: string }> | undefined;
			let callIndex = 0;
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "", code: 'console.log("hasStack=" + (context.__stack !== undefined))\nconsole.log("frames=" + context.__stack.length)', toolUseId: "t1" };
				}
				if (callIndex === 2) capturedMessages = [...messages];
				return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
			};

			await press("test", { key: "value" }, { callLLM });

			const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
			expect(toolResult!.content).toContain("hasStack=true");
			expect(toolResult!.content).toContain("frames=1");
		});

		it("context.__root returns root context", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'console.log("rootKey=" + context.__root.key)\nreturn "child done"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			const result = await press("root task", { key: "rootValue" }, { callLLM, maxDepth: 3 });
			expect(result.answer).toBe("child done");
		});

		it("__ctx is NOT accessible as sandbox global", async () => {
			let capturedMessages: Array<{ role: string; content: string }> | undefined;
			let callIndex = 0;
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "", code: 'console.log("ctxType=" + typeof __ctx)', toolUseId: "t1" };
				}
				capturedMessages = [...messages];
				return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
			};

			await press("root query", { data: "root data" }, { callLLM });

			const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
			expect(toolResult!.content).toContain("ctxType=undefined");
		});

		it("child sees ancestor frames via context.__stack", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'const frames = context.__stack\nconsole.log("childFrameCount=" + frames.length)\nconsole.log("rootData=" + JSON.stringify(frames[0].data))\nreturn "child done"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			const result = await press("parent task", { rootKey: "rootVal" }, { callLLM, maxDepth: 3 });
			expect(result.answer).toBe("child done");
		});

		it("depth-2 grandchild reads depth-0 grandparent context", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "grandchild task") {
					return { reasoning: "", code: 'const frames = context.__stack\nconsole.log("grandchildFrames=" + frames.length)\nconsole.log("rootLabel=" + frames[0].label)\nconsole.log("grandparentData=" + JSON.stringify(frames[0].data))\nreturn "grandchild done"', toolUseId: "tg" };
				}
				if (userMsg === "child task") {
					return { reasoning: "", code: 'const r = await press("grandchild task", { gcKey: "gcVal" })\nreturn r', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			const result = await press("root task", { rootKey: "rootVal" }, { callLLM, maxDepth: 3 });
			expect(result.answer).toBe("grandchild done");
		});

		it("mirror layout: current frame appears twice in system prompt", async () => {
			const systemPrompts: string[] = [];
			const callLLM: CallLLM = async (messages, systemPrompt) => {
				systemPrompts.push(systemPrompt);
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			await press("root task", { rootKey: "rootVal" }, { callLLM, maxDepth: 3, contextLayout: "mirror" });

			const childPrompt = systemPrompts[1];
			expect(childPrompt).toContain("<press-context-stack>");
			const matches = childPrompt.match(/<context depth="1"/g);
			expect(matches).not.toBeNull();
			expect(matches!.length).toBe(2);
		});

		it("cache-efficient layout: frames in depth order", async () => {
			const systemPrompts: string[] = [];
			const callLLM: CallLLM = async (messages, systemPrompt) => {
				systemPrompts.push(systemPrompt);
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			await press("root task", { rootKey: "rootVal" }, { callLLM, maxDepth: 3, contextLayout: "cache-efficient" });

			const childPrompt = systemPrompts[1];
			expect(childPrompt).toContain("<press-context-stack>");
			const depth0Pos = childPrompt.indexOf('<context depth="0"');
			const depth1Pos = childPrompt.indexOf('<context depth="1"');
			expect(depth0Pos).toBeLessThan(depth1Pos);
			const matches0 = childPrompt.match(/<context depth="0"/g);
			const matches1 = childPrompt.match(/<context depth="1"/g);
			expect(matches0!.length).toBe(1);
			expect(matches1!.length).toBe(1);
		});

		it("child stack is read-only (frozen)", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'try { context.__stack.push({}) } catch(e) { console.log("frozen:" + e.message) }\nreturn "child done"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			const result = await press("root task", { rootKey: "rootVal" }, { callLLM, maxDepth: 3 });
			expect(result.answer).toBe("child done");
		});

		it("contextLayout propagates to children by default", async () => {
			const systemPrompts: string[] = [];
			const callLLM: CallLLM = async (messages, systemPrompt) => {
				systemPrompts.push(systemPrompt);
				const userMsg = messages[0]?.content || "";
				if (userMsg === "grandchild") {
					return { reasoning: "", code: 'return "gc done"', toolUseId: "tg" };
				}
				if (userMsg === "child task") {
					return { reasoning: "", code: 'const r = await press("grandchild", { gcKey: "gcVal" })\nreturn r', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await press("child task", { childKey: "childVal" })\nreturn r', toolUseId: "tp" };
			};

			await press("root task", { rootKey: "rootVal" }, { callLLM, maxDepth: 3, contextLayout: "cache-efficient" });

			const grandchildPrompt = systemPrompts[2];
			expect(grandchildPrompt).toContain("<press-context-stack>");
			const depth0Pos = grandchildPrompt.indexOf('<context depth="0"');
			const depth2Pos = grandchildPrompt.indexOf('<context depth="2"');
			expect(depth0Pos).toBeLessThan(depth2Pos);
		});
	});

	describe("auto-resolve file paths in context", () => {
		it("resolves .md file paths to content in system prompt", async () => {
			const tempDir = join(tmpdir(), "press-test-resolve-" + Date.now());
			mkdirSync(tempDir, { recursive: true });
			const testFilePath = join(tempDir, "spec.md");
			writeFileSync(testFilePath, "# Test Spec\n\nThis is the spec content.", "utf8");

			let capturedSystemPrompt = "";
			const callLLM: CallLLM = async (_messages, systemPrompt) => {
				capturedSystemPrompt = systemPrompt;
				return { reasoning: "", code: 'return "done"', toolUseId: "t" };
			};

			try {
				await press("test", { forme_spec: testFilePath, tier: "haiku" }, { callLLM });

				expect(capturedSystemPrompt).toContain("# Test Spec");
				expect(capturedSystemPrompt).toContain("This is the spec content.");
				expect(capturedSystemPrompt).not.toContain(testFilePath);
				expect(capturedSystemPrompt).toContain("tier: haiku");
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("handles missing file gracefully", async () => {
			let capturedSystemPrompt = "";
			const callLLM: CallLLM = async (_messages, systemPrompt) => {
				capturedSystemPrompt = systemPrompt;
				return { reasoning: "", code: 'return "done"', toolUseId: "t" };
			};

			await press("test", { spec: "/nonexistent/path/to/file.md" }, { callLLM });

			expect(capturedSystemPrompt).toContain("[file not found: /nonexistent/path/to/file.md]");
		});

		it("leaves non-path strings unchanged", async () => {
			let capturedSystemPrompt = "";
			const callLLM: CallLLM = async (_messages, systemPrompt) => {
				capturedSystemPrompt = systemPrompt;
				return { reasoning: "", code: 'return "done"', toolUseId: "t" };
			};

			await press("test", { program_dir: "/path/to/fixtures", tier: "haiku", run_dir: ".prose/runs/test" }, { callLLM });

			expect(capturedSystemPrompt).toContain("program_dir: /path/to/fixtures");
			expect(capturedSystemPrompt).toContain("tier: haiku");
			expect(capturedSystemPrompt).toContain("run_dir: .prose/runs/test");
		});
	});

	describe("system prompt documents simplified context API", () => {
		it("documents context.__root and context.__stack", async () => {
			let capturedSystemPrompt = "";
			const callLLM: CallLLM = async (_messages, systemPrompt) => {
				capturedSystemPrompt = systemPrompt;
				return { reasoning: "", code: 'return "done"', toolUseId: "t" };
			};

			await press("test", undefined, { callLLM });

			expect(capturedSystemPrompt).toContain("context.__root");
			expect(capturedSystemPrompt).toContain("context.__stack");
		});

		it("does NOT document __ctx.shared.data or __ctx.stack", async () => {
			let capturedSystemPrompt = "";
			const callLLM: CallLLM = async (_messages, systemPrompt) => {
				capturedSystemPrompt = systemPrompt;
				return { reasoning: "", code: 'return "done"', toolUseId: "t" };
			};

			await press("test", undefined, { callLLM });

			expect(capturedSystemPrompt).not.toContain("__ctx.shared.data");
			expect(capturedSystemPrompt).not.toContain("__ctx.stack.frames");
			expect(capturedSystemPrompt).not.toContain("__ctx.stack.depth");
			expect(capturedSystemPrompt).not.toContain("__ctx.local");
		});
	});
});
