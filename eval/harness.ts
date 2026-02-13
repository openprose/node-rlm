import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rlm, RlmError, RlmMaxIterationsError } from "../src/rlm.js";
import type { CallLLM, ModelEntry } from "../src/rlm.js";
import type {
	BenchmarkResult,
	EvalResult,
	EvalTask,
	ScoringFunction,
} from "./types.js";

export interface HarnessConfig {
	/** Benchmark name (e.g., "oolong", "s-niah"). */
	benchmark: string;
	/** Model identifier string (e.g., "anthropic/claude-sonnet-4-20250514"). */
	model: string;
	/** The callLLM function to use. */
	callLLM: CallLLM;
	/** Scoring function for this benchmark. */
	scoringFn: ScoringFunction;
	/** Maximum REPL iterations per task (default: 15). */
	maxIterations?: number;
	/** Maximum recursion depth (default: 2). */
	maxDepth?: number;
	/** Number of tasks to run concurrently (default: 5). */
	concurrency?: number;
	/** Directory to save results (default: eval/results/). */
	resultsDir?: string;
	/** Concatenated plugin bodies to append to the system prompt. */
	pluginBodies?: string;
	/** Named model aliases available for child delegation. */
	models?: Record<string, ModelEntry>;
	/** Max code blocks to execute per LLM response (1 = enforce single-block). */
	maxBlocksPerIteration?: number;
	/** Raw --filter string for resumability tracking. */
	filter?: string;
	/** Progress callback, called after each task completes. */
	onProgress?: (completed: number, total: number, result: EvalResult) => void;
}

const EVAL_DIR = new URL(".", import.meta.url).pathname;
const DEFAULT_RESULTS_DIR = join(EVAL_DIR, "results");

