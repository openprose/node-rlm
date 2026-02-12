import { describe, expect, it } from "vitest";
import { fromProviderModel } from "../src/drivers/openrouter-compatible.js";
import { rlm } from "../src/rlm.js";

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!HAS_KEY)("RLM E2E", () => {
	it("should solve a simple math problem", { retry: 3, timeout: 60000 }, async () => {
		const callLLM = fromProviderModel("openrouter/anthropic/claude-sonnet-4-20250514");
		const result = await rlm("What is 7 * 8? Calculate it in code.", undefined, {
			callLLM,
			maxIterations: 5,
		});
		expect(result.answer).toContain("56");
	});
});
