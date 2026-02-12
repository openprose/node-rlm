import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/system-prompt.js";

describe("SYSTEM_PROMPT", () => {
	it("contains return(", () => {
		expect(SYSTEM_PROMPT).toContain("return(");
	});

	it("contains rlm", () => {
		expect(SYSTEM_PROMPT).toContain("rlm");
	});

	it("contains console.log", () => {
		expect(SYSTEM_PROMPT).toContain("console.log");
	});

	it("contains require", () => {
		expect(SYSTEM_PROMPT).toContain("require");
	});

	it("contains REPL", () => {
		expect(SYSTEM_PROMPT).toContain("REPL");
	});
});
