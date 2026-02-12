import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PLUGINS_DIR = resolve(fileURLToPath(import.meta.url), "../../plugins");

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns the frontmatter as a key-value record and the body (everything after the closing ---).
 * If no frontmatter is present, returns an empty record and the original content as the body.
 */
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
				// Fallback: parse as YAML-style inline array [a, b, c]
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

/** Load plugin files by name, strip YAML frontmatter, and return concatenated bodies. */
export async function loadPlugins(
	names: string[],
	subdir: "drivers" | "apps",
	pluginsDir?: string,
): Promise<string> {
	const dir = pluginsDir ?? DEFAULT_PLUGINS_DIR;

	const bodies = await Promise.all(
		names.map(async (name) => {
			const filePath = join(dir, subdir, `${name}.md`);
			const content = await readFile(filePath, "utf-8");
			return parseFrontmatter(content).body;
		}),
	);

	return bodies.join("\n\n---\n\n");
}

/**
 * Load a profile by name. Returns the list of driver names and model glob patterns.
 */
export async function loadProfile(
	name: string,
	pluginsDir?: string,
): Promise<{ drivers: string[]; models: string[] }> {
	const dir = pluginsDir ?? DEFAULT_PLUGINS_DIR;
	const filePath = join(dir, "profiles", `${name}.md`);
	const content = await readFile(filePath, "utf-8");
	const { frontmatter } = parseFrontmatter(content);

	const drivers: string[] = Array.isArray(frontmatter.drivers) ? frontmatter.drivers : [];
	const models: string[] = Array.isArray(frontmatter.models) ? frontmatter.models : [];

	return { drivers, models };
}

/**
 * Convert a simple glob pattern (with * wildcards) to a RegExp.
 * Only supports * as a wildcard (matches any characters).
 */
function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

/**
 * Auto-detect a profile by matching a model string against profile glob patterns.
 * Scans all .md files in the profiles/ directory. Returns the matching profile's
 * name and driver list, or null if no profile matches.
 *
 * The model string may have a provider prefix (e.g., "openrouter/google/gemini-3-flash-preview").
 * We try matching both the full string and with the first segment stripped.
 */
export async function detectProfile(
	model: string,
	pluginsDir?: string,
): Promise<{ name: string; drivers: string[] } | null> {
	const dir = pluginsDir ?? DEFAULT_PLUGINS_DIR;
	const profilesDir = join(dir, "profiles");

	let files: string[];
	try {
		files = await readdir(profilesDir);
	} catch {
		return null;
	}

	const mdFiles = files.filter((f) => f.endsWith(".md"));

	// Try matching with and without provider prefix
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

/** Load drivers and app plugins, resolving from profile or model auto-detection. Returns concatenated bodies. */
export async function loadStack(options: {
	drivers?: string[];
	app?: string;
	profile?: string;
	model?: string;
	pluginsDir?: string;
}): Promise<string> {
	const { drivers: extraDrivers, app, profile, model, pluginsDir } = options;

	// Resolve driver list from profile or auto-detection
	let profileDrivers: string[] = [];

	if (profile) {
		const loaded = await loadProfile(profile, pluginsDir);
		profileDrivers = loaded.drivers;
	} else if (model) {
		const detected = await detectProfile(model, pluginsDir);
		if (detected) {
			profileDrivers = detected.drivers;
		}
	}

	// Merge profile drivers with extra drivers (dedup, preserving order)
	const allDrivers = [...profileDrivers];
	if (extraDrivers) {
		for (const d of extraDrivers) {
			if (!allDrivers.includes(d)) {
				allDrivers.push(d);
			}
		}
	}

	const parts: string[] = [];

	// Load driver bodies
	if (allDrivers.length > 0) {
		const driverBodies = await loadPlugins(allDrivers, "drivers", pluginsDir);
		parts.push(driverBodies);
	}

	// Load app body
	if (app) {
		const appBody = await loadPlugins([app], "apps", pluginsDir);
		parts.push(appBody);
	}

	return parts.join("\n\n---\n\n");
}
