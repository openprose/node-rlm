import { describe, expect, it } from "vitest";
import type { CallLLM, CallLLMResponse } from "../src/rlm.js";
import { rlm, RlmMaxIterationsError } from "../src/rlm.js";
import type { RlmEvent, RlmEventSink } from "../src/events.js";

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
