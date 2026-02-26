import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIB_DIR = resolve(fileURLToPath(import.meta.url), "../../lib");
const DEFAULT_PROGRAMS_DIR = resolve(fileURLToPath(import.meta.url), "../../programs");
const DEFAULT_ARCHIVE_DIR = resolve(fileURLToPath(import.meta.url), "../../archive");

export function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) {
		return { frontmatter: {}, body: content };
	}

	const endIndex = trimmed.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter: {}, body: content };
	}

	const yamlBlock = trimmed.slice(4, endIndex); // skip opening "---\n"
	const body = trimmed.slice(endIndex + 4).replace(/^\r?\n/, "");

	// Simple YAML parser for flat key-value pairs and arrays
	const frontmatter: Record<string, any> = {};
	const lines = yamlBlock.split("\n");
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (!trimmedLine || trimmedLine.startsWith("#")) continue;

		// Check for array continuation (  - value)
		const arrayItemMatch = trimmedLine.match(/^-\s+(.+)$/);
		if (arrayItemMatch && currentKey && currentArray) {
			currentArray.push(arrayItemMatch[1].trim());
			continue;
		}

		// Flush any pending array
		if (currentKey && currentArray) {
			frontmatter[currentKey] = currentArray;
			currentKey = null;
			currentArray = null;
		}

		// Key-value pair
		const kvMatch = trimmedLine.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
		if (!kvMatch) continue;

		const key = kvMatch[1];
		const rawValue = kvMatch[2].trim();

		// Inline JSON array: ["foo", "bar"]
		if (rawValue.startsWith("[")) {
			try {
				frontmatter[key] = JSON.parse(rawValue);
			} catch {
				const inner = rawValue.slice(1, -1);
				frontmatter[key] = inner.split(",").map((s) => s.trim());
			}
		} else if (rawValue === "") {
			// Could be the start of a block array
			currentKey = key;
			currentArray = [];
		} else {
			// Scalar value
			frontmatter[key] = rawValue;
		}
	}

	// Flush any pending array
	if (currentKey && currentArray) {
		frontmatter[currentKey] = currentArray;
	}

	return { frontmatter, body };
}

export async function loadPlugins(
	names: string[],
	subdir: "drivers" | "apps",
	baseDir?: string,
): Promise<string> {
	const dir = baseDir ?? (subdir === "drivers" ? DEFAULT_LIB_DIR : DEFAULT_ARCHIVE_DIR);

	const bodies = await Promise.all(
		names.map(async (name) => {
			const filePath = join(dir, subdir, `${name}.md`);
			const content = await readFile(filePath, "utf-8");
			return parseFrontmatter(content).body;
		}),
	);

	return bodies.join("\n\n---\n\n");
}

export async function loadProfile(
	name: string,
	libDir?: string,
): Promise<{ drivers: string[]; models: string[] }> {
	const dir = libDir ?? DEFAULT_LIB_DIR;
	const filePath = join(dir, "profiles", `${name}.md`);
	const content = await readFile(filePath, "utf-8");
	const { frontmatter } = parseFrontmatter(content);

	const drivers: string[] = Array.isArray(frontmatter.drivers) ? frontmatter.drivers : [];
	const models: string[] = Array.isArray(frontmatter.models) ? frontmatter.models : [];

	return { drivers, models };
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

// Match model string against profile globs (tries with and without provider prefix).
export async function detectProfile(
	model: string,
	libDir?: string,
): Promise<{ name: string; drivers: string[] } | null> {
	const dir = libDir ?? DEFAULT_LIB_DIR;
	const profilesDir = join(dir, "profiles");

	let files: string[];
	try {
		files = await readdir(profilesDir);
	} catch {
		return null;
	}

	const mdFiles = files.filter((f) => f.endsWith(".md"));

	const candidates = [model];
	const slashIdx = model.indexOf("/");
	if (slashIdx !== -1) {
		candidates.push(model.slice(slashIdx + 1));
	}

	for (const file of mdFiles) {
		const filePath = join(profilesDir, file);
		const content = await readFile(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter(content);

		const models: string[] = Array.isArray(frontmatter.models) ? frontmatter.models : [];
		const drivers: string[] = Array.isArray(frontmatter.drivers) ? frontmatter.drivers : [];
		const profileName: string = frontmatter.name ?? file.replace(/\.md$/, "");

		for (const pattern of models) {
			const regex = globToRegExp(pattern);
			for (const candidate of candidates) {
				if (regex.test(candidate)) {
					return { name: profileName, drivers };
				}
			}
		}
	}

	return null;
}

export interface ProgramDefinition {
	globalDocs: string;
	rootApp: string;
	rootAppBody: string;
	childApps: Record<string, string>;
}

// Nodes include frontmatter in the agent prompt (role, delegates, api, prohibited).
export async function loadProgram(
	name: string,
	programsDir?: string,
): Promise<ProgramDefinition> {
	const dir = programsDir ?? DEFAULT_PROGRAMS_DIR;
	const programDir = join(dir, name);

	const files = await readdir(programDir);
	const mdFiles = files.filter((f) => f.endsWith(".md"));

	let globalDocs = "";
	let rootApp = "";
	let rootAppBody = "";
	const childApps: Record<string, string> = {};

	for (const file of mdFiles) {
		const content = await readFile(join(programDir, file), "utf-8");
		const { frontmatter, body } = parseFrontmatter(content);

		if (frontmatter.kind === "program") {
			globalDocs = body;
		} else if (frontmatter.kind === "program-node") {
			const nodeName = frontmatter.name as string;
			const shortName = file.replace(/\.md$/, "");
			if (!nodeName) {
				throw new Error(`Program node "${file}" in program "${name}" is missing a name in frontmatter`);
			}
			// Program nodes include frontmatter — the agent sees its role, delegates, api, prohibited
			if (frontmatter.role === "orchestrator") {
				rootApp = nodeName;
				rootAppBody = content;
			} else {
				// Register by both full name and short filename for flexible delegation
				childApps[nodeName] = content;
				if (shortName !== nodeName) {
					childApps[shortName] = content;
				}
			}
		}
	}

	if (!rootApp) {
		throw new Error(`Program "${name}" has no orchestrator node (role: orchestrator)`);
	}

	return { globalDocs, rootApp, rootAppBody, childApps };
}

export async function loadStack(options: {
	drivers?: string[];
	app?: string;
	profile?: string;
	model?: string;
	libDir?: string;
}): Promise<string> {
	const { drivers: extraDrivers, app, profile, model, libDir } = options;

	let profileDrivers: string[] = [];

	if (profile) {
		const loaded = await loadProfile(profile, libDir);
		profileDrivers = loaded.drivers;
	} else if (model) {
		const detected = await detectProfile(model, libDir);
		if (detected) {
			profileDrivers = detected.drivers;
		}
	}

	const allDrivers = [...profileDrivers];
	if (extraDrivers) {
		for (const d of extraDrivers) {
			if (!allDrivers.includes(d)) {
				allDrivers.push(d);
			}
		}
	}

	const parts: string[] = [];

	if (allDrivers.length > 0) {
		const driverBodies = await loadPlugins(allDrivers, "drivers");
		parts.push(driverBodies);
	}

	if (app) {
		const appBody = await loadPlugins([app], "apps");
		parts.push(appBody);
	}

	return parts.join("\n\n---\n\n");
}
