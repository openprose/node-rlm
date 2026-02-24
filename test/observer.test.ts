import { describe, expect, it } from "vitest";
import type { CallLLM, CallLLMResponse } from "../src/rlm.js";
import { rlm, RlmMaxIterationsError } from "../src/rlm.js";
import type { RlmEvent, RlmEventSink } from "../src/events.js";
import { RlmObserver } from "../src/observer.js";

function collector(): { events: RlmEvent[]; sink: RlmEventSink } {
	const events: RlmEvent[] = [];
	return { events, sink: { emit: (e) => events.push(e) } };
}

function mockToolCallLLM(responses: CallLLMResponse[]): CallLLM {
	let callIndex = 0;
	return async () => {
		if (callIndex >= responses.length) {
			throw new Error(`Unexpected call #${callIndex + 1}`);
		}
		return responses[callIndex++];
	};
}

function tc(code: string, toolUseId = "t"): CallLLMResponse {
	return { reasoning: "", code, toolUseId };
}

describe("observer events", () => {
	it("happy path: correct order and fields", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			tc('console.log("step 1")', "t1"),
			tc('return "done"', "t2"),
		]);

		const result = await rlm("test query", undefined, {
			callLLM,
			observer: sink,
		});

		expect(result.answer).toBe("done");

		const types = events.map((e) => e.type);
		expect(types[0]).toBe("run:start");
		expect(types[1]).toBe("invocation:start");
		expect(types[2]).toBe("iteration:start");
		expect(types[3]).toBe("llm:request");
		expect(types[4]).toBe("llm:response");
		// iteration 0: early return intercepted, so iteration:end follows
		expect(types).toContain("iteration:end");
		expect(types).toContain("sandbox:snapshot");
		expect(types.at(-2)).toBe("invocation:end");
		expect(types.at(-1)).toBe("run:end");

		// All events share the same runId
		const runId = events[0].runId;
		expect(runId).toBeTruthy();
		for (const e of events) {
			expect(e.runId).toBe(runId);
			expect(e.timestamp).toBeGreaterThan(0);
			expect(e.invocationId).toBeTruthy();
		}

		// run:end has the answer
		const runEnd = events.find((e) => e.type === "run:end")!;
		expect(runEnd.type === "run:end" && runEnd.answer).toBe("done");
		expect(runEnd.type === "run:end" && runEnd.error).toBeNull();
	});

	it("iteration:start count equals iteration:end count", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			tc('console.log("a")', "t1"),
			tc('console.log("b")', "t2"),
			tc('return "done"', "t3"),
		]);

		await rlm("test", undefined, { callLLM, observer: sink });

		const starts = events.filter((e) => e.type === "iteration:start");
		const ends = events.filter((e) => e.type === "iteration:end");
		expect(starts.length).toBe(ends.length);
		expect(starts.length).toBe(3);
	});

	it("llm:error fires when callLLM throws", async () => {
		const { events, sink } = collector();
		let callIndex = 0;
		const callLLM: CallLLM = async () => {
			callIndex++;
			if (callIndex === 1) {
				throw new Error("API down");
			}
			return tc('return "ok"', "t1");
		};

		try {
			await rlm("test", undefined, { callLLM, observer: sink });
		} catch {
			// expected
		}

		const llmErrors = events.filter((e) => e.type === "llm:error");
		expect(llmErrors.length).toBe(1);
		expect(llmErrors[0].type === "llm:error" && llmErrors[0].error).toBe("API down");
		expect(llmErrors[0].type === "llm:error" && llmErrors[0].duration).toBeGreaterThanOrEqual(0);

		// iteration:end fires with error
		const iterEnd = events.find((e) => e.type === "iteration:end");
		expect(iterEnd).toBeDefined();
		expect(iterEnd!.type === "iteration:end" && iterEnd!.error).toBe("API down");
		expect(iterEnd!.type === "iteration:end" && iterEnd!.returned).toBe(false);

		// invocation:end fires with error
		const invEnd = events.find((e) => e.type === "invocation:end");
		expect(invEnd).toBeDefined();
		expect(invEnd!.type === "invocation:end" && invEnd!.error).toBe("API down");

		// run:end fires with error
		const runEnd = events.find((e) => e.type === "run:end");
		expect(runEnd).toBeDefined();
		expect(runEnd!.type === "run:end" && runEnd!.error).toBe("API down");
	});

	it("max iterations: invocation:end and run:end fire with error", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			tc('console.log("loop")', "t1"),
			tc('console.log("loop")', "t2"),
		]);

		await expect(
			rlm("test", undefined, { callLLM, maxIterations: 2, observer: sink }),
		).rejects.toThrow("max iterations");

		const invEnd = events.find((e) => e.type === "invocation:end");
		expect(invEnd!.type === "invocation:end" && invEnd!.error).toContain("max iterations");

		const runEnd = events.find((e) => e.type === "run:end");
		expect(runEnd!.type === "run:end" && runEnd!.error).toContain("max iterations");
		expect(runEnd!.type === "run:end" && runEnd!.answer).toBeNull();
	});

	it("delegation events fire for child rlm() calls", async () => {
		const { events, sink } = collector();
		const callLLM: CallLLM = async (messages) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return tc('return "child answer"', "tc");
			}
			return tc('result = await rlm("child query")\nreturn result', "tp");
		};

		const result = await rlm("parent query", undefined, {
			callLLM,
			observer: sink,
		});
		expect(result.answer).toBe("child answer");

		// Parent runs iteration 0 (early return intercepted) + iteration 1, each spawning a child
		const spawns = events.filter((e) => e.type === "delegation:spawn");
		expect(spawns.length).toBe(2);
		expect(spawns[0].type === "delegation:spawn" && spawns[0].query).toBe("child query");

		const returns = events.filter((e) => e.type === "delegation:return");
		expect(returns.length).toBe(2);
		expect(returns[0].type === "delegation:return" && returns[0].answer).toBe("child answer");

		// Root + 2 children = 3 invocations
		const invStarts = events.filter((e) => e.type === "invocation:start");
		expect(invStarts.length).toBe(3);
	});

	it("sandbox:snapshot fires after each iteration", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			tc("x = 42", "t1"),
			tc('return "done"', "t2"),
		]);

		await rlm("test", undefined, { callLLM, observer: sink });

		const snapshots = events.filter((e) => e.type === "sandbox:snapshot");
		const iterEnds = events.filter((e) => e.type === "iteration:end");
		expect(snapshots.length).toBe(iterEnds.length);

		// Snapshot contains sandbox state
		const snap = snapshots[0];
		expect(snap.type === "sandbox:snapshot" && snap.state).toBeDefined();
	});

	it("no observer: rlm works normally without events", async () => {
		const callLLM = mockToolCallLLM([
			tc('return "hello"', "t1"),
			tc('return "hello"', "t2"),
		]);
		const result = await rlm("test", undefined, { callLLM });
		expect(result.answer).toBe("hello");
	});

	it("llm:request includes message count and system prompt length", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			tc('console.log("a")', "t1"),
			tc('return "done"', "t2"),
		]);

		await rlm("test", undefined, { callLLM, observer: sink });

		const requests = events.filter((e) => e.type === "llm:request");
		expect(requests.length).toBeGreaterThanOrEqual(2);

		// First request has 1 message (the user query)
		expect(requests[0].type === "llm:request" && requests[0].messageCount).toBe(1);
		expect(requests[0].type === "llm:request" && requests[0].systemPromptLength).toBeGreaterThan(0);

		// Second request has more messages
		expect(requests[1].type === "llm:request" && requests[1].messageCount).toBeGreaterThan(1);
	});

	it("llm:response includes reasoning and code", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			{ reasoning: "Let me think", code: 'console.log("a")', toolUseId: "t1" },
			tc('return "done"', "t2"),
		]);

		await rlm("test", undefined, { callLLM, observer: sink });

		const responses = events.filter((e) => e.type === "llm:response");
		expect(responses[0].type === "llm:response" && responses[0].reasoning).toBe("Let me think");
		expect(responses[0].type === "llm:response" && responses[0].code).toBe('console.log("a")');
		expect(responses[0].type === "llm:response" && responses[0].duration).toBeGreaterThanOrEqual(0);
	});

	it("iteration:end has returned=true on normal return", async () => {
		const { events, sink } = collector();
		const callLLM = mockToolCallLLM([
			tc('console.log("a")', "t1"),
			tc('return "done"', "t2"),
		]);

		await rlm("test", undefined, { callLLM, observer: sink });

		const iterEnds = events.filter((e) => e.type === "iteration:end");
		// Last iteration:end should have returned=true
		const last = iterEnds[iterEnds.length - 1];
		expect(last.type === "iteration:end" && last.returned).toBe(true);
		// First iteration should have returned=false (early return intercepted on iter 0)
		expect(iterEnds[0].type === "iteration:end" && iterEnds[0].returned).toBe(false);
	});
});

