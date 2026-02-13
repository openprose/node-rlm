/**
 * Default model alias definitions.
 *
 * Model IDs use the `openrouter/` provider prefix (the default provider).
 * The CLI builds CallLLM instances from these at startup; user-supplied
 * --model-alias flags override entries with the same alias name.
 */

export interface ModelAliasDefinition {
	modelId: string;
	tags: string[];
	description: string;
}

export const DEFAULT_MODEL_ALIASES: Record<string, ModelAliasDefinition> = {
	fast: {
		modelId: "openrouter/google/gemini-3-flash-preview",
		tags: ["fast", "cheap"],
		description: "Gemini 3 Flash — fast and cheap",
	},
	orchestrator: {
		modelId: "openrouter/anthropic/claude-sonnet-4.5",
		tags: ["orchestrator", "medium"],
		description: "Claude Sonnet 4.5 — balanced orchestration",
	},
	intelligent: {
		modelId: "openrouter/anthropic/claude-opus-4-6",
		tags: ["intelligent", "expensive"],
		description: "Claude Opus 4.6 — highest capability",
	},
};
