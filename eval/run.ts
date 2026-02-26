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
import { oolongScore, exactMatch, arcGridMatch, arc3Score, arcCompoundScore, gridsEqual } from "./scoring.js";
import { loadOolongTasks } from "./datasets/oolong.js";
import { generateSNIAHTasks } from "./datasets/s-niah.js";
import { loadArcTasks, loadArcCompoundBundle } from "./datasets/arc.js";
import { loadArc3Tasks } from "./datasets/arc3.js";
import { Arc3Client } from "./arc3-client.js";
import { loadStack, loadPlugins, loadProgram } from "../src/plugins.js";
import type { CallLLM, ModelEntry } from "../src/rlm.js";
import { DEFAULT_MODEL_ALIASES } from "../src/models.js";
import type { EvalResult, EvalTask, ScoringFunction } from "./types.js";
import { withRateLimit } from "./rate-limiter.js";
import { formatDuration } from "./utils.js";

/** Minimal .env loader. Does not handle quoting, multi-line values, or `export` prefix. */
function loadEnvFile(): void {
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
	childApps: string[];
	attempts: number;
	game: string | null;
	program: string | null;
	traceActions: boolean;
	reasoningEffort: string;
}

function usage(): never {
	console.log(`RLM Eval Harness

Usage: npx tsx eval/run.ts --benchmark <name> --model <provider/model-id> [options]

Benchmarks:
  oolong          OOLONG aggregation benchmark (trec_coarse, 50 tasks)
  s-niah          Single Needle in a Haystack (synthetic, ~48 tasks)
  arc             ARC-AGI-2 abstract reasoning (120 tasks)
  arc3            ARC-AGI-3 interactive games (API-based)
  arc-compound    ARC-AGI-2 compound learning (all tasks in one session)

Options:
  --benchmark <name>       Benchmark to run (required)
  --model <provider/id>    Model to use (required)
  --profile <name>         Load a named driver profile (e.g. gemini-3-flash)
  --app <name>             Load a named app plugin (e.g. structured-data-aggregation)
  --program <name>         Load a program from programs/<name>/ (mutually exclusive with --app)
  --drivers <list>         Comma-separated extra driver names (appended after profile drivers)
  --concurrency <n>        Parallel tasks (default: 5)
  --max-iterations <n>     Max REPL iterations (default: 15)
  --max-depth <n>          Max recursion depth (default: 2)
  --max-tasks <n>          Limit number of tasks
  --dataset-filter <s>     OOLONG: dataset field filter (default: trec_coarse)
  --context-len <n>        OOLONG: context_len filter (default: 131072)
  --tasks-per-length <n>   S-NIAH: tasks per context length (default: 8)
  --selected-problems <ids> ARC: comma-separated problem IDs to run
  --game <ids>             ARC-3: comma-separated game IDs (e.g. ls20,ft09)
  --attempts <n>           Attempts per task for pass@N (default: 1)
  --rate-limit <n>         Requests per second (default: 5, 0 to disable)
  --rate-burst <n>         Burst capacity (default: 10)
  --with-labels            OOLONG: use labeled context (context_window_text_with_labels)
  --model-alias <spec>     Register a model alias: alias=model[:tag1,tag2] (repeatable)
  --child-app <name>       Load a named app plugin for child delegation (repeatable)
  --trace-actions          ARC-3: record action log per task
  --reasoning-effort <s>   Reasoning effort: xhigh, high, medium, low, minimal, none (default: medium)
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
	const childApps: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			usage();
		}
		if (arg === "--with-labels") {
			flags.add("with-labels");
		} else if (arg === "--trace-actions") {
			flags.add("trace-actions");
		} else if (arg === "--trace-full") {
			flags.add("trace-actions");
		} else if (arg.startsWith("--") && i + 1 < argv.length) {
			const key = arg.slice(2);
			if (key === "model-alias") {
				modelAliases.push(argv[i + 1]);
			} else if (key === "child-app") {
				childApps.push(argv[i + 1]);
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
		traceActions: flags.has("trace-actions"),
		filter: args.filter ?? null,
		selectedProblems: args["selected-problems"]
			? args["selected-problems"].split(",").map((s) => s.trim())
			: [],
		modelAliases,
		childApps,
		attempts: parseInt(args.attempts ?? "1", 10),
		game: args.game ?? null,
		program: args.program ?? null,
		reasoningEffort: args["reasoning-effort"] ?? "medium",
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

function stripOpenRouterPrefix(id: string): string {
	return id.startsWith("openrouter/") ? id.slice("openrouter/".length) : id;
}

function resolveCallLLM(spec: string, reasoningEffort?: string): { callLLM: CallLLM; displayName: string } {
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

	const overrides: { maxTokens?: number; timeoutMs?: number; reasoningEffort?: string } = modelOverrides(spec);
	if (reasoningEffort && reasoningEffort !== "none") {
		overrides.reasoningEffort = reasoningEffort;
	}

	// Strip "openrouter/" prefix if present — OpenRouter expects "provider/model".
	const modelId = stripOpenRouterPrefix(spec);
	const displayName = parts[0] === "openrouter" ? `${modelId} (openrouter)` : `${spec} (openrouter)`;
	return { callLLM: fromOpenRouter(modelId, apiKey, overrides), displayName };
}

function buildModelAliases(aliases: string[], apiKey: string): Record<string, ModelEntry> | undefined {
	// Start with defaults
	const models: Record<string, ModelEntry> = {};
	for (const [alias, def] of Object.entries(DEFAULT_MODEL_ALIASES)) {
		const modelId = stripOpenRouterPrefix(def.modelId);
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
		const cleanModelId = stripOpenRouterPrefix(modelId);
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
	globalDocs?: string;
	childApps?: Record<string, string>;
	setupSandbox?: (task: EvalTask) => Record<string, unknown>;
	cleanupTask?: (task: EvalTask) => Promise<void>;
	getResultMetadata?: (task: EvalTask) => Record<string, unknown> | undefined;
}

function configureOolong(args: CliArgs): BenchmarkConfig {
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
}

function configureSNIAH(args: CliArgs): BenchmarkConfig {
	return {
		loadTasks: () => generateSNIAHTasks(
			args.tasksPerLength,
		).then((tasks) => args.maxTasks ? tasks.slice(0, args.maxTasks) : tasks),
		scoringFn: exactMatch,
	};
}

function configureArc(args: CliArgs): BenchmarkConfig {
	return {
		loadTasks: () => loadArcTasks(
			args.maxTasks,
			args.selectedProblems.length > 0 ? args.selectedProblems : undefined,
		),
		scoringFn: arcGridMatch,
	};
}

function configureArc3(args: CliArgs): BenchmarkConfig {
	if (!process.env.ARC3_API_KEY) {
		console.error("ARC3_API_KEY not set. Required for ARC-3 benchmark.");
		console.error("Set it in .env or as an environment variable.");
		process.exit(1);
	}
	const clients = new Map<string, Arc3Client>();

	// Load arc3 globalDocs from markdown file
	const arc3DocsPath = join(
		new URL(".", import.meta.url).pathname,
		"arc3-global-docs.md",
	);
	const arc3GlobalDocs = readFileSync(arc3DocsPath, "utf-8");

	return {
		loadTasks: () => loadArc3Tasks(
			args.game ? args.game.split(",").map((s) => s.trim()) : undefined,
			args.maxTasks,
		),
		scoringFn: arc3Score,
		globalDocs: arc3GlobalDocs,
		setupSandbox: (task) => {
			const gameId = task.metadata?.gameId as string;
			const client = new Arc3Client(gameId, undefined, { logActions: args.traceActions });
			clients.set(task.id, client);
			return { arc3: client };
		},
		getResultMetadata: (task) => {
			const client = clients.get(task.id);
			if (!client?.scorecardId) return undefined;
			return {
				scorecardId: client.scorecardId,
				replayUrl: `https://three.arcprize.org/scorecards/${client.scorecardId}`,
				actionLog: client.actionLog.length > 0 ? client.actionLog : undefined,
			};
		},
		cleanupTask: async (task) => {
			const client = clients.get(task.id);
			if (client) {
				await client.cleanup();
				clients.delete(task.id);
			}
		},
	};
}

