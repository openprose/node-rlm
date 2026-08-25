import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedInputs {
	[key: string]: string | string[];
}

export interface PressCallArgs {
	inputs?: Record<string, string | string[]>;
	workspace?: string;
}

export interface ResolvedPressCall {
	serviceName: string;
	/** Loaded from services/{name}.md in the run directory. */
	serviceDefinition: string;
	/** Inputs with file-path values resolved to their content. */
	inputs: ResolvedInputs;
	workspace: string;
	/** Output names parsed from the service definition's ensures section. */
	outputs: string[];
}

// ---------------------------------------------------------------------------
// Path detection
// ---------------------------------------------------------------------------

/**
 * Determine if a value looks like a resolvable file path (contains a path
 * separator and ends with `.md`, excluding URLs).
 * @param value - The input string to check.
 * @returns `true` if the value should be read from disk during input resolution.
 */
export function isResolvablePath(value: string): boolean {
	if (value.startsWith("http://") || value.startsWith("https://")) {
		return false;
	}
	return (value.includes("/") || value.includes("\\")) && value.endsWith(".md");
}

// ---------------------------------------------------------------------------
// Value resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single input value.
 *
 * If the value looks like a file path (per {@link isResolvablePath}), the file
 * is read from disk and its content is returned. When the file uses the caller
 * input format (contains a `---` separator with a `kind: input` header), only
 * the content after the separator is returned, trimmed.
 *
 * Literal values are returned as-is.
 *
 * @throws {Error} If the path cannot be read.
 */
export function resolveValue(value: string): string {
	if (!isResolvablePath(value)) {
		return value;
	}

	let raw: string;
	try {
		raw = readFileSync(value, "utf8");
	} catch {
		throw new Error(`Input path not found: ${value}`);
	}

	// If the file uses the caller-input envelope (kind: input … --- … content),
	// strip the header and return only the payload.
	const separatorIndex = raw.indexOf("\n---\n");
	if (separatorIndex !== -1) {
		const header = raw.slice(0, separatorIndex);
		if (header.includes("kind: input")) {
			return raw.slice(separatorIndex + "\n---\n".length).trim();
		}
	}

	return raw;
}

// ---------------------------------------------------------------------------
// Batch input resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all inputs in a press() call.
 *
 * String values are resolved individually via {@link resolveValue}. Array
 * values have each element resolved independently.
 */
export function resolveInputs(
	inputs: Record<string, string | string[]>,
): ResolvedInputs {
	const resolved: ResolvedInputs = {};

	for (const [key, value] of Object.entries(inputs)) {
		if (Array.isArray(value)) {
			resolved[key] = value.map((v) =>
				isResolvablePath(v) ? resolveValue(v) : v,
			);
		} else {
			resolved[key] = isResolvablePath(value)
				? resolveValue(value)
				: value;
		}
	}

	return resolved;
}

// ---------------------------------------------------------------------------
// Service definition loading
// ---------------------------------------------------------------------------

/**
 * Load a service definition by name from the run directory.
 *
 * Reads `${runDir}/services/${serviceName}.md`.
 *
 * @throws {Error} If the service definition file does not exist.
 */
export function loadServiceDefinition(
	runDir: string,
	serviceName: string,
): string {
	const path = `${runDir}/services/${serviceName}.md`;
	try {
		return readFileSync(path, "utf8");
	} catch {
		throw new Error(
			`Service definition not found: ${path} (service "${serviceName}")`,
		);
	}
}

// ---------------------------------------------------------------------------
// Ensures output parsing
// ---------------------------------------------------------------------------

/**
 * Parse output names from a service definition's ensures section.
 *
 * Looks for a line starting with `ensures:` and extracts each subsequent
 * `- name` entry. This is intentionally simple string parsing rather than
 * full YAML — it grabs the first word after `- ` on each indented line
 * following the `ensures:` marker.
 *
 * @returns Array of output names, e.g. `["findings", "sources"]`.
 */
export function parseEnsuresOutputs(serviceDefinition: string): string[] {
	const lines = serviceDefinition.split("\n");
	const outputs: string[] = [];

	let inEnsures = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed === "ensures:" || trimmed.startsWith("ensures:")) {
			inEnsures = true;

			// Handle inline single value: `ensures: report`
			const inlineValue = trimmed.slice("ensures:".length).trim();
			if (inlineValue && !inlineValue.startsWith("-")) {
				outputs.push(inlineValue.split(/\s/)[0]);
				inEnsures = false;
			}
			continue;
		}

		if (inEnsures) {
			if (trimmed.startsWith("- ")) {
				// Extract the name: could be `- report` or `- name: report`
				const entry = trimmed.slice(2).trim();
				if (entry.startsWith("name:")) {
					outputs.push(entry.slice("name:".length).trim().split(/\s/)[0]);
				} else {
					outputs.push(entry.split(/[\s(:]/)[0]);
				}
			} else if (trimmed === "" || trimmed.startsWith("-")) {
				// Blank line or bare dash — continue
				continue;
			} else {
				// Non-list line — we've left the ensures block
				inEnsures = false;
			}
		}
	}

	return outputs;
}

// ---------------------------------------------------------------------------
// Full press() call resolution
// ---------------------------------------------------------------------------

/**
 * Fully resolve a press() call: load service definition, resolve inputs, and parse outputs.
 * @param runDir - The run directory containing `services/` subdirectory.
 * @param serviceName - Name of the service to resolve.
 * @param args - Caller-provided inputs and optional workspace override.
 * @returns Everything needed to build the child service's system prompt.
 */
export function resolvePressCall(
	runDir: string,
	serviceName: string,
	args: PressCallArgs,
): ResolvedPressCall {
	const serviceDefinition = loadServiceDefinition(runDir, serviceName);
	const inputs = args.inputs ? resolveInputs(args.inputs) : {};
	const outputs = parseEnsuresOutputs(serviceDefinition);
	const workspace = args.workspace ?? `${runDir}/workspace/${serviceName}/`;

	return {
		serviceName,
		serviceDefinition,
		inputs,
		workspace,
		outputs,
	};
}