export async function runEval(
	tasks: EvalTask[],
	config: HarnessConfig,
): Promise<BenchmarkResult> {
	const maxIterations = config.maxIterations ?? 15;
	const maxDepth = config.maxDepth ?? 2;
	const concurrency = config.concurrency ?? 5;
	const resultsDir = config.resultsDir ?? DEFAULT_RESULTS_DIR;

	mkdirSync(resultsDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const resultsFile = join(
		resultsDir,
		`${config.benchmark}_${config.model.replace(/\//g, "_")}_${timestamp}.json`,
	);

	// Check for existing partial results for resumability (must match config)
	const completedResults = loadPartialResults(resultsDir, config.benchmark, config.model, {
		maxIterations,
		maxDepth,
		concurrency,
		filter: config.filter,
	});
	const completedIds = new Set(completedResults.map((r) => r.taskId));

	const pendingTasks = tasks.filter((t) => !completedIds.has(t.id));
	const results: EvalResult[] = [...completedResults];

	if (completedResults.length > 0) {
		console.log(`Resuming: ${completedResults.length} tasks already completed, ${pendingTasks.length} remaining.`);
	}

	// Run tasks with concurrency control using a reliable pool pattern.
	// Each promise in the pool removes itself when it settles.
	const startTime = Date.now();
	let completed = completedResults.length;

	const pool = new Set<Promise<void>>();

	const handleTask = (task: EvalTask): Promise<void> => {
		const p = runSingleTask(task, config.callLLM, config.scoringFn, maxIterations, maxDepth, config.pluginBodies, config.models, config.maxBlocksPerIteration)
			.then((result) => {
				results.push(result);
				completed++;
				config.onProgress?.(completed, tasks.length, result);
				saveResults(resultsFile, buildBenchmarkResult(config, tasks.length, results, maxIterations, maxDepth, concurrency));
			})
			.catch((err) => {
				const failedResult: EvalResult = {
					taskId: task.id,
					answer: "",
					expected: task.expected,
					score: 0,
					iterations: 0,
					trace: [],
					wallTimeMs: 0,
					charCount: { input: 0, output: 0 },
					error: err instanceof Error ? err.message : String(err),
				};
				results.push(failedResult);
				completed++;
				config.onProgress?.(completed, tasks.length, failedResult);
				saveResults(resultsFile, buildBenchmarkResult(config, tasks.length, results, maxIterations, maxDepth, concurrency));
			})
			.finally(() => {
				pool.delete(p);
			});
		return p;
	};

	for (const task of pendingTasks) {
		const p = handleTask(task);
		pool.add(p);

		if (pool.size >= concurrency) {
			await Promise.race(pool);
		}
	}

	if (pool.size > 0) {
		await Promise.allSettled([...pool]);
	}

	const totalWallTimeMs = Date.now() - startTime;

	const benchmarkResult = buildBenchmarkResult(
		config,
		tasks.length,
		results,
		maxIterations,
		maxDepth,
		concurrency,
	);
	benchmarkResult.aggregate.totalWallTimeMs = totalWallTimeMs;

	// Final save
	saveResults(resultsFile, benchmarkResult);

	return benchmarkResult;
}

async function runSingleTask(
	task: EvalTask,
	callLLM: CallLLM,
	scoringFn: ScoringFunction,
	maxIterations: number,
	maxDepth: number,
	pluginBodies?: string,
	models?: Record<string, ModelEntry>,
	maxBlocksPerIteration?: number,
): Promise<EvalResult> {
	const startTime = Date.now();

	// Wrap callLLM to track character counts
	let totalInputChars = 0;
	let totalOutputChars = 0;

	const wrappedCallLLM: CallLLM = async (messages, systemPrompt) => {
		totalInputChars += systemPrompt.length;
		for (const msg of messages) {
			totalInputChars += msg.content.length;
		}

		const response = await callLLM(messages, systemPrompt);
		totalOutputChars += response.length;
		return response;
	};

	try {
		const result = await rlm(task.query, task.context, {
			callLLM: wrappedCallLLM,
			maxIterations,
			maxDepth,
			pluginBodies,
			...(models && { models }),
			...(maxBlocksPerIteration && { maxBlocksPerIteration }),
		});

		const wallTimeMs = Date.now() - startTime;
		const score = scoringFn(result.answer, task.expected, task.metadata);

		return {
			taskId: task.id,
			answer: result.answer,
			expected: task.expected,
			score,
			iterations: result.iterations,
			trace: result.trace,
			wallTimeMs,
			charCount: { input: totalInputChars, output: totalOutputChars },
		};
	} catch (err) {
		const wallTimeMs = Date.now() - startTime;
		const errMsg = err instanceof Error ? err.message : String(err);

		// Preserve trace data from all RLM failures (max-iteration, callLLM errors, etc.)
		const trace = err instanceof RlmError ? err.trace : [];
		const iterations = err instanceof RlmError ? err.iterations : 0;

		return {
			taskId: task.id,
			answer: "",
			expected: task.expected,
			score: 0,
			iterations,
			trace,
			wallTimeMs,
			charCount: { input: totalInputChars, output: totalOutputChars },
			error: errMsg,
		};
	}
}

function buildBenchmarkResult(
	config: HarnessConfig,
	totalTasks: number,
	results: EvalResult[],
	maxIterations: number,
	maxDepth: number,
	concurrency: number,
): BenchmarkResult {
	const scores = results.map((r) => r.score);
	const iterations = results.map((r) => r.iterations);
	const wallTimes = results.map((r) => r.wallTimeMs);

	const completedTasks = results.filter((r) => !r.error).length;
	const failedTasks = results.filter((r) => !!r.error).length;

	const totalInputChars = results.reduce((sum, r) => sum + r.charCount.input, 0);
	const totalOutputChars = results.reduce((sum, r) => sum + r.charCount.output, 0);

	const inputTokensApprox = totalInputChars / 4;
	const outputTokensApprox = totalOutputChars / 4;
	const costEstimateUsd =
		(inputTokensApprox / 1_000_000) * 3 + (outputTokensApprox / 1_000_000) * 15;

	return {
		benchmark: config.benchmark,
		model: config.model,
		config: { maxIterations, maxDepth, concurrency, ...(config.filter ? { filter: config.filter } : {}) },
		timestamp: new Date().toISOString(),
		results,
		aggregate: {
			meanScore: mean(scores),
			medianScore: median(scores),
			stdScore: std(scores),
			p25Score: percentile(scores, 25),
			p75Score: percentile(scores, 75),
			meanIterations: mean(iterations),
			medianIterations: median(iterations),
			meanWallTimeMs: mean(wallTimes),
			totalWallTimeMs: wallTimes.reduce((a, b) => a + b, 0),
			totalInputChars,
			totalOutputChars,
			costEstimateUsd: Math.round(costEstimateUsd * 100) / 100,
			completedTasks,
			failedTasks,
		},
	};
}

/**
 * Load partial results from previous runs for resumability.
 * Looks for the most recent results file matching the benchmark, model, AND config.
 * Only resumes from a file whose maxIterations, maxDepth, and concurrency match.
 */
function loadPartialResults(
	resultsDir: string,
	benchmark: string,
	model: string,
	currentConfig: { maxIterations: number; maxDepth: number; concurrency: number; filter?: string },
): EvalResult[] {
	if (!existsSync(resultsDir)) return [];

	const prefix = `${benchmark}_${model.replace(/\//g, "_")}_`;

	const files = readdirSync(resultsDir)
		.filter((f: string) => f.startsWith(prefix) && f.endsWith(".json"))
		.sort()
		.reverse();

	if (files.length === 0) return [];

	for (const file of files) {
		try {
			const content = readFileSync(join(resultsDir, file), "utf-8");
			const data = JSON.parse(content) as BenchmarkResult;
			const cfg = data.config;
			// Only resume from results that have the same config
			if (
				cfg &&
				cfg.maxIterations === currentConfig.maxIterations &&
				cfg.maxDepth === currentConfig.maxDepth &&
				cfg.concurrency === currentConfig.concurrency &&
				(cfg.filter ?? undefined) === (currentConfig.filter ?? undefined)
			) {
				return data.results ?? [];
			}
		} catch {
			continue;
		}
	}

	return [];
}

function saveResults(filePath: string, result: BenchmarkResult): void {
	writeFileSync(filePath, JSON.stringify(result, null, 2));
}

function mean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function std(arr: number[]): number {
	if (arr.length <= 1) return 0;
	const m = mean(arr);
	const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length;
	return Math.sqrt(variance);
}

function percentile(arr: number[], p: number): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const index = (p / 100) * (sorted.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	const frac = index - lower;
	return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}