function configureArcCompound(args: CliArgs): BenchmarkConfig {
	// Data loaded lazily in loadTasks, shared with setupSandbox via closure
	let loadedChallenges: Record<string, { train: Array<{ input: number[][]; output: number[][] }>; test: Array<{ input: number[][] }> }>;
	let loadedTaskIds: string[];
	// Expected answers keyed by taskId (single grid or array of grids)
	let expectedMap: Record<string, unknown>;

	// Submission state — hoisted so both setupSandbox and getResultMetadata can access
	const submissionCounts = new Map<string, number>();
	const correctTasks = new Set<string>();
	const submissionLog: Array<{ taskId: string; attempt: number; correct: boolean; remaining: number; timestampMs: number }> = [];
	const MAX_SUBMISSIONS = 2;

	// Child app bodies — loaded in loadTasks, consumed by harness for delegation
	let loadedChildApps: Record<string, string>;

	// Load globalDocs from markdown file (following arc3 pattern)
	const compoundDocsPath = join(
		new URL(".", import.meta.url).pathname,
		"arc-compound-global-docs.md",
	);
	const compoundGlobalDocs = readFileSync(compoundDocsPath, "utf-8");

	const config: BenchmarkConfig = {
		loadTasks: async () => {
			const { metaTask, challenges } = await loadArcCompoundBundle(
				args.maxTasks,
				args.selectedProblems.length > 0 ? args.selectedProblems : undefined,
			);
			loadedChallenges = challenges;
			loadedTaskIds = metaTask.metadata!.taskIds as string[];
			// Parse expectedMap from the metaTask for use in submission scoring
			expectedMap = JSON.parse(metaTask.expected as string);

			// Load child app plugins for orchestrator delegation
			const childAppNames = ["arc-compound-solver", "arc-compound-synthesizer"];
			loadedChildApps = {};
			for (const name of childAppNames) {
				loadedChildApps[name] = await loadPlugins([name], "apps");
			}
			config.childApps = loadedChildApps;

			return [metaTask];
		},
		scoringFn: arcCompoundScore,
		globalDocs: compoundGlobalDocs,
		setupSandbox: () => {
			const tasks: Record<string, object> = {};
			for (const id of loadedTaskIds) {
				tasks[id] = {
					train: loadedChallenges[id].train,
					test: loadedChallenges[id].test,
				};
			}

			const submitter = {
				submit(taskId: string, answer: unknown): { correct: boolean; remaining: number } {
					const used = submissionCounts.get(taskId) ?? 0;
					if (used >= MAX_SUBMISSIONS) {
						submissionLog.push({ taskId, attempt: used + 1, correct: false, remaining: 0, timestampMs: Date.now() });
						return { correct: false, remaining: 0 };
					}
					submissionCounts.set(taskId, used + 1);
					const remaining = MAX_SUBMISSIONS - used - 1;

					const expected = expectedMap[taskId];
					if (expected === undefined) {
						submissionLog.push({ taskId, attempt: used + 1, correct: false, remaining, timestampMs: Date.now() });
						return { correct: false, remaining };
					}

					const correct = gridsEqual(answer, expected);
					if (correct) correctTasks.add(taskId);
					submissionLog.push({ taskId, attempt: used + 1, correct, remaining, timestampMs: Date.now() });
					return { correct, remaining };
				},
				remaining(taskId: string): number {
					return MAX_SUBMISSIONS - (submissionCounts.get(taskId) ?? 0);
				},
				getResults(): Record<string, boolean> {
					const results: Record<string, boolean> = {};
					for (const id of loadedTaskIds) {
						results[id] = correctTasks.has(id);
					}
					return results;
				},
			};

			return {
				__arcTasks: tasks,
				__arcTaskIds: loadedTaskIds,
				__arcLibrary: { primitives: {}, strategies: [], antiPatterns: [], taskLog: [] },
				__arcCurrentTask: null,
				__arcSubmit: submitter,
			};
		},
		getResultMetadata: () => {
			return {
				totalTasks: loadedTaskIds.length,
				tasksAttempted: submissionCounts.size,
				totalCorrect: correctTasks.size,
				totalSubmissions: submissionLog.length,
				submissionLog,
			};
		},
	};
	return config;
}

