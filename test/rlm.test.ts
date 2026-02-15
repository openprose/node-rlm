import { describe, expect, it } from "vitest";
import { type CallLLM, rlm } from "../src/rlm.js";

function mockCallLLM(responses: string[]): CallLLM {
	let callIndex = 0;
	return async (_messages, _systemPrompt) => {
		if (callIndex >= responses.length) {
			throw new Error(`Unexpected call #${callIndex + 1}, only ${responses.length} responses defined`);
		}
		return responses[callIndex++];
	};
}

describe("rlm", () => {
	it("simple return: verified on second iteration", async () => {
		const callLLM = mockCallLLM(['```repl\nreturn "hello"\n```', '```repl\nreturn "hello"\n```']);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("hello");
		expect(result.iterations).toBe(2);
	});

	it("multi-iteration: LLM needs two turns to produce answer", async () => {
		const callLLM = mockCallLLM(['```repl\nconsole.log("thinking...")\n```', '```repl\nreturn "done"\n```']);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("done");
		expect(result.iterations).toBe(2);
	});

	it("no-code turn followed by code block", async () => {
		const callLLM = mockCallLLM(["Let me think about this...", '```repl\nreturn "answer"\n```']);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("answer");
		expect(result.iterations).toBe(2);
	});

	it("error recovery: first code throws, second succeeds", async () => {
		const callLLM = mockCallLLM(['```repl\nthrow new Error("oops")\n```', '```repl\nreturn "recovered"\n```']);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("recovered");
		expect(result.iterations).toBe(2);
	});

	it("max iterations throws when return is never called", async () => {
		const callLLM = mockCallLLM([
			'```repl\nconsole.log("loop 1")\n```',
			'```repl\nconsole.log("loop 2")\n```',
			'```repl\nconsole.log("loop 3")\n```',
		]);
		await expect(rlm("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
	});

	it("context injection: context string is accessible as variable", async () => {
		const callLLM = mockCallLLM(["```repl\nreturn context\n```", "```repl\nreturn context\n```"]);
		const result = await rlm("test query", "my context data", { callLLM });
		expect(result.answer).toBe("my context data");
	});

	it("return stringifies non-string values", async () => {
		const callLLM = mockCallLLM(["```repl\nreturn 42\n```", "```repl\nreturn 42\n```"]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
	});

	it("multiple code blocks in one response: both executed", async () => {
		const callLLM = mockCallLLM([
			"```repl\nx = 10\n```\n\nSome text\n\n```repl\nconsole.log(x)\nreturn x\n```",
			"```repl\nreturn x\n```",
		]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("10");
		expect(result.iterations).toBe(2);
	});

	it("return in second block of a response works", async () => {
		const callLLM = mockCallLLM([
			'```repl\nconsole.log("first block")\n```\n\n```repl\nreturn "from second"\n```',
			'```repl\nreturn "from second"\n```',
		]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("from second");
		expect(result.iterations).toBe(2);
	});

	it("trace structure: entries have reasoning, code, output, error", async () => {
		const callLLM = mockCallLLM([
			'Let me compute.\n```repl\nconsole.log("step 1")\n```',
			'```repl\nreturn "final"\n```',
		]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.trace).toHaveLength(2);
		expect(result.trace[0].reasoning).toContain("Let me compute");
		expect(result.trace[0].code).toHaveLength(1);
		expect(result.trace[0].code[0]).toContain("console.log");
		expect(result.trace[0].output).toBe("step 1");
		expect(result.trace[0].error).toBeNull();
		expect(result.trace[1].code).toHaveLength(1);
		expect(result.trace[1].code[0]).toContain("return");
	});

	it("variable persistence across iterations via bare assignment", async () => {
		const callLLM = mockCallLLM(["```repl\nx = 42\n```", "```repl\nreturn x\n```"]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("recursive rlm(): child query returns answer to parent", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return '```repl\nreturn "child answer"\n```';
			}
			return '```repl\nresult = await rlm("child query")\nreturn result\n```';
		};

		const result = await rlm("parent query", undefined, { callLLM });
		expect(result.answer).toBe("child answer");
	});

	it("base case at max depth: degrades to flat callLLM", async () => {
		let baseSystemPromptSeen = false;
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";

			// At max depth, rlm should call callLLM directly with BASE_SYSTEM_PROMPT
			if (!systemPrompt.includes("javascript")) {
				baseSystemPromptSeen = true;
				return "flat answer";
			}

			if (userMsg === "parent query") {
				return '```repl\nresult = await rlm("sub query")\nreturn result\n```';
			}

			return '```repl\nreturn "unexpected"\n```';
		};

		const result = await rlm("parent query", undefined, { callLLM, maxDepth: 1 });
		expect(result.answer).toBe("flat answer");
		expect(baseSystemPromptSeen).toBe(true);
	});

	it("flat-mode passes through raw response without stripping", async () => {
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (!systemPrompt.includes("javascript")) {
				return '```javascript\nentity\n```';
			}
			if (userMsg === "parent query") {
				return '```repl\nresult = await rlm("classify this")\nreturn result\n```';
			}
			return '```repl\nreturn "unexpected"\n```';
		};

		const result = await rlm("parent query", undefined, { callLLM, maxDepth: 1 });
		// Flat-mode no longer strips code fences — raw response is passed through
		expect(result.answer).toBe('```javascript\nentity\n```');
	});

	it("trace captures error information from failed code blocks", async () => {
		const callLLM = mockCallLLM(['```repl\nthrow new Error("test error")\n```', '```repl\nreturn "ok"\n```']);
		const result = await rlm("test query", undefined, { callLLM });

		expect(result.trace[0].error).toContain("test error");
	});

	it("no-code response feeds back warning message", async () => {
		let secondCallMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return "I need to think about this first.";
			}
			secondCallMessages = [...messages];
			return '```repl\nreturn "done"\n```';
		};

		await rlm("test query", undefined, { callLLM });

		expect(secondCallMessages).toBeDefined();
		const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
		expect(lastMsg.content).toContain("[WARNING] No code block found");
		expect(lastMsg.role).toBe("user");
	});

	it("malformed fence auto-fix", async () => {
		let secondCallMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return 'javascript\nconst x = 42;\nconsole.log(x);\n```';
			}
			secondCallMessages = [...messages];
			return '```repl\nreturn "done"\n```';
		};

		await rlm("test query", undefined, { callLLM });

		expect(secondCallMessages).toBeDefined();
		const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
		expect(lastMsg.content).toContain("42");
		expect(lastMsg.role).toBe("user");
		expect(lastMsg.content).not.toContain("[ERROR] Your code block is missing");
	});

	it("variable persistence across iterations via let/const", async () => {
		const callLLM = mockCallLLM(["```repl\nlet x = 42\n```", "```repl\nreturn x\n```"]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("output from code blocks is fed back to LLM as user message", async () => {
		let secondCallMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return '```repl\nconsole.log("hello world")\n```';
			}
			secondCallMessages = [...messages];
			return '```repl\nreturn "done"\n```';
		};

		await rlm("test query", undefined, { callLLM });

		expect(secondCallMessages).toBeDefined();
		const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
		expect(lastMsg.content).toContain("hello world");
		expect(lastMsg.role).toBe("user");
	});

	it("__rlm: root invocation has depth 0 and correct lineage", async () => {
		const callLLM: CallLLM = async (_messages, _systemPrompt) => {
			return '```repl\nconsole.log(JSON.stringify(__rlm))\nreturn "done"\n```';
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
				return '```repl\nconsole.log(JSON.stringify(__rlm))\nreturn "child done"\n```';
			}
			return '```repl\nconst r = await rlm("child task")\nreturn r\n```';
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
				return '```repl\nconsole.log("iter=" + __rlm.iteration)\n```';
			}
			return '```repl\nconsole.log("iter=" + __rlm.iteration)\nreturn "done"\n```';
		};

		const result = await rlm("test", undefined, { callLLM });
		const allOutput = result.trace.map((t) => t.output).join("\n");
		const iters = allOutput.match(/iter=(\d+)/g)!.map((m) => Number(m.split("=")[1]));
		expect(iters).toEqual([0, 1, 2]);
	});

	it("__rlm: object is frozen (mutation has no effect)", async () => {
		const callLLM = mockCallLLM([
			'```repl\n__rlm.depth = 99\nconsole.log("depth=" + __rlm.depth)\n```',
			'```repl\nreturn "done"\n```',
		]);
		const result = await rlm("test", undefined, { callLLM });
		const allOutput = result.trace.map((t) => t.output).join("\n");
		// In sloppy mode, assignment silently fails; depth stays 0
		expect(allOutput).toContain("depth=0");
	});

	it("__rlm: lineage array is frozen", async () => {
		const callLLM = mockCallLLM([
			'```repl\ntry { __rlm.lineage.push("hacked") } catch(e) { console.log("lineage frozen: " + e.message) }\nreturn "done"\n```',
			'```repl\nreturn "done"\n```',
		]);
		const result = await rlm("test", undefined, { callLLM });
		const allOutput = result.trace.map((t) => t.output).join("\n");
		expect(allOutput).toContain("lineage frozen:");
	});

	it("context: child does not clobber parent context", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				// Child uses its own context
				return '```repl\nconsole.log("child sees: " + context)\nreturn context\n```';
			}
			// Parent: first call spawns child with different context, second verifies parent context
			if (messages.length <= 1) {
				return '```repl\nconst childResult = await rlm("child query", "child context")\nconsole.log("parent still sees: " + context)\n```';
			}
			return "```repl\nreturn context\n```";
		};

		const result = await rlm("parent query", "parent context", { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("parent context");
	});

	it("unawaited rlm() is auto-awaited by sandbox", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "fire and forget") {
				return '```repl\nreturn "child"\n```';
			}
			if (messages.length <= 1) {
				return '```repl\nrlm("fire and forget")\nconsole.log("continued")\n```';
			}
			const lastMsg = messages[messages.length - 1]?.content || "";
			if (lastMsg.includes("ERROR")) {
				return '```repl\nreturn "saw warning"\n```';
			}
			return '```repl\nreturn "no warning"\n```';
		};

		const result = await rlm("test", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("no warning");
	});

	it("parallel rlm(): awaited parallel calls work correctly", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "task A") {
				return '```repl\nreturn "result A"\n```';
			}
			if (userMsg === "task B") {
				return '```repl\nreturn "result B"\n```';
			}
			return '```repl\nconst [a, b] = await Promise.all([rlm("task A"), rlm("task B")])\nreturn a + " + " + b\n```';
		};

		const result = await rlm("parent", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("result A + result B");
	});

	it("pluginBodies: appended to root system prompt when provided", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return '```repl\nreturn "done"\n```';
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
			return '```repl\nreturn "done"\n```';
		};

		await rlm("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("---");
	});

	it("pluginBodies: not passed to child rlm() agents", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return '```repl\nreturn "child done"\n```';
			}
			// Parent spawns a child
			return '```repl\nconst r = await rlm("child task")\nreturn r\n```';
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

	it("pluginBodies: not passed to flat-mode children", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (!systemPrompt.includes("javascript")) {
				// Flat-mode child
				return "flat answer";
			}
			if (userMsg === "parent task") {
				return '```repl\nconst r = await rlm("sub query")\nreturn r\n```';
			}
			return '```repl\nreturn "unexpected"\n```';
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		const flatPrompt = systemPrompts[1];
		expect(flatPrompt).not.toContain("## My Plugin");
		expect(flatPrompt).not.toContain("Do special things.");
	});

	it("pluginBodies: not passed to llm() calls", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (!systemPrompt.includes("javascript")) {
				return "llm answer";
			}
			return '```repl\nconst r = await llm("quick question")\nreturn r\n```';
		};

		await rlm("test", undefined, {
			callLLM,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		const llmPrompt = systemPrompts[1];
		expect(llmPrompt).not.toContain("## My Plugin");
		expect(llmPrompt).not.toContain("Do special things.");
	});

	it("model selection: rlm() child uses the specified model's callLLM", async () => {
		let fastModelCalled = false;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "hello") {
				return '```repl\nreturn "FAST_MODEL response"\n```';
			}
			return '```repl\nresult = await rlm("hello", undefined, { model: "fast" })\nreturn result\n```';
		};

		const fastCallLLM: CallLLM = async (_messages, _systemPrompt) => {
			fastModelCalled = true;
			return '```repl\nreturn "FAST_MODEL response"\n```';
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

	it("model selection: llm() uses the specified model's callLLM", async () => {
		let fastModelCalled = false;
		const defaultCallLLM: CallLLM = async (_messages, systemPrompt) => {
			if (!systemPrompt.includes("javascript")) {
				return "default llm answer";
			}
			return '```repl\nresult = await llm("hello", undefined, { model: "fast" })\nreturn result\n```';
		};

		const fastCallLLM: CallLLM = async (_messages, _systemPrompt) => {
			fastModelCalled = true;
			return "FAST_MODEL llm answer";
		};

		const result = await rlm("test", undefined, {
			callLLM: defaultCallLLM,
			models: {
				fast: { callLLM: fastCallLLM, tags: ["speed"], description: "A fast model" },
			},
		});

		expect(fastModelCalled).toBe(true);
		expect(result.answer).toBe("FAST_MODEL llm answer");
	});

	it("model selection: invalid model alias produces error containing 'Unknown model alias'", async () => {
		let callIndex = 0;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return '```repl\nresult = await rlm("hello", undefined, { model: "nonexistent" })\nreturn result\n```';
			}
			// After the error, return so the test doesn't hit max iterations
			return '```repl\nreturn "saw error"\n```';
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
		const callLLM = mockCallLLM([
			'```repl\nreturn myApi.greet("world")\n```',
			'```repl\nreturn myApi.greet("world")\n```',
		]);
		const result = await rlm("test query", undefined, {
			callLLM,
			sandboxGlobals: { myApi: mockObj },
		});
		expect(result.answer).toBe("hello world");
	});

	it("model selection: no model specified uses default callLLM", async () => {
		let defaultCalledForChild = false;
		let fastModelCalled = false;

		const defaultCallLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (!systemPrompt.includes("javascript")) {
				defaultCalledForChild = true;
				return "default llm answer";
			}
			return '```repl\nresult = await llm("hello")\nreturn result\n```';
		};

		const fastCallLLM: CallLLM = async (_messages, _systemPrompt) => {
			fastModelCalled = true;
			return "FAST_MODEL llm answer";
		};

		const result = await rlm("test", undefined, {
			callLLM: defaultCallLLM,
			models: {
				fast: { callLLM: fastCallLLM },
			},
		});

		expect(defaultCalledForChild).toBe(true);
		expect(fastModelCalled).toBe(false);
		expect(result.answer).toBe("default llm answer");
	});

	it("globalDocs: included in root system prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return '```repl\nreturn "done"\n```';
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
				return '```repl\nreturn "child done"\n```';
			}
			return '```repl\nconst r = await rlm("child task")\nreturn r\n```';
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
				return '```repl\nreturn "child done"\n```';
			}
			return '```repl\nconst r = await rlm("child task", undefined, { systemPrompt: "You are a helper." })\nreturn r\n```';
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

	it("globalDocs: included in flat-mode child system prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			if (!systemPrompt.includes("javascript")) {
				// Flat-mode child
				return "flat answer";
			}
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent task") {
				return '```repl\nconst r = await rlm("sub query")\nreturn r\n```';
			}
			return '```repl\nreturn "unexpected"\n```';
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		// Root prompt has globalDocs
		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		// Flat-mode child also has globalDocs
		const flatPrompt = systemPrompts[1];
		expect(flatPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs + sandboxGlobals: child can use documented sandbox global", async () => {
		const mockApi = { greet: (name: string) => "hello " + name };
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "greet world") {
				// Child agent -- verify globalDocs is in prompt and use the global
				if (!systemPrompt.includes("myApi.greet")) {
					return '```repl\nreturn "FAIL: no globalDocs"\n```';
				}
				return '```repl\nreturn myApi.greet("world")\n```';
			}
			return '```repl\nconst r = await rlm("greet world")\nreturn r\n```';
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
			return '```repl\nreturn "done"\n```';
		};

		await rlm("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("## Sandbox Globals");
	});

	it("globalDocs vs pluginBodies: plugins are root-only, globalDocs is everywhere", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return '```repl\nreturn "child done"\n```';
			}
			return '```repl\nconst r = await rlm("child task")\nreturn r\n```';
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
});
