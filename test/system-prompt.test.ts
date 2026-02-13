import { describe, expect, it } from "vitest";
import { buildModelTable, SYSTEM_PROMPT } from "../src/system-prompt.js";

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

describe("buildModelTable", () => {
	it("renders a markdown table with aliases, tags, and descriptions", () => {
		const models = {
			fast: { tags: ["speed", "cheap"], description: "A fast model for simple tasks" },
			smart: { tags: ["reasoning"], description: "A powerful model for complex tasks" },
		};

		const result = buildModelTable(models);

		expect(result).toContain("## Available Models");
		expect(result).toContain("| Alias | Tags | Description |");
		expect(result).toContain("|-------|------|-------------|");
		expect(result).toContain("| fast | speed, cheap | A fast model for simple tasks |");
		expect(result).toContain("| smart | reasoning | A powerful model for complex tasks |");
		expect(result).toContain('{ model: "fast" }');
	});

	it("returns empty string when models is undefined", () => {
		expect(buildModelTable(undefined)).toBe("");
	});

	it("returns empty string when models is an empty object", () => {
		expect(buildModelTable({})).toBe("");
	});

	it("renders dash for missing tags and description", () => {
		const models = {
			basic: {},
		};

		const result = buildModelTable(models);

		expect(result).toContain("| basic | - | - |");
	});
});