// --- RlmObserver unit tests ---

function fakeEvent(overrides: Partial<RlmEvent> & { type: RlmEvent["type"] }): RlmEvent {
	return {
		runId: "run-1",
		timestamp: Date.now(),
		invocationId: "root",
		parentId: null,
		depth: 0,
		...overrides,
	} as RlmEvent;
}

describe("RlmObserver", () => {
	it("getEvents returns all emitted events", () => {
		const obs = new RlmObserver();
		const e1 = fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 });
		const e2 = fakeEvent({ type: "run:end", answer: "a", error: null, iterations: 1 });
		obs.emit(e1);
		obs.emit(e2);

		const events = obs.getEvents();
		expect(events).toHaveLength(2);
		expect(events[0]).toBe(e1);
		expect(events[1]).toBe(e2);
	});

	it("getEvents returns a copy", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 }));
		const events = obs.getEvents();
		events.push(fakeEvent({ type: "run:end", answer: "a", error: null, iterations: 1 }));
		expect(obs.getEvents()).toHaveLength(1);
	});

	it("on() handlers fire for matching event types", () => {
		const obs = new RlmObserver();
		const captured: RlmEvent[] = [];
		obs.on("run:start", (e) => captured.push(e));

		obs.emit(fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 }));
		obs.emit(fakeEvent({ type: "run:end", answer: "a", error: null, iterations: 1 }));
		obs.emit(fakeEvent({ type: "run:start", query: "q2", maxIterations: 5, maxDepth: 2 }));

		expect(captured).toHaveLength(2);
		expect(captured[0].type).toBe("run:start");
		expect(captured[1].type).toBe("run:start");
	});

	it("on() handlers do not fire for non-matching types", () => {
		const obs = new RlmObserver();
		const captured: RlmEvent[] = [];
		obs.on("llm:error", (e) => captured.push(e));

		obs.emit(fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 }));
		obs.emit(fakeEvent({ type: "run:end", answer: "a", error: null, iterations: 1 }));

		expect(captured).toHaveLength(0);
	});

	it("multiple handlers for the same type all fire", () => {
		const obs = new RlmObserver();
		let count = 0;
		obs.on("run:start", () => count++);
		obs.on("run:start", () => count++);

		obs.emit(fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 }));
		expect(count).toBe(2);
	});

	it("getEvents filters by invocationId", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "iteration:start", invocationId: "root", iteration: 0, budgetRemaining: 10 }));
		obs.emit(fakeEvent({ type: "iteration:start", invocationId: "child-1", iteration: 0, budgetRemaining: 10 }));
		obs.emit(fakeEvent({ type: "iteration:start", invocationId: "root", iteration: 1, budgetRemaining: 9 }));

		const filtered = obs.getEvents({ invocationId: "root" });
		expect(filtered).toHaveLength(2);
		for (const e of filtered) {
			expect(e.invocationId).toBe("root");
		}
	});

	it("getEvents filters by runId", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "run:start", runId: "run-1", query: "q", maxIterations: 10, maxDepth: 3 }));
		obs.emit(fakeEvent({ type: "run:start", runId: "run-2", query: "q", maxIterations: 10, maxDepth: 3 }));

		expect(obs.getEvents({ runId: "run-1" })).toHaveLength(1);
		expect(obs.getEvents({ runId: "run-2" })).toHaveLength(1);
	});

	it("getEvents filters by single event type", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 }));
		obs.emit(fakeEvent({ type: "run:end", answer: "a", error: null, iterations: 1 }));
		obs.emit(fakeEvent({ type: "invocation:start", query: "q", systemPrompt: "s" }));

		expect(obs.getEvents({ type: "run:start" })).toHaveLength(1);
	});

	it("getEvents filters by array of event types", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "run:start", query: "q", maxIterations: 10, maxDepth: 3 }));
		obs.emit(fakeEvent({ type: "run:end", answer: "a", error: null, iterations: 1 }));
		obs.emit(fakeEvent({ type: "invocation:start", query: "q", systemPrompt: "s" }));

		expect(obs.getEvents({ type: ["run:start", "run:end"] })).toHaveLength(2);
	});

	it("getEvents combines filters with AND logic", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "iteration:start", runId: "run-1", invocationId: "root", iteration: 0, budgetRemaining: 10 }));
		obs.emit(fakeEvent({ type: "iteration:start", runId: "run-1", invocationId: "child-1", iteration: 0, budgetRemaining: 10 }));
		obs.emit(fakeEvent({ type: "iteration:end", runId: "run-1", invocationId: "root", iteration: 0, code: null, output: "", error: null, returned: false }));

		const filtered = obs.getEvents({ runId: "run-1", invocationId: "root", type: "iteration:start" });
		expect(filtered).toHaveLength(1);
	});

	it("getTree reconstructs parent-child relationships", () => {
		const obs = new RlmObserver();

		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "root", query: "q", systemPrompt: "s" }));
		obs.emit(fakeEvent({ type: "delegation:spawn", runId: "run-1", invocationId: "root", childId: "child-1", query: "sub" }));
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "child-1", parentId: "root", query: "sub", systemPrompt: "s" }));
		obs.emit(fakeEvent({ type: "delegation:spawn", runId: "run-1", invocationId: "child-1", childId: "grandchild-1", query: "subsub" }));
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "grandchild-1", parentId: "child-1", query: "subsub", systemPrompt: "s" }));

		const tree = obs.getTree("run-1");
		expect(tree).not.toBeNull();
		expect(tree!.invocationId).toBe("root");
		expect(tree!.children).toHaveLength(1);
		expect(tree!.children[0].invocationId).toBe("child-1");
		expect(tree!.children[0].children).toHaveLength(1);
		expect(tree!.children[0].children[0].invocationId).toBe("grandchild-1");
		expect(tree!.children[0].children[0].children).toHaveLength(0);
	});

	it("getTree returns null for unknown runId", () => {
		const obs = new RlmObserver();
		expect(obs.getTree("nonexistent")).toBeNull();
	});

	it("getTree handles multiple children", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "root", query: "q", systemPrompt: "s" }));
		obs.emit(fakeEvent({ type: "delegation:spawn", runId: "run-1", invocationId: "root", childId: "child-1", query: "a" }));
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "child-1", parentId: "root", query: "a", systemPrompt: "s" }));
		obs.emit(fakeEvent({ type: "delegation:spawn", runId: "run-1", invocationId: "root", childId: "child-2", query: "b" }));
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "child-2", parentId: "root", query: "b", systemPrompt: "s" }));

		const tree = obs.getTree("run-1");
		expect(tree!.invocationId).toBe("root");
		expect(tree!.children).toHaveLength(2);
		expect(tree!.children.map((c) => c.invocationId).sort()).toEqual(["child-1", "child-2"]);
	});

	it("getTree ignores events from other runs", () => {
		const obs = new RlmObserver();
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-1", invocationId: "root", query: "q", systemPrompt: "s" }));
		obs.emit(fakeEvent({ type: "invocation:start", runId: "run-2", invocationId: "root", query: "q2", systemPrompt: "s2" }));

		const tree = obs.getTree("run-1");
		expect(tree!.invocationId).toBe("root");
		expect(tree!.children).toHaveLength(0);
	});
});

