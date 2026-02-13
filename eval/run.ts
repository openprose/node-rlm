#!/usr/bin/env node

// Log and suppress unhandled rejections from sandbox-executed code.
process.on("unhandledRejection", (reason) => {
	console.error("\n[eval] Unhandled rejection (suppressed):", reason instanceof Error ? reason.message : String(reason));
});

/**
 * CLI entry point for the RLM eval harness.
 *
 * Usage:
 *   npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-sonnet-4-20250514
 *   npx tsx eval/run.ts --benchmark s-niah --model anthropic/claude-sonnet-4-20250514 --concurrency 10
 *   npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-haiku-4-5-20250514 --max-iterations 10 --max-depth 1
 *
 * Options:
 *   --benchmark <name>     Benchmark to run: oolong, s-niah (required)
 *   --model <provider/id>  Model to use (required, e.g. anthropic/claude-sonnet-4-20250514)
 *   --concurrency <n>      Number of parallel tasks (default: 5)
 *   --max-iterations <n>   Max REPL iterations per task (default: 15)
 *   --max-depth <n>        Max recursion depth (default: 2)
 *   --max-tasks <n>        Limit number of tasks (default: all)
 *   --attempts <n>         Attempts per task for pass@N (default: 1)
 *   --dataset-filter <s>   OOLONG: filter by dataset field (default: trec_coarse)
 *   --context-len <n>      OOLONG: filter by context_len (default: 131072)
 *   --tasks-per-length <n> S-NIAH: tasks per context length (default: 8)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromOpenRouter } from "./drivers/openrouter.js";
import { runEval } from "./harness.js";
import { oolongScore, exactMatch, arcGridMatch } from "./scoring.js";
import { loadOolongTasks } from "./datasets/oolong.js";
import { generateSNIAHTasks } from "./datasets/s-niah.js";
import { loadArcTasks } from "./datasets/arc.js";
import { loadStack } from "../src/plugins.js";
import type { CallLLM, ModelEntry } from "../src/rlm.js";
import { DEFAULT_MODEL_ALIASES } from "../src/models.js";
import type { EvalResult, EvalTask, ScoringFunction } from "./types.js";
import { withRateLimit } from "./rate-limiter.js";

function loadEnvFile(): void {
	// Look for .env in the package root (one directory up from eval/)
	const envPath = join(new URL(".", import.meta.url).pathname, "..", ".env");
	try {
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			const value = trimmed.slice(eqIdx + 1).trim();
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	} catch {
		// File not found, continue
	}
}

loadEnvFile();

interface CliArgs {
	benchmark: string;
	model: string;
	concurrency: number;
	maxIterations: number;
	maxDepth: number;
	maxTasks: number | null;
	datasetFilter: string;
	contextLen: number | null;
	tasksPerLength: number;
	profile: string | null;
	app: string | null;
	drivers: string[];
	rateLimit: number;
	rateBurst: number;
	withLabels: boolean;
	filter: string | null;
	selectedProblems: string[];
	modelAliases: string[];
	maxBlocksPerIteration: number | null;
	attempts: number;
}

function usage(): never {
	console.log(`RLM Eval Harness

Usage: npx tsx eval/run.ts --benchmark <name> --model <provider/model-id> [options]

Benchmarks:
  oolong          OOLONG aggregation benchmark (trec_coarse, 50 tasks)
  s-niah          Single Needle in a Haystack (synthetic, ~48 tasks)
  arc             ARC-AGI-2 abstract reasoning (120 tasks)

Options:
  --benchmark <name>       Benchmark to run (required)
  --model <provider/id>    Model to use (required)
  --profile <name>         Load a named driver profile (e.g. gemini-3-flash)
  --app <name>             Load a named app plugin (e.g. structured-data-aggregation)
  --drivers <list>         Comma-separated extra driver names (appended after profile drivers)
  --concurrency <n>        Parallel tasks (default: 5)
  --max-iterations <n>     Max REPL iterations (default: 15)
  --max-depth <n>          Max recursion depth (default: 2)
  --max-tasks <n>          Limit number of tasks
  --dataset-filter <s>     OOLONG: dataset field filter (default: trec_coarse)
  --context-len <n>        OOLONG: context_len filter (default: 131072)
  --tasks-per-length <n>   S-NIAH: tasks per context length (default: 8)
  --selected-problems <ids> ARC: comma-separated problem IDs to run
  --attempts <n>           Attempts per task for pass@N (default: 1)
  --rate-limit <n>         Requests per second (default: 5, 0 to disable)
  --rate-burst <n>         Burst capacity (default: 10)
  --with-labels            OOLONG: use labeled context (context_window_text_with_labels)
  --model-alias <spec>     Register a model alias: alias=model[:tag1,tag2] (repeatable)
  --filter <expr>          OOLONG: filter tasks by field values (comma=AND, pipe=OR)
                           e.g. "task_group=TASK_TYPE.NUMERIC_ONE_CLASS"
                           e.g. "answer_type=ANSWER_TYPE.NUMERIC|ANSWER_TYPE.COMPARISON"

Profiles:
  If --profile is given, its drivers are loaded automatically.
  If no --profile but --model is given, the CLI auto-detects a matching profile.
  Extra --drivers are appended after profile drivers (deduplicated).

Examples:
  npx tsx eval/run.ts --benchmark oolong --model openrouter/google/gemini-3-flash-preview --app structured-data-aggregation
  npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-sonnet-4-20250514 --app structured-data-aggregation
  npx tsx eval/run.ts --benchmark s-niah --model anthropic/claude-sonnet-4-20250514 --concurrency 10
  npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-haiku-4-5-20250514 --max-tasks 10
  npx tsx eval/run.ts --benchmark oolong --model openrouter/google/gemini-3-flash-preview --profile gemini-3-flash --drivers verify-before-return
`);
	process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
	const args: Record<string, string> = {};
	const flags = new Set<string>();
	const modelAliases: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			usage();
		}
		if (arg === "--with-labels") {
			flags.add("with-labels");
		} else if (arg.startsWith("--") && i + 1 < argv.length) {
			const key = arg.slice(2);
			if (key === "model-alias") {
				modelAliases.push(argv[i + 1]);
			} else {
				args[key] = argv[i + 1];
			}
			i++;
		}
	}

	if (!args.benchmark) {
		console.error("Error: --benchmark is required\n");
		usage();
	}
	if (!args.model) {
		console.error("Error: --model is required\n");
		usage();
	}

	return {
		benchmark: args.benchmark,
		model: args.model,
		concurrency: parseInt(args.concurrency ?? "5", 10),
		maxIterations: parseInt(args["max-iterations"] ?? "15", 10),
		maxDepth: parseInt(args["max-depth"] ?? "1", 10),
		maxTasks: args["max-tasks"] ? parseInt(args["max-tasks"], 10) : null,
		datasetFilter: args["dataset-filter"] ?? "trec_coarse",
		contextLen: args["context-len"] !== undefined ? parseInt(args["context-len"], 10) : 131072,
		tasksPerLength: parseInt(args["tasks-per-length"] ?? "8", 10),
		profile: args.profile ?? null,
		app: args.app ?? null,
		drivers: args.drivers ? args.drivers.split(",").map((s) => s.trim()) : [],
		rateLimit: parseFloat(args["rate-limit"] ?? "5"),
		rateBurst: parseInt(args["rate-burst"] ?? "10", 10),
		withLabels: flags.has("with-labels"),
		filter: args.filter ?? null,
		selectedProblems: args["selected-problems"]
			? args["selected-problems"].split(",").map((s) => s.trim())
			: [],
		modelAliases,
		maxBlocksPerIteration: args["max-blocks-per-iteration"] ? parseInt(args["max-blocks-per-iteration"], 10) : null,
		attempts: parseInt(args.attempts ?? "1", 10),
	};
}

/**
 * Parse a --filter CLI string into a Record<string, string[]>.
 *
 * Syntax: comma-separated key=value pairs (AND).
 * Pipe within a value = OR (any value matches).
 *
 * Example: "task_group=TASK_TYPE.NUMERIC_ONE_CLASS,input_subset=False"
 *          -> { task_group: ["TASK_TYPE.NUMERIC_ONE_CLASS"], input_subset: ["False"] }
 *
 * Example: "answer_type=ANSWER_TYPE.NUMERIC|ANSWER_TYPE.COMPARISON"
 *          -> { answer_type: ["ANSWER_TYPE.NUMERIC", "ANSWER_TYPE.COMPARISON"] }
 */
