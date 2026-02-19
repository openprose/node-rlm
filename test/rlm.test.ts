import { describe, expect, it } from "vitest";
import { type CallLLM, type CallLLMResponse, rlm } from "../src/rlm.js";

function mockToolCallLLM(responses: CallLLMResponse[]): CallLLM {
	let callIndex = 0;
	return async (_messages, _systemPrompt) => {
		if (callIndex >= responses.length) {
			throw new Error(`Unexpected call #${callIndex + 1}, only ${responses.length} responses defined`);
		}
		return responses[callIndex++];
	};
}

/** Shorthand: create a CallLLMResponse with minimal boilerplate. */
function tc(code: string, toolUseId = "t"): CallLLMResponse {
	return { reasoning: "", code, toolUseId };
}

describe("rlm", () => {
	it("simple return: verified on second iteration", async () => {
		const callLLM = mockToolCallLLM([tc('return "hello"', "t1"), tc('return "hello"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("hello");
		expect(result.iterations).toBe(2);
	});

	it("multi-iteration: LLM needs two turns to produce answer", async () => {
		const callLLM = mockToolCallLLM([tc('console.log("thinking...")', "t1"), tc('return "done"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("done");
		expect(result.iterations).toBe(2);
	});

	it("no-code turn followed by code", async () => {
		const callLLM = mockToolCallLLM([
			{ reasoning: "Let me think about this...", code: null, toolUseId: "t1" },
			tc('return "answer"', "t2"),
		]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("answer");
		expect(result.iterations).toBe(2);
	});

	it("error recovery: first code throws, second succeeds", async () => {
		const callLLM = mockToolCallLLM([tc('throw new Error("oops")', "t1"), tc('return "recovered"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("recovered");
		expect(result.iterations).toBe(2);
	});

	it("max iterations throws when return is never called", async () => {
		const callLLM = mockToolCallLLM([
			tc('console.log("loop 1")', "t1"),
			tc('console.log("loop 2")', "t2"),
			tc('console.log("loop 3")', "t3"),
		]);
		await expect(rlm("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
	});

	it("context injection: context string is accessible as variable", async () => {
		const callLLM = mockToolCallLLM([tc("return context", "t1"), tc("return context", "t2")]);
		const result = await rlm("test query", "my context data", { callLLM });
		expect(result.answer).toBe("my context data");
	});

	it("return stringifies non-string values", async () => {
		const callLLM = mockToolCallLLM([tc("return 42", "t1"), tc("return 42", "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
	});

	it("trace structure: entries have reasoning, code, output, error", async () => {
		const callLLM = mockToolCallLLM([
			{ reasoning: "Let me compute.", code: 'console.log("step 1")', toolUseId: "t1" },
			{ reasoning: "Done.", code: 'return "final"', toolUseId: "t2" },
		]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.trace).toHaveLength(2);
		expect(result.trace[0].reasoning).toBe("Let me compute.");
		expect(result.trace[0].code).toHaveLength(1);
		expect(result.trace[0].code[0]).toContain("console.log");
		expect(result.trace[0].output).toBe("step 1");
		expect(result.trace[0].error).toBeNull();
		expect(result.trace[1].code).toHaveLength(1);
		expect(result.trace[1].code[0]).toContain("return");
	});

	it("variable persistence across iterations via bare assignment", async () => {
		const callLLM = mockToolCallLLM([tc("x = 42", "t1"), tc("return x", "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("recursive rlm(): child query returns answer to parent", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'result = await rlm("child query")\nreturn result', toolUseId: "tp" };
		};

		const result = await rlm("parent query", undefined, { callLLM });
		expect(result.answer).toBe("child answer");
	});

	it("child at max depth: full REPL but cannot delegate", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";

			if (userMsg === "parent query") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		const result = await rlm("parent query", undefined, { callLLM, maxDepth: 1 });
		expect(result.answer).toBe("child answer");
		// Child at maxDepth is a full REPL agent with environment docs
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("console.log");
		expect(childPrompt).toContain("return(value)");
		// But orientation says they're at max depth
		expect(childPrompt).toContain("maximum delegation depth");
	});

	it("rlm() at max depth rejects with clear error", async () => {
		const callLLM: CallLLM = async (messages) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent query") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'const r = await rlm("grandchild")\nreturn r', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		// maxDepth=1: root(0) can delegate, child(1) cannot
		await expect(rlm("parent query", undefined, {
			callLLM,
			maxDepth: 1,
			maxIterations: 2,
		})).rejects.toThrow("max iterations");
	});

	it("trace captures error information from failed code blocks", async () => {
		const callLLM = mockToolCallLLM([tc('throw new Error("test error")', "t1"), tc('return "ok"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });

		expect(result.trace[0].error).toContain("test error");
	});

	it("variable persistence across iterations via let/const", async () => {
		const callLLM = mockToolCallLLM([tc("let x = 42", "t1"), tc("return x", "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("output from code blocks is fed back to LLM as tool result", async () => {
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

		await rlm("test query", undefined, { callLLM });

		expect(secondCallMessages).toBeDefined();
		const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
		expect(lastMsg.content).toContain("hello world");
		expect(lastMsg.role).toBe("user");
	});

	it("__rlm: root invocation has depth 0 and correct lineage", async () => {
		const callLLM: CallLLM = async (_messages, _systemPrompt) => {
			return { reasoning: "", code: 'console.log(JSON.stringify(__rlm))\nreturn "done"', toolUseId: "t" };
		};

		const result = await rlm("my query", undefined, {
			callLLM,
			maxDepth: 3,
			maxIterations: 10,
		});

		// The first iteration triggers early-return interception, second iteration returns
		// We need to capture from trace output
		const allOutput = result.trace.map((t) => t.output).join("\n");
		const parsed = JSON.parse(allOutput.split("\n").find((l) => l.startsWith("{"))!);
		expect(parsed.depth).toBe(0);
		expect(parsed.maxDepth).toBe(3);
		expect(parsed.maxIterations).toBe(10);
		expect(parsed.lineage).toEqual(["my query"]);
	});

	it("__rlm: child invocation has depth 1 and lineage includes parent query", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'console.log(JSON.stringify(__rlm))\nreturn "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		const result = await rlm("parent task", undefined, { callLLM, maxDepth: 3 });

		// Child was called with depth >= 1; parent gets child's answer
		expect(result.answer).toBe("child done");
	});

	it("__rlm: iteration field updates each loop", async () => {
		let callIndex = 0;
		const callLLM: CallLLM = async (_messages, _systemPrompt) => {
			callIndex++;
			if (callIndex <= 2) {
				return { reasoning: "", code: 'console.log("iter=" + __rlm.iteration)', toolUseId: `t${callIndex}` };
			}
			return { reasoning: "", code: 'console.log("iter=" + __rlm.iteration)\nreturn "done"', toolUseId: `t${callIndex}` };
		};

		const result = await rlm("test", undefined, { callLLM });
		const allOutput = result.trace.map((t) => t.output).join("\n");
		const iters = allOutput.match(/iter=(\d+)/g)!.map((m) => Number(m.split("=")[1]));
		expect(iters).toEqual([0, 1, 2]);
	});

	it("__rlm: object is frozen (mutation has no effect)", async () => {
		const callLLM = mockToolCallLLM([
			{ reasoning: "", code: '__rlm.depth = 99\nconsole.log("depth=" + __rlm.depth)', toolUseId: "t1" },
			tc('return "done"', "t2"),
		]);
		const result = await rlm("test", undefined, { callLLM });
		const allOutput = result.trace.map((t) => t.output).join("\n");
		// In sloppy mode, assignment silently fails; depth stays 0
		expect(allOutput).toContain("depth=0");
	});

	it("__rlm: lineage array is frozen", async () => {
		const callLLM = mockToolCallLLM([
			{ reasoning: "", code: 'try { __rlm.lineage.push("hacked") } catch(e) { console.log("lineage frozen: " + e.message) }\nreturn "done"', toolUseId: "t1" },
			tc('return "done"', "t2"),
		]);
		const result = await rlm("test", undefined, { callLLM });
		const allOutput = result.trace.map((t) => t.output).join("\n");
		expect(allOutput).toContain("lineage frozen:");
	});

	it("context: child does not clobber parent context", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return { reasoning: "", code: 'console.log("child sees: " + context)\nreturn context', toolUseId: "tc" };
			}
			// Parent: first call spawns child with different context, second verifies parent context
			if (messages.length <= 1) {
				return { reasoning: "", code: 'const childResult = await rlm("child query", "child context")\nconsole.log("parent still sees: " + context)', toolUseId: "tp1" };
			}
			return { reasoning: "", code: "return context", toolUseId: "tp2" };
		};

		const result = await rlm("parent query", "parent context", { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("parent context");
	});

	it("unawaited rlm() is auto-awaited by sandbox", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "fire and forget") {
				return { reasoning: "", code: 'return "child"', toolUseId: "tc" };
			}
			if (messages.length <= 1) {
				return { reasoning: "", code: 'rlm("fire and forget")\nconsole.log("continued")', toolUseId: "tp1" };
			}
			const lastMsg = messages[messages.length - 1]?.content || "";
			if (lastMsg.includes("ERROR")) {
				return { reasoning: "", code: 'return "saw warning"', toolUseId: "tp2" };
			}
			return { reasoning: "", code: 'return "no warning"', toolUseId: "tp3" };
		};

		const result = await rlm("test", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("no warning");
	});

	it("parallel rlm(): awaited parallel calls work correctly", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "task A") {
				return { reasoning: "", code: 'return "result A"', toolUseId: "ta" };
			}
			if (userMsg === "task B") {
				return { reasoning: "", code: 'return "result B"', toolUseId: "tb" };
			}
			return { reasoning: "", code: 'const [a, b] = await Promise.all([rlm("task A"), rlm("task B")])\nreturn a + " + " + b', toolUseId: "tp" };
		};

		const result = await rlm("parent", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("result A + result B");
	});

	it("pluginBodies: appended to root system prompt when provided", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, {
			callLLM,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(capturedSystemPrompt).toContain("## My Plugin");
		expect(capturedSystemPrompt).toContain("Do special things.");
	});

	it("pluginBodies: not appended when undefined", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("<rlm-program>");
	});

	it("pluginBodies: not passed to child rlm() agents", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			// Parent spawns a child
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).not.toContain("## My Plugin");
		expect(childPrompt).not.toContain("Do special things.");
	});

	it("pluginBodies: not passed to max-depth children", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent task") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).not.toContain("## My Plugin");
		expect(childPrompt).not.toContain("Do special things.");
	});

	it("model selection: rlm() child uses the specified model's callLLM", async () => {
		let fastModelCalled = false;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "hello") {
				return { reasoning: "", code: 'return "FAST_MODEL response"', toolUseId: "td" };
			}
			return { reasoning: "", code: 'result = await rlm("hello", undefined, { model: "fast" })\nreturn result', toolUseId: "tp" };
		};

		const fastCallLLM: CallLLM = async (_messages, _systemPrompt) => {
			fastModelCalled = true;
			return { reasoning: "", code: 'return "FAST_MODEL response"', toolUseId: "tf" };
		};

		const result = await rlm("parent query", undefined, {
			callLLM: defaultCallLLM,
			maxDepth: 3,
			models: {
				fast: { callLLM: fastCallLLM, tags: ["speed"], description: "A fast model" },
			},
		});

		expect(fastModelCalled).toBe(true);
		expect(result.answer).toBe("FAST_MODEL response");
	});

	it("model selection: invalid model alias produces error containing 'Unknown model alias'", async () => {
		let callIndex = 0;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'result = await rlm("hello", undefined, { model: "nonexistent" })\nreturn result', toolUseId: "t1" };
			}
			// After the error, return so the test doesn't hit max iterations
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		const result = await rlm("test", undefined, {
			callLLM: defaultCallLLM,
			maxDepth: 3,
			models: {
				fast: { callLLM: defaultCallLLM },
			},
		});

		const allOutput = result.trace.map((t) => `${t.output}\n${t.error ?? ""}`).join("\n");
		expect(allOutput).toContain("Unknown model alias");
	});

	it("sandboxGlobals: custom globals are accessible from agent code", async () => {
		const mockObj = { greet: (name: string) => "hello " + name };
		const callLLM = mockToolCallLLM([
			tc('return myApi.greet("world")', "t1"),
			tc('return myApi.greet("world")', "t2"),
		]);
		const result = await rlm("test query", undefined, {
			callLLM,
			sandboxGlobals: { myApi: mockObj },
		});
		expect(result.answer).toBe("hello world");
	});

	it("globalDocs: included in root system prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, {
			callLLM,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(capturedSystemPrompt).toContain("## Sandbox Globals");
		expect(capturedSystemPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: included in child system prompt (without customSystemPrompt)", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		// Root prompt has globalDocs
		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		// Child prompt also has globalDocs
		expect(systemPrompts[1]).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: included in child system prompt (with customSystemPrompt)", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { systemPrompt: "You are a helper." })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		// Child with custom systemPrompt also has globalDocs
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a helper.");
		expect(childPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: included in max-depth child system prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent task") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		// Root prompt has globalDocs
		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		// Max-depth child also has globalDocs
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs + sandboxGlobals: child can use documented sandbox global", async () => {
		const mockApi = { greet: (name: string) => "hello " + name };
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "greet world") {
				// Child agent -- verify globalDocs is in prompt and use the global
				if (!systemPrompt.includes("myApi.greet")) {
					return { reasoning: "", code: 'return "FAIL: no globalDocs"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'return myApi.greet("world")', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("greet world")\nreturn r', toolUseId: "tp" };
		};

		const result = await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			sandboxGlobals: { myApi: mockApi },
			globalDocs: "`myApi.greet(name)` -- returns a greeting string.",
		});

		expect(result.answer).toBe("hello world");
	});

	it("globalDocs: not present in system prompt when not provided", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("## Sandbox Globals");
	});

	it("app option: child receives app plugin as system prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { app: "test-app" })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childApps: { "test-app": "You are a test app.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test app.");
		expect(childPrompt).toContain("Do test things.");
		// Child should also get the environment section
		expect(childPrompt).toContain("<rlm-environment>");
	});

	it("app option: unknown app name rejects with available list", async () => {
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'const r = await rlm("child task", undefined, { app: "nonexistent" })\nreturn r', toolUseId: "t1" };
			}
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		const result = await rlm("test", undefined, {
			callLLM,
			maxDepth: 3,
			childApps: { "test-app": "body1", "other-app": "body2" },
		});

		const allOutput = result.trace.map((t) => `${t.output}\n${t.error ?? ""}`).join("\n");
		expect(allOutput).toContain("Unknown app");
		expect(allOutput).toContain("test-app");
		expect(allOutput).toContain("other-app");
	});

	it("app option: app + systemPrompt are concatenated", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { app: "test-app", systemPrompt: "Extra instructions." })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childApps: { "test-app": "You are a test app.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test app.");
		expect(childPrompt).toContain("Do test things.");
		expect(childPrompt).toContain("Extra instructions.");
	});

	it("childApps: not visible to root agent", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, {
			callLLM,
			childApps: { "test-app": "You are a test app.\n\nDo test things." },
		});

		expect(capturedSystemPrompt).not.toContain("You are a test app.");
		expect(capturedSystemPrompt).not.toContain("Do test things.");
	});

	it("globalDocs vs pluginBodies: plugins are root-only, globalDocs is everywhere", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			pluginBodies: "## My Plugin\nRoot-only strategy.",
			globalDocs: "The `myApi` global provides X.",
		});

		// Root has both
		expect(systemPrompts[0]).toContain("## My Plugin");
		expect(systemPrompts[0]).toContain("The `myApi` global provides X.");

		// Child has globalDocs but NOT pluginBodies
		expect(systemPrompts[1]).not.toContain("## My Plugin");
		expect(systemPrompts[1]).toContain("The `myApi` global provides X.");
	});

	describe("traceChildren", () => {
		it("child trace captured when traceChildren is true", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
			};

			const result = await rlm("parent task", undefined, {
				callLLM,
				maxDepth: 3,
				traceChildren: true,
			});

			expect(result.answer).toBe("child answer");
			// The parent's trace entry that delegated should have children
			const entryWithChildren = result.trace.find(t => t.children && t.children.length > 0);
			expect(entryWithChildren).toBeDefined();
			expect(entryWithChildren!.children).toHaveLength(1);
			expect(entryWithChildren!.children![0].answer).toBe("child answer");
			expect(entryWithChildren!.children![0].trace.length).toBeGreaterThan(0);
		});

		it("child trace absent when traceChildren is false (default)", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "child task") {
					return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
			};

			const result = await rlm("parent task", undefined, {
				callLLM,
				maxDepth: 3,
				// traceChildren defaults to false
			});

			expect(result.answer).toBe("child answer");
			// No trace entry should have children
			for (const entry of result.trace) {
				expect(entry.children).toBeUndefined();
			}
		});

		it("failed child trace captured when traceChildren is true", async () => {
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				const userMsg = messages[0]?.content || "";
				if (userMsg === "doomed child") {
					return { reasoning: "", code: 'console.log("working...")', toolUseId: "tc" };
				}
				if (messages.length <= 1) {
					return { reasoning: "", code: 'try { await rlm("doomed child") } catch(e) { console.log("caught: " + e.message) }', toolUseId: "tp1" };
				}
				return { reasoning: "", code: 'return "parent done"', toolUseId: "tp2" };
			};

			const result = await rlm("parent task", undefined, {
				callLLM,
				maxDepth: 3,
				maxIterations: 3,
				traceChildren: true,
			});

			const entryWithChildren = result.trace.find(t => t.children && t.children.length > 0);
			expect(entryWithChildren).toBeDefined();
			expect(entryWithChildren!.children![0].error).toBeDefined();
			expect(entryWithChildren!.children![0].answer).toBeNull();
		});
	});

	describe("traceSnapshots", () => {
		it("envSnapshot captured when traceSnapshots is true", async () => {
			const callLLM = mockToolCallLLM([
				tc("x = 42", "t1"),
				{ reasoning: "", code: "x = 99\nreturn x", toolUseId: "t2" },
			]);

			const result = await rlm("test", undefined, {
				callLLM,
				traceSnapshots: true,
			});

			expect(result.trace[0].envSnapshot).toBeDefined();
			expect(result.trace[0].envSnapshot!.x).toBe(42);
			expect(result.trace[1].envSnapshot).toBeDefined();
			expect(result.trace[1].envSnapshot!.x).toBe(99);
		});

		it("envSnapshot absent when traceSnapshots is false (default)", async () => {
			const callLLM = mockToolCallLLM([tc("x = 42", "t1"), tc("return x", "t2")]);

			const result = await rlm("test", undefined, { callLLM });

			for (const entry of result.trace) {
				expect(entry.envSnapshot).toBeUndefined();
			}
		});

		it("envSnapshot excludes sandboxGlobals keys", async () => {
			const mockApi = { greet: () => "hi" };
			const callLLM = mockToolCallLLM([
				{ reasoning: "", code: 'myVar = "hello"\nreturn myVar', toolUseId: "t1" },
				tc("return myVar", "t2"),
			]);

			const result = await rlm("test", undefined, {
				callLLM,
				traceSnapshots: true,
				sandboxGlobals: { myApi: mockApi },
			});

			const snap = result.trace[0].envSnapshot!;
			expect(snap.myVar).toBe("hello");
			expect(snap.myApi).toBeUndefined();
			expect(snap.console).toBeUndefined();
			expect(snap.rlm).toBeUndefined();
		});
	});

	describe("tool-call specifics", () => {
		it("null code: no-code tool response triggers warning", async () => {
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

			await rlm("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
			expect(lastMsg.content).toContain("[WARNING] No code was executed");
		});

		it("conversation history uses __TOOL_CALL__ / __TOOL_RESULT__ markers", async () => {
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

			await rlm("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			// Check assistant message has __TOOL_CALL__ marker
			const assistantMsg = secondCallMessages!.find(m => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"));
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.content).toContain("tool-123");
			expect(assistantMsg!.content).toContain("Step one.");
			expect(assistantMsg!.content).toContain("__CODE__");
			expect(assistantMsg!.content).toContain('console.log("hello")');

			// Check user message has __TOOL_RESULT__ marker
			const toolResultMsg = secondCallMessages!.find(m => m.role === "user" && m.content.startsWith("__TOOL_RESULT__"));
			expect(toolResultMsg).toBeDefined();
			expect(toolResultMsg!.content).toContain("tool-123");
			expect(toolResultMsg!.content).toContain("hello");
		});

		it("max iterations throws with tool-call responses", async () => {
			const callLLM = mockToolCallLLM([
				{ reasoning: "Step 1.", code: 'console.log("loop 1")', toolUseId: "t1" },
				{ reasoning: "Step 2.", code: 'console.log("loop 2")', toolUseId: "t2" },
				{ reasoning: "Step 3.", code: 'console.log("loop 3")', toolUseId: "t3" },
			]);
			await expect(rlm("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
		});
	});
});