// --- Integration: RlmObserver with rlm() ---

describe("RlmObserver integration", () => {
	it("collects events from a real rlm() run", async () => {
		const obs = new RlmObserver();
		const callLLM = mockToolCallLLM([
			tc('console.log("step 1")', "t1"),
			tc('return "done"', "t2"),
		]);

		const result = await rlm("test query", undefined, {
			callLLM,
			observer: obs,
		});

		expect(result.answer).toBe("done");

		const events = obs.getEvents();
		expect(events.length).toBeGreaterThan(0);
		expect(events[0].type).toBe("run:start");
		expect(events[events.length - 1].type).toBe("run:end");

		// Verify getEvents filtering works against real events
		const runId = events[0].runId;
		const llmRequests = obs.getEvents({ type: "llm:request" });
		expect(llmRequests.length).toBeGreaterThanOrEqual(2);

		const rootEvents = obs.getEvents({ invocationId: "root" });
		expect(rootEvents.length).toBe(events.length);

		// Verify tree works
		const tree = obs.getTree(runId);
		expect(tree).not.toBeNull();
		expect(tree!.invocationId).toBe("root");
		expect(tree!.children).toHaveLength(0);
	});

	it("tree reflects delegation", async () => {
		const obs = new RlmObserver();
		const callLLM: CallLLM = async (messages) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return tc('return "child answer"', "tc");
			}
			return tc('result = await rlm("child query")\nreturn result', "tp");
		};

		await rlm("parent query", undefined, {
			callLLM,
			observer: obs,
		});

		const runId = obs.getEvents()[0].runId;
		const tree = obs.getTree(runId);
		expect(tree).not.toBeNull();
		expect(tree!.invocationId).toBe("root");
		// Two children because iteration 0 early-return intercepted spawns a child too
		expect(tree!.children.length).toBeGreaterThanOrEqual(1);
	});

	it("on() fires during real rlm() execution", async () => {
		const obs = new RlmObserver();
		const queries: string[] = [];
		obs.on("run:start", (e) => queries.push(e.query));

		const callLLM = mockToolCallLLM([
			tc('return "done"', "t1"),
			tc('return "done"', "t2"),
		]);

		await rlm("hello world", undefined, { callLLM, observer: obs });

		expect(queries).toEqual(["hello world"]);
	});
});