function getBenchmarkConfig(args: CliArgs): BenchmarkConfig {
	switch (args.benchmark) {
		case "oolong":     return configureOolong(args);
		case "s-niah":     return configureSNIAH(args);
		case "arc":        return configureArc(args);
		case "arc3":       return configureArc3(args);
		case "arc-compound": return configureArcCompound(args);
		default:
			console.error(`Unknown benchmark: ${args.benchmark}`);
			console.error("Available benchmarks: oolong, s-niah, arc, arc3, arc-compound");
			process.exit(1);
	}
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

function printConfig(args: CliArgs): void {
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
	if (args.game) {
		console.log(`Game:            ${args.game}`);
	}
	if (args.filter) {
		console.log(`Filter:          ${args.filter}`);
	}
	if (args.withLabels) {
		console.log(`With Labels:     yes (using context_window_text_with_labels)`);
	}
	if (args.traceActions) {
		console.log(`Trace Actions:   yes (recording action log per task)`);
	}
	if (args.attempts > 1) {
		console.log(`Attempts:        ${args.attempts} (pass@${args.attempts})`);
	}
	if (args.rateLimit > 0) {
		console.log(`Rate Limit:      ${args.rateLimit} req/s (burst: ${args.rateBurst})`);
	}
	if (args.reasoningEffort && args.reasoningEffort !== "none") {
		console.log(`Reasoning:       ${args.reasoningEffort}`);
	}
	if (args.program) {
		console.log(`Program:         ${args.program}`);
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
	if (args.childApps.length > 0) {
		console.log(`Child Apps:      ${args.childApps.join(", ")}`);
	}
	console.log();
}

function resolveModel(args: CliArgs): { callLLM: CallLLM; models: Record<string, ModelEntry> | undefined } {
	console.log("Resolving model...");
	const { callLLM: rawCallLLM, displayName } = resolveCallLLM(args.model, args.reasoningEffort);
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

	return { callLLM, models };
}

async function loadAllPlugins(args: CliArgs): Promise<{
	pluginBodies: string | undefined;
	programGlobalDocs: string;
	programChildApps: Record<string, string>;
	cliChildApps: Record<string, string> | undefined;
}> {
	// Validate: --app and --program are mutually exclusive
	if (args.app && args.program) {
		console.error("Error: --app and --program cannot be used together (program provides its own root app)");
		process.exit(1);
	}

	// Load program if specified
	let programGlobalDocs = "";
	let programChildApps: Record<string, string> = {};
	let programRootBody = "";
	if (args.program) {
		console.log(`Loading program: ${args.program}...`);
		const programDef = await loadProgram(args.program);
		programRootBody = programDef.rootAppBody;
		programGlobalDocs = programDef.globalDocs;
		programChildApps = programDef.childApps;
		console.log(`  Root app: ${programDef.rootApp}`);
		console.log(`  Child apps: ${Object.keys(programDef.childApps).join(", ")}`);
		console.log(`  Global docs: ${programDef.globalDocs.length} chars`);
		console.log();
	}

	// Load plugins via stack (profile + drivers + app)
	let pluginBodies: string | undefined;
	const hasPlugins = args.profile || args.app || args.drivers.length > 0 || args.model;
	if (hasPlugins) {
		console.log("Loading plugins...");
		const bodies = await loadStack({
			profile: args.profile ?? undefined,
			app: args.app ?? undefined, // null in program mode — program provides root app
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

	// In program mode, append root app body to plugin bodies (after any profile drivers)
	if (programRootBody) {
		pluginBodies = pluginBodies
			? `${pluginBodies}\n\n---\n\n${programRootBody}`
			: programRootBody;
	}

	// Load child app plugins (for delegation via `app` option)
	let cliChildApps: Record<string, string> | undefined;
	if (args.childApps.length > 0) {
		console.log("Loading child apps...");
		cliChildApps = {};
		for (const name of args.childApps) {
			const body = await loadPlugins([name], "apps");
			cliChildApps[name] = body;
			console.log(`  ${name}: ${body.length} chars`);
		}
		console.log();
	}

	return { pluginBodies, programGlobalDocs, programChildApps, cliChildApps };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	printConfig(args);

	const { callLLM, models } = resolveModel(args);
	const { pluginBodies, programGlobalDocs, programChildApps, cliChildApps } = await loadAllPlugins(args);

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

	// Merge globalDocs: benchmark + program (both visible at all depths)
	const combinedGlobalDocs = [benchmarkConfig.globalDocs, programGlobalDocs]
		.filter(Boolean)
		.join("\n\n---\n\n") || undefined;

	// Merge childApps: benchmark + program + CLI
	const allChildApps = { ...benchmarkConfig.childApps, ...programChildApps, ...cliChildApps };
	const hasChildApps = Object.keys(allChildApps).length > 0;

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
		attempts: args.attempts,
		setupSandbox: benchmarkConfig.setupSandbox,
		cleanupTask: benchmarkConfig.cleanupTask,
		getResultMetadata: benchmarkConfig.getResultMetadata,
		globalDocs: combinedGlobalDocs,
		childApps: hasChildApps ? allChildApps : undefined,
		reasoningEffort: args.reasoningEffort !== "none" ? args.reasoningEffort : undefined,
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
