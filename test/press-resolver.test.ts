import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterAll } from "vitest";
import {
	isResolvablePath,
	resolveValue,
	resolveInputs,
	loadServiceDefinition,
	parseEnsuresOutputs,
	resolvePressCall,
} from "../src/press-resolver.js";

// ---------------------------------------------------------------------------
// Shared temp directory for file-based tests
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "press-resolver-test-"));

afterAll(() => {
	rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isResolvablePath
// ---------------------------------------------------------------------------

describe("isResolvablePath", () => {
	it("returns true for a .prose binding path", () => {
		expect(isResolvablePath(".prose/runs/123/bindings/caller/url.md")).toBe(true);
	});

	it("returns true for a workspace path", () => {
		expect(isResolvablePath("workspace/scraper/pages.md")).toBe(true);
	});

	it("returns true for an absolute path", () => {
		expect(isResolvablePath("/absolute/path/to/file.md")).toBe(true);
	});

	it("returns true for a Windows-style absolute path", () => {
		expect(isResolvablePath("C:\\Users\\me\\docs\\file.md")).toBe(true);
	});

	it("returns false for a bare word like 'haiku'", () => {
		expect(isResolvablePath("haiku")).toBe(false);
	});

	it("returns false for 'standard'", () => {
		expect(isResolvablePath("standard")).toBe(false);
	});

	it("returns false for 'ExampleSDK'", () => {
		expect(isResolvablePath("ExampleSDK")).toBe(false);
	});

	it("returns false for an https URL", () => {
		expect(isResolvablePath("https://docs.example.com")).toBe(false);
	});

	it("returns false for an http URL", () => {
		expect(isResolvablePath("http://localhost:3000")).toBe(false);
	});

	it("returns false for an empty string", () => {
		expect(isResolvablePath("")).toBe(false);
	});

	it("returns false for a path without .md extension", () => {
		expect(isResolvablePath("some/path/without/extension")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveValue
// ---------------------------------------------------------------------------

describe("resolveValue", () => {
	const plainFile = join(tmp, "plain/doc.md");
	const callerFile = join(tmp, "caller/url.md");

	mkdirSync(join(tmp, "plain"), { recursive: true });
	mkdirSync(join(tmp, "caller"), { recursive: true });

	writeFileSync(plainFile, "# Hello\n\nThis is plain markdown.\n");
	writeFileSync(
		callerFile,
		"# url\n\nkind: input\nsource: caller\n\n---\n\nhttps://docs.example.com\n",
	);

	it("reads a plain markdown file and returns its content", () => {
		const content = resolveValue(plainFile);
		expect(content).toBe("# Hello\n\nThis is plain markdown.\n");
	});

	it("reads a caller input file and returns only content after ---", () => {
		const content = resolveValue(callerFile);
		expect(content).toBe("https://docs.example.com");
	});

	it("throws on a missing file with a clear error message", () => {
		const missing = join(tmp, "does/not/exist.md");
		expect(() => resolveValue(missing)).toThrow("Input path not found");
		expect(() => resolveValue(missing)).toThrow(missing);
	});
});

// ---------------------------------------------------------------------------
// resolveInputs
// ---------------------------------------------------------------------------

describe("resolveInputs", () => {
	const fileA = join(tmp, "inputs/a.md");
	const fileB = join(tmp, "inputs/b.md");

	mkdirSync(join(tmp, "inputs"), { recursive: true });
	writeFileSync(fileA, "Content A");
	writeFileSync(fileB, "Content B");

	it("resolves file paths to content and passes literals through", () => {
		const result = resolveInputs({ url: fileA, tier: "haiku" });
		expect(result.url).toBe("Content A");
		expect(result.tier).toBe("haiku");
	});

	it("handles mixed inputs: path resolved, literal passed through", () => {
		const result = resolveInputs({ url: fileA, tier: "haiku" });
		expect(result.url).toBe("Content A");
		expect(result.tier).toBe("haiku");
	});

	it("handles array inputs: all paths resolved", () => {
		const result = resolveInputs({ results: [fileA, fileB] });
		expect(result.results).toEqual(["Content A", "Content B"]);
	});

	it("handles array with mix of paths and literals", () => {
		const result = resolveInputs({ items: [fileA, "literal-value"] });
		expect(result.items).toEqual(["Content A", "literal-value"]);
	});
});

// ---------------------------------------------------------------------------
// loadServiceDefinition
// ---------------------------------------------------------------------------

describe("loadServiceDefinition", () => {
	const runDir = join(tmp, "run");

	mkdirSync(join(runDir, "services"), { recursive: true });
	writeFileSync(
		join(runDir, "services", "scraper.md"),
		"---\nname: scraper\nkind: service\n---\n\nrequires:\n- url\n",
	);

	it("loads services/{name}.md from run directory", () => {
		const def = loadServiceDefinition(runDir, "scraper");
		expect(def).toContain("name: scraper");
		expect(def).toContain("kind: service");
	});

	it("throws a clear error when service file does not exist", () => {
		expect(() => loadServiceDefinition(runDir, "nonexistent")).toThrow(
			"Service definition not found",
		);
		expect(() => loadServiceDefinition(runDir, "nonexistent")).toThrow(
			'service "nonexistent"',
		);
	});
});

// ---------------------------------------------------------------------------
// parseEnsuresOutputs
// ---------------------------------------------------------------------------

describe("parseEnsuresOutputs", () => {
	it("extracts output names from ensures section", () => {
		const def = [
			"---",
			"name: scraper",
			"---",
			"",
			"requires:",
			"- url",
			"",
			"ensures:",
			"- pages: extracted documentation pages",
			"- metadata: page metadata",
		].join("\n");

		expect(parseEnsuresOutputs(def)).toEqual(["pages", "metadata"]);
	});

	it("handles '- name: description' format (extracts just the name)", () => {
		const def = "ensures:\n- report: a final summary report\n- data: raw data";
		expect(parseEnsuresOutputs(def)).toEqual(["report", "data"]);
	});

	it("handles '- name' format (no description)", () => {
		const def = "ensures:\n- findings\n- sources\n";
		expect(parseEnsuresOutputs(def)).toEqual(["findings", "sources"]);
	});

	it("returns empty array if no ensures section", () => {
		const def = "---\nname: simple\n---\n\nrequires:\n- url\n";
		expect(parseEnsuresOutputs(def)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// resolvePressCall (integration)
// ---------------------------------------------------------------------------

describe("resolvePressCall", () => {
	const runDir = join(tmp, "integration-run");

	mkdirSync(join(runDir, "services"), { recursive: true });
	mkdirSync(join(runDir, "bindings", "caller"), { recursive: true });

	const serviceDef = [
		"---",
		"name: scraper",
		"kind: service",
		"---",
		"",
		"requires:",
		"- url: the URL to scrape",
		"",
		"ensures:",
		"- pages: extracted documentation pages",
		"- metadata: page metadata",
	].join("\n");

	writeFileSync(join(runDir, "services", "scraper.md"), serviceDef);
	writeFileSync(
		join(runDir, "bindings", "caller", "url.md"),
		"# url\n\nkind: input\nsource: caller\n\n---\n\nhttps://docs.example.com\n",
	);

	it("resolves a complete press() call", () => {
		const urlPath = join(runDir, "bindings/caller/url.md");
		const result = resolvePressCall(runDir, "scraper", {
			inputs: { url: urlPath, tier: "haiku" },
			workspace: "/custom/workspace",
		});

		expect(result.serviceName).toBe("scraper");
		expect(result.serviceDefinition).toBe(serviceDef);
		expect(result.inputs.url).toBe("https://docs.example.com");
		expect(result.inputs.tier).toBe("haiku");
		expect(result.workspace).toBe("/custom/workspace");
		expect(result.outputs).toEqual(["pages", "metadata"]);
	});

	it("uses default workspace when none provided", () => {
		const result = resolvePressCall(runDir, "scraper", {});
		expect(result.workspace).toBe(`${runDir}/workspace/scraper/`);
	});
});
