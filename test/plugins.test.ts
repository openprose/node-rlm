import { describe, expect, it } from "vitest";
import { parseFrontmatter, loadPlugins, loadProfile, detectProfile, loadStack } from "../src/plugins.js";

describe("parseFrontmatter", () => {
	it("extracts frontmatter and body correctly", () => {
		const content = `---
name: test-plugin
kind: driver
version: 0.1.0
description: A test plugin
tags: [foo, bar]
---

## Body Content

This is the body.`;

		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter.name).toBe("test-plugin");
		expect(frontmatter.kind).toBe("driver");
		expect(frontmatter.version).toBe("0.1.0");
		expect(frontmatter.description).toBe("A test plugin");
		expect(frontmatter.tags).toEqual(["foo", "bar"]);
		expect(body).toContain("## Body Content");
		expect(body).toContain("This is the body.");
	});

	it("handles content with no frontmatter", () => {
		const content = "# Just a heading\n\nSome text.";
		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it("parses block-style YAML arrays", () => {
		const content = `---
name: test-profile
drivers:
  - driver-a
  - driver-b
  - driver-c
---

Body text.`;

		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.drivers).toEqual(["driver-a", "driver-b", "driver-c"]);
	});

	it("parses inline JSON arrays", () => {
		const content = `---
name: test
models: ["google/gemini*", "google/gemini-flash*"]
---

Body.`;

		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.models).toEqual(["google/gemini*", "google/gemini-flash*"]);
	});
});

describe("loadPlugins", () => {
	it("loads drivers by name from plugins/drivers/, strips frontmatter, concatenates bodies", async () => {
		const result = await loadPlugins(["no-tool-calls", "await-discipline"], "drivers");
		expect(result).toContain("## No Tool Calls");
		expect(result).toContain("## Await Discipline");
		expect(result).not.toContain("name: no-tool-calls");
		expect(result).not.toContain("kind: driver");
		expect(result).toContain("\n\n---\n\n");
	});

	it("loads apps by name from plugins/apps/", async () => {
		const result = await loadPlugins(["structured-data-aggregation"], "apps");
		expect(result).toContain("## Aggregation Protocol");
		expect(result).not.toContain("name: structured-data-aggregation");
		expect(result).not.toContain("kind: app");
	});
});

describe("loadProfile", () => {
	it("loads a profile and returns correct driver names and model globs", async () => {
		const profile = await loadProfile("gemini-3-flash");
		expect(profile.drivers).toEqual([
			"no-tool-calls",
			"one-block-per-iteration",
			"await-discipline",
			"return-format-discipline",
			"verify-before-return",
		]);
		expect(profile.models).toEqual([
			"google/gemini-3-flash*",
			"google/gemini-3-flash-preview*",
		]);
	});
});

describe("detectProfile", () => {
	it("matches model string against profile globs and returns correct profile", async () => {
		const result = await detectProfile("google/gemini-3-flash-preview");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("gemini-3-flash");
		expect(result!.drivers).toContain("no-tool-calls");
		expect(result!.drivers).toContain("one-block-per-iteration");
	});

	it("matches model with provider prefix (openrouter/google/...)", async () => {
		const result = await detectProfile("openrouter/google/gemini-3-flash-preview");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("gemini-3-flash");
	});

	it("returns null when no profile matches", async () => {
		const result = await detectProfile("anthropic/claude-sonnet-4-20250514");
		expect(result).toBeNull();
	});
});

describe("loadStack", () => {
	it("with explicit profile + app, returns concatenated drivers then app", async () => {
		const result = await loadStack({
			profile: "gemini-3-flash",
			app: "structured-data-aggregation",
		});
		expect(result).toContain("## No Tool Calls");
		expect(result).toContain("## Await Discipline");
		expect(result).toContain("## Aggregation Protocol");
		const driverPos = result.indexOf("## No Tool Calls");
		const appPos = result.indexOf("## Aggregation Protocol");
		expect(driverPos).toBeLessThan(appPos);
	});

	it("with model auto-detection, loads correct profile's drivers", async () => {
		const result = await loadStack({
			model: "openrouter/google/gemini-3-flash-preview",
		});
		expect(result).toContain("## No Tool Calls");
		expect(result).toContain("## One Block Per Iteration");
		expect(result).toContain("## Await Discipline");
		expect(result).toContain("## Return Format");
		expect(result).toContain("## Verify Before Return");
	});

	it("with extra drivers, deduplicates against profile drivers", async () => {
		const result = await loadStack({
			profile: "gemini-3-flash",
			app: "structured-data-aggregation",
			drivers: ["verify-before-return"],
		});
		const matches = result.match(/## Verify Before Return/g);
		expect(matches).toHaveLength(1);
	});

	it("with no profile/model/drivers, returns just the app body", async () => {
		const result = await loadStack({
			app: "structured-data-aggregation",
		});
		expect(result).toContain("## Aggregation Protocol");
		expect(result).not.toContain("## No Tool Calls");
	});

	it("with no profile/model/drivers/app, returns empty string", async () => {
		const result = await loadStack({});
		expect(result).toBe("");
	});

	it("with model that does not match any profile and no explicit drivers, returns empty string", async () => {
		const result = await loadStack({
			model: "anthropic/claude-sonnet-4-20250514",
		});
		expect(result).toBe("");
	});
});