function parseFilter(raw: string): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const pair of raw.split(",")) {
		const eqIdx = pair.indexOf("=");
		if (eqIdx === -1) {
			console.warn(`Warning: ignoring malformed filter pair (no '='): "${pair}"`);
			continue;
		}
		const key = pair.slice(0, eqIdx).trim();
		const values = pair.slice(eqIdx + 1).split("|").map((v) => v.trim());
		result[key] = values;
	}
	return result;
}

/** Return model-specific overrides for output headroom and timeout. */
function modelOverrides(model: string): { maxTokens?: number; timeoutMs?: number } {
	if (/opus/i.test(model)) return { maxTokens: 8192, timeoutMs: 180_000 };
	return {};
}

function resolveCallLLM(spec: string, maxBlocksPerIteration?: number | null): { callLLM: CallLLM; displayName: string } {
	const parts = spec.split("/");
	if (parts.length < 2) {
		console.error(`Invalid model format: ${spec}. Expected provider/model-id`);
		process.exit(1);
	}

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error("OPENROUTER_API_KEY not set. Required for eval harness.");
		console.error("Set it in .env or as an environment variable.");
		process.exit(1);
	}

	const overrides: { maxTokens?: number; timeoutMs?: number; stopAfterFirstBlock?: boolean } = modelOverrides(spec);
	if (maxBlocksPerIteration === 1) {
		overrides.stopAfterFirstBlock = true;
	}

	// If model spec starts with "openrouter/", strip the prefix —
	// OpenRouter expects just "provider/model" (e.g. "google/gemini-3-flash-preview").
	if (parts[0] === "openrouter") {
		const modelWithoutPrefix = parts.slice(1).join("/");
		return { callLLM: fromOpenRouter(modelWithoutPrefix, apiKey, overrides), displayName: `${modelWithoutPrefix} (openrouter)` };
	}

	// Otherwise pass the full spec directly — OpenRouter accepts "provider/model" natively.
	return { callLLM: fromOpenRouter(spec, apiKey, overrides), displayName: `${spec} (openrouter)` };
}

