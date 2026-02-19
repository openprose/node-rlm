import { describe, expect, it } from "vitest";
import { buildModelTable, buildSystemPrompt } from "../src/system-prompt.js";

const BASE_OPTS = {
	canDelegate: true,
	invocationId: "root",
	parentId: null as string | null,
	depth: 0,
	maxDepth: 3,
	maxIterations: 10,
	lineage: ["test query"],
};

describe("buildSystemPrompt", () => {
	it("contains all 4 mandatory XML sections", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("<rlm-preamble>");
		expect(result).toContain("</rlm-preamble>");
		expect(result).toContain("<rlm-environment>");
		expect(result).toContain("</rlm-environment>");
		expect(result).toContain("<rlm-context>");
		expect(result).toContain("</rlm-context>");
		expect(result).toContain("<rlm-rules>");
		expect(result).toContain("</rlm-rules>");
	});

	it("omits <rlm-program> when no programContent", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).not.toContain("<rlm-program>");
		expect(result).not.toContain("</rlm-program>");
	});

	it("includes <rlm-program> when programContent provided", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, programContent: "## My Plugin\nDo things." });
		expect(result).toContain("<rlm-program>");
		expect(result).toContain("## My Plugin");
		expect(result).toContain("Do things.");
		expect(result).toContain("</rlm-program>");
	});

	it("includes rlm() docs when canDelegate is true", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: true });
		expect(result).toContain("await rlm(query, context?, options?)");
		expect(result).toContain("Must be awaited");
	});

	it("excludes rlm() docs when canDelegate is false", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: false });
		expect(result).not.toContain("await rlm(query, context?, options?)");
	});

	it("includes globalDocs in environment when provided", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, globalDocs: "The `foo` global does X." });
		expect(result).toContain("## Sandbox Globals");
		expect(result).toContain("The `foo` global does X.");
	});

	it("excludes globalDocs when not provided", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).not.toContain("## Sandbox Globals");
	});

	it("includes modelTable in environment when canDelegate and provided", () => {
		const table = buildModelTable({ fast: { tags: ["speed"], description: "A fast model" } });
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: true, modelTable: table });
		expect(result).toContain("## Available Models");
		expect(result).toContain("fast");
	});

	it("excludes modelTable when canDelegate is false", () => {
		const table = buildModelTable({ fast: { tags: ["speed"], description: "A fast model" } });
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: false, modelTable: table });
		expect(result).not.toContain("## Available Models");
	});

	it("renders context with root orchestrator role at depth 0", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("You are the root orchestrator.");
		expect(result).toContain('Agent "root"');
		expect(result).toContain("depth 0 of 3");
	});

	it("renders context with parent info at depth > 0", () => {
		const result = buildSystemPrompt({
			...BASE_OPTS,
			invocationId: "d1-c0",
			parentId: "root",
			depth: 1,
		});
		expect(result).toContain('Parent: "root"');
		expect(result).toContain('Agent "d1-c0"');
		expect(result).toContain("depth 1 of 3");
	});

	it("contains key preamble concepts: contracts, state schemas, shape", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("Contracts");
		expect(result).toContain("ensures:");
		expect(result).toContain("State schemas");
		expect(result).toContain("Shape declarations");
		expect(result).toContain("prohibited");
	});

	it("contains key environment concepts: return, console.log, require", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("return(value)");
		expect(result).toContain("console.log()");
		expect(result).toContain("require()");
	});

	it("contains key rules: one block, await, verify", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("One execute_code tool call per response");
		expect(result).toContain("await");
		expect(result).toContain("verifying via");
	});

	it("shows delegation possible when canDelegate is true", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: true, depth: 0 });
		expect(result).toContain("You can delegate to child RLMs at depth 1.");
	});

	it("shows cannot delegate when canDelegate is false", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: false, depth: 3, maxDepth: 3 });
		expect(result).toContain("maximum delegation depth and cannot spawn child agents");
	});

	it("truncates long root task in lineage", () => {
		const longQuery = "x".repeat(300);
		const result = buildSystemPrompt({ ...BASE_OPTS, depth: 1, parentId: "root", lineage: [longQuery, "child query"] });
		expect(result).toContain("...");
		expect(result).not.toContain(longQuery);
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