function buildModelAliases(aliases: string[], apiKey: string): Record<string, ModelEntry> | undefined {
	// Start with defaults
	const models: Record<string, ModelEntry> = {};
	for (const [alias, def] of Object.entries(DEFAULT_MODEL_ALIASES)) {
		// Strip openrouter/ prefix for the eval's OpenRouter driver
		const modelId = def.modelId.startsWith("openrouter/")
			? def.modelId.slice("openrouter/".length)
			: def.modelId;
		models[alias] = {
			callLLM: fromOpenRouter(modelId, apiKey),
			tags: [...def.tags],
			description: def.description,
		};
	}

	// Parse user overrides
	for (const raw of aliases) {
		const eqIdx = raw.indexOf("=");
		if (eqIdx === -1) {
			console.error(`Invalid --model-alias format: "${raw}" (expected alias=model[:tag1,tag2,...])`);
			process.exit(1);
		}
		const alias = raw.slice(0, eqIdx);
		const rest = raw.slice(eqIdx + 1);
		const colonIdx = rest.indexOf(":");
		let modelId: string;
		let tags: string[] | undefined;
		if (colonIdx === -1) {
			modelId = rest;
		} else {
			modelId = rest.slice(0, colonIdx);
			tags = rest.slice(colonIdx + 1).split(",").filter(Boolean);
		}
		if (!alias || !modelId) {
			console.error(`Invalid --model-alias format: "${raw}" (alias and model ID must be non-empty)`);
			process.exit(1);
		}
		// Strip openrouter/ prefix if present
		const cleanModelId = modelId.startsWith("openrouter/") ? modelId.slice("openrouter/".length) : modelId;
		models[alias] = {
			callLLM: fromOpenRouter(cleanModelId, apiKey),
			tags,
			description: modelId,
		};
	}

	return Object.keys(models).length > 0 ? models : undefined;
}

interface BenchmarkConfig {
	loadTasks: () => Promise<EvalTask[]>;
	scoringFn: ScoringFunction;
}

function getBenchmarkConfig(args: CliArgs): BenchmarkConfig {
	switch (args.benchmark) {
		case "oolong":
			return {
				loadTasks: () => loadOolongTasks(
					args.datasetFilter,
					args.contextLen,
					args.maxTasks ?? 50,
					args.withLabels,
					args.filter ? parseFilter(args.filter) : undefined,
				),
				scoringFn: oolongScore,
			};

		case "s-niah":
			return {
				loadTasks: () => generateSNIAHTasks(
					args.tasksPerLength,
				).then((tasks) => args.maxTasks ? tasks.slice(0, args.maxTasks) : tasks),
				scoringFn: exactMatch,
			};

		case "arc":
			return {
				loadTasks: () => loadArcTasks(
					args.maxTasks,
					args.selectedProblems.length > 0 ? args.selectedProblems : undefined,
				),
				scoringFn: arcGridMatch,
			};

		default:
			console.error(`Unknown benchmark: ${args.benchmark}`);
			console.error("Available benchmarks: oolong, s-niah, arc");
			process.exit(1);
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function printProgress(completed: number, total: number, result: EvalResult): void {
	const pct = Math.round((completed / total) * 100);
	const status = result.error ? "FAIL" : `score=${result.score.toFixed(2)}`;
	const time = formatDuration(result.wallTimeMs);
	const iterations = result.iterations;

	process.stdout.write(
		`\r  [${completed}/${total}] (${pct}%) ${result.taskId}: ${status}, ${iterations} iters, ${time}    `,
	);
	if (completed === total) {
		process.stdout.write("\n");
	}
}

function printFinalResults(result: import("./types.js").BenchmarkResult): void {
	const { aggregate } = result;

	console.log();
	console.log("=".repeat(60));
	console.log("  EVALUATION RESULTS");
	console.log("=".repeat(60));
	console.log();
	console.log(`  Benchmark:     ${result.benchmark}`);
	console.log(`  Model:         ${result.model}`);
	console.log(`  Config:        maxIter=${result.config.maxIterations}, maxDepth=${result.config.maxDepth}, concurrency=${result.config.concurrency}${result.config.attempts ? `, attempts=${result.config.attempts}` : ""}${result.config.filter ? `, filter=${result.config.filter}` : ""}`);
	console.log(`  Timestamp:     ${result.timestamp}`);
	console.log();
	console.log("  --- Scores ---");
	console.log(`  Mean:          ${(aggregate.meanScore * 100).toFixed(1)}%`);
	console.log(`  Median:        ${(aggregate.medianScore * 100).toFixed(1)}%`);
	console.log(`  Std Dev:       ${(aggregate.stdScore * 100).toFixed(1)}%`);
	console.log(`  P25:           ${(aggregate.p25Score * 100).toFixed(1)}%`);
	console.log(`  P75:           ${(aggregate.p75Score * 100).toFixed(1)}%`);
	console.log();
	console.log("  --- Efficiency ---");
	console.log(`  Mean Iters:    ${aggregate.meanIterations.toFixed(1)}`);
	console.log(`  Median Iters:  ${aggregate.medianIterations.toFixed(1)}`);
	console.log(`  Mean Time:     ${formatDuration(aggregate.meanWallTimeMs)}`);
	console.log(`  Total Time:    ${formatDuration(aggregate.totalWallTimeMs)}`);
	console.log();
	console.log("  --- Cost Estimate ---");
	console.log(`  Input Chars:   ${aggregate.totalInputChars.toLocaleString()} (~${Math.round(aggregate.totalInputChars / 4).toLocaleString()} tokens)`);
	console.log(`  Output Chars:  ${aggregate.totalOutputChars.toLocaleString()} (~${Math.round(aggregate.totalOutputChars / 4).toLocaleString()} tokens)`);
	console.log(`  Est. Cost:     $${aggregate.costEstimateUsd.toFixed(2)} (at Sonnet 4.5 pricing)`);
	console.log();
	console.log("  --- Tasks ---");
	console.log(`  Completed:     ${aggregate.completedTasks}`);
	console.log(`  Failed:        ${aggregate.failedTasks}`);
	console.log(`  Total:         ${aggregate.completedTasks + aggregate.failedTasks}`);
	console.log();
	console.log("=".repeat(60));
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	console.log("RLM Eval Harness");
	console.log("================");
	console.log();
	console.log(`Benchmark:       ${args.benchmark}`);
	console.log(`Model:           ${args.model}`);
	console.log(`Concurrency:     ${args.concurrency}`);
	console.log(`Max Iterations:  ${args.maxIterations}`);
	console.log(`Max Depth:       ${args.maxDepth}`);
	if (args.maxTasks) {
		console.log(`Max Tasks:       ${args.maxTasks}`);
	}
	if (args.selectedProblems.length > 0) {
		console.log(`Selected:        ${args.selectedProblems.join(", ")}`);
	}
	if (args.filter) {
		console.log(`Filter:          ${args.filter}`);
	}
	if (args.withLabels) {
		console.log(`With Labels:     yes (using context_window_text_with_labels)`);
	}
	if (args.attempts > 1) {
		console.log(`Attempts:        ${args.attempts} (pass@${args.attempts})`);
	}
	if (args.rateLimit > 0) {
		console.log(`Rate Limit:      ${args.rateLimit} req/s (burst: ${args.rateBurst})`);
	}
	if (args.profile) {
		console.log(`Profile:         ${args.profile}`);
	}
	if (args.app) {
		console.log(`App:             ${args.app}`);
	}
	if (args.drivers.length > 0) {
		console.log(`Extra Drivers:   ${args.drivers.join(", ")}`);
	}
	console.log();

	// Resolve model and create callLLM
	console.log("Resolving model...");
	const { callLLM: rawCallLLM, displayName } = resolveCallLLM(args.model, args.maxBlocksPerIteration);
	const callLLM = args.rateLimit > 0
		? withRateLimit(rawCallLLM, { requestsPerSecond: args.rateLimit, burst: args.rateBurst })
		: rawCallLLM;
	console.log(`  Using: ${displayName}`);
	if (args.rateLimit > 0) {
		console.log(`  Rate limit: ${args.rateLimit} req/s, burst: ${args.rateBurst}`);
	}

	// Build model aliases (defaults + user overrides)
	const apiKey = process.env.OPENROUTER_API_KEY!;
	const models = buildModelAliases(args.modelAliases, apiKey);
	if (models) {
		console.log(`  Model aliases: ${Object.keys(models).join(", ")}`);
	}
	console.log();

	// Load plugins via stack (profile + drivers + app)
	let pluginBodies: string | undefined;
	const hasPlugins = args.profile || args.app || args.drivers.length > 0 || args.model;
	if (hasPlugins) {
		console.log("Loading plugins...");
		const bodies = await loadStack({
			profile: args.profile ?? undefined,
			app: args.app ?? undefined,
			drivers: args.drivers.length > 0 ? args.drivers : undefined,
			model: args.model,
		});
		if (bodies) {
			pluginBodies = bodies;
			if (args.profile) console.log(`  Profile: ${args.profile}`);
			if (args.app) console.log(`  App: ${args.app}`);
			if (args.drivers.length > 0) console.log(`  Extra drivers: ${args.drivers.join(", ")}`);
			console.log(`  Plugin bodies: ${bodies.length} chars`);
		} else {
			console.log("  No plugins loaded (no matching profile)");
		}
		console.log();
	}

	// Load tasks
	console.log("Loading tasks...");
	const benchmarkConfig = getBenchmarkConfig(args);
	const tasks = await benchmarkConfig.loadTasks();
	console.log(`  Loaded ${tasks.length} tasks`);

	if (tasks.length === 0) {
		console.error("No tasks loaded. Check your dataset and filters.");
		process.exit(1);
	}

	// Show sample task
	const sample = tasks[0];
	console.log(`  Sample task: "${sample.query.slice(0, 100)}${sample.query.length > 100 ? "..." : ""}"`);
	console.log(`  Context length: ${sample.context.length.toLocaleString()} chars`);
	console.log(`  Expected: "${String(sample.expected).slice(0, 80)}"`);
	console.log();

	// Run evaluation
	console.log("Running evaluation...");
	console.log();

	const startTime = Date.now();

	const result = await runEval(tasks, {
		benchmark: args.benchmark,
		model: args.model,
		callLLM,
		scoringFn: benchmarkConfig.scoringFn,
		maxIterations: args.maxIterations,
		maxDepth: args.maxDepth,
		concurrency: args.concurrency,
		pluginBodies,
		models,
		...(args.maxBlocksPerIteration && { maxBlocksPerIteration: args.maxBlocksPerIteration }),
		...(args.attempts > 1 && { attempts: args.attempts }),
		filter: args.filter ?? undefined,
		onProgress: printProgress,
	});

	const elapsed = Date.now() - startTime;
	console.log(`\nCompleted in ${formatDuration(elapsed)}`);

	// Print results
	printFinalResults(result);

	// Print results file location
	const resultsDir = new URL("results/", import.meta.url).pathname;
	console.log(`Results saved to: ${resultsDir}`);
}

main().catch((err) => {
	console.error("\nFatal error:", err.message ?? err);
	if (err.stack) {
		console.error(err.stack);
	}
	process.exit(1);
});
