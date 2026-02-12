// Post-hoc trace analysis for RLM eval results.
// Usage: npx tsx eval/analyze.ts [result-file.json ...]

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { BenchmarkResult, EvalResult } from "./types.js";

interface TaskAnalysis {
	taskId: string;
	score: number;
	iterations: number;
	totalCodeBlocks: number;
	totalCodeLines: number;
	codeBlocksPerIteration: number;
	hasRlmCall: boolean;
	rlmCallCount: number;
	hasConsoleLog: boolean;
	usesLetConst: boolean;
	errorCount: number;
	eagerReturn: boolean; // return called in first trace entry
	selfCorrected: boolean; // score > 0 and iterations > 1
	wallTimeMs: number;
}

function analyzeTask(result: EvalResult): TaskAnalysis {
	let totalCodeBlocks = 0;
	let totalCodeLines = 0;
	let rlmCallCount = 0;
	let hasConsoleLog = false;
	let usesLetConst = false;
	let errorCount = 0;
	let eagerReturn = false;

	for (let i = 0; i < result.trace.length; i++) {
		const entry = result.trace[i];
		totalCodeBlocks += entry.code.length;

		for (const block of entry.code) {
			totalCodeLines += block.split("\n").length;

			// Count rlm() calls (but not the string "rlm" in comments/strings)
			const rlmMatches = block.match(/\brlm\s*\(/g);
			if (rlmMatches) rlmCallCount += rlmMatches.length;

			if (block.includes("console.log(") || block.includes("console.error(")) {
				hasConsoleLog = true;
			}
			if (/\b(?:let|const)\s/.test(block)) usesLetConst = true;

			// Check for return in first trace entry
			if (i === 0 && /\breturn[\s(]/.test(block)) eagerReturn = true;
		}

		if (entry.error) errorCount++;
	}

	return {
		taskId: result.taskId,
		score: result.score,
		iterations: result.iterations,
		totalCodeBlocks,
		totalCodeLines,
		codeBlocksPerIteration: result.trace.length > 0 ? totalCodeBlocks / result.trace.length : 0,
		hasRlmCall: rlmCallCount > 0,
		rlmCallCount,
		hasConsoleLog,
		usesLetConst,
		errorCount,
		eagerReturn,
		selfCorrected: result.score > 0 && result.iterations > 1,
		wallTimeMs: result.wallTimeMs,
	};
}

function stats(arr: number[]) {
	if (arr.length === 0) return { mean: 0, p20: 0, median: 0, p80: 0, min: 0, max: 0 };
	const sorted = [...arr].sort((a, b) => a - b);
	const pct = (p: number) => {
		const idx = (p / 100) * (sorted.length - 1);
		const lo = Math.floor(idx);
		const hi = Math.ceil(idx);
		if (lo === hi) return sorted[lo];
		return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
	};
	const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
	return {
		mean: round(mean),
		p20: round(pct(20)),
		median: round(pct(50)),
		p80: round(pct(80)),
		min: round(Math.min(...arr)),
		max: round(Math.max(...arr)),
	};
}

function round(n: number, decimals = 2): number {
	const factor = 10 ** decimals;
	return Math.round(n * factor) / factor;
}

function pct(count: number, total: number): string {
	if (total === 0) return "0%";
	return `${round((count / total) * 100, 1)}%`;
}

function printTable(headers: string[], rows: (string | number)[][]) {
	const allRows = [headers, ...rows.map((r) => r.map(String))];
	const widths = headers.map((_, col) => Math.max(...allRows.map((r) => String(r[col] ?? "").length)));

	const sep = widths.map((w) => "-".repeat(w + 2)).join("+");
	const fmt = (row: (string | number)[]) => row.map((cell, i) => ` ${String(cell).padStart(widths[i])} `).join("|");

	console.log(fmt(headers));
	console.log(sep);
	for (const row of rows) console.log(fmt(row));
}

function analyzeFile(filePath: string) {
	const raw = readFileSync(filePath, "utf-8");
	const data: BenchmarkResult = JSON.parse(raw);

	console.log(`\n${"=".repeat(72)}`);
	console.log(`  ${data.benchmark} | ${data.model} | ${data.timestamp}`);
	console.log(`  ${data.results.length} tasks | cost: $${data.aggregate.costEstimateUsd}`);
	console.log(`${"=".repeat(72)}\n`);

	const analyses = data.results.map(analyzeTask);
	const n = analyses.length;

	// --- 1. Iteration & code volume ---
	console.log("ITERATION & CODE VOLUME");
	printTable(
		["metric", "mean", "p20", "median", "p80", "min", "max"],
		[
			["iterations", ...Object.values(stats(analyses.map((a) => a.iterations)))],
			["code blocks/task", ...Object.values(stats(analyses.map((a) => a.totalCodeBlocks)))],
			["code lines/task", ...Object.values(stats(analyses.map((a) => a.totalCodeLines)))],
			["blocks/iteration", ...Object.values(stats(analyses.map((a) => a.codeBlocksPerIteration)))],
			["wall time (s)", ...Object.values(stats(analyses.map((a) => a.wallTimeMs / 1000)))],
		],
	);

	// --- 2. Behavioral patterns ---
	console.log("\nBEHAVIORAL PATTERNS");

	const eagerReturnCount = analyses.filter((a) => a.eagerReturn).length;
	const selfCorrectedCount = analyses.filter((a) => a.selfCorrected).length;
	const rlmUsers = analyses.filter((a) => a.hasRlmCall).length;
	const loggers = analyses.filter((a) => a.hasConsoleLog).length;
	const letConstUsers = analyses.filter((a) => a.usesLetConst).length;
	const withErrors = analyses.filter((a) => a.errorCount > 0).length;
	const failed = analyses.filter((a) => a.score === 0).length;
	const eagerAndFailed = analyses.filter((a) => a.eagerReturn && a.score === 0).length;
	const eagerAndSucceeded = analyses.filter((a) => a.eagerReturn && a.score > 0).length;

	printTable(
		["pattern", "count", "rate", "notes"],
		[
			["eager return (iter 1)", eagerReturnCount, pct(eagerReturnCount, n), `${eagerAndFailed} failed, ${eagerAndSucceeded} succeeded`],
			["self-corrected", selfCorrectedCount, pct(selfCorrectedCount, n), "score > 0 with iterations > 1"],
			["used rlm()", rlmUsers, pct(rlmUsers, n), `${analyses.reduce((s, a) => s + a.rlmCallCount, 0)} total calls`],
			["used console.log", loggers, pct(loggers, n), ""],
			["used let/const", letConstUsers, pct(letConstUsers, n), "risk of cross-block scoping bugs"],
			["had errors", withErrors, pct(withErrors, n), `${analyses.reduce((s, a) => s + a.errorCount, 0)} total errors`],
			["score = 0", failed, pct(failed, n), ""],
		],
	);

	// --- 3. Score distribution ---
	console.log("\nSCORE DISTRIBUTION");
	const scoreBuckets = new Map<string, number>();
	for (const a of analyses) {
		const bucket = a.score === 1 ? "1.0" : a.score === 0 ? "0.0" : a.score.toFixed(2);
		scoreBuckets.set(bucket, (scoreBuckets.get(bucket) ?? 0) + 1);
	}
	const sortedBuckets = [...scoreBuckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
	printTable(
		["score", "count", "rate"],
		sortedBuckets.map(([score, count]) => [score, count, pct(count, n)]),
	);

	// --- 4. Iteration distribution ---
	console.log("\nITERATION DISTRIBUTION");
	const iterBuckets = new Map<number, { total: number; succeeded: number }>();
	for (const a of analyses) {
		const bucket = iterBuckets.get(a.iterations) ?? { total: 0, succeeded: 0 };
		bucket.total++;
		if (a.score > 0) bucket.succeeded++;
		iterBuckets.set(a.iterations, bucket);
	}
	const sortedIters = [...iterBuckets.entries()].sort((a, b) => a[0] - b[0]);
	printTable(
		["iterations", "count", "succeeded", "success rate"],
		sortedIters.map(([iter, { total, succeeded }]) => [iter, total, succeeded, pct(succeeded, total)]),
	);

	// --- 5. Group by metadata (e.g., context length for S-NIAH) ---
	const byGroup = new Map<string, TaskAnalysis[]>();
	for (let i = 0; i < data.results.length; i++) {
		const result = data.results[i];
		const analysis = analyses[i];
		// Try to extract a grouping key from the task ID
		// S-NIAH: "sniah-8000-0" → "8K", OOLONG: "oolong-14000056" → no group
		const sniahMatch = result.taskId.match(/^sniah-(\d+)-/);
		if (sniahMatch) {
			const chars = parseInt(sniahMatch[1], 10);
			const label = chars >= 1000 ? `${chars / 1000}K` : `${chars}`;
			const group = byGroup.get(label) ?? [];
			group.push(analysis);
			byGroup.set(label, group);
		}
	}

	if (byGroup.size > 1) {
		console.log("\nBY CONTEXT LENGTH");
		const sortedGroups = [...byGroup.entries()].sort(
			(a, b) => parseFloat(a[0]) - parseFloat(b[0]),
		);
		printTable(
			["context", "tasks", "accuracy", "mean iter", "eager return", "rlm() used", "errors"],
			sortedGroups.map(([label, group]) => {
				const succeeded = group.filter((a) => a.score > 0).length;
				const eager = group.filter((a) => a.eagerReturn).length;
				const rlm = group.filter((a) => a.hasRlmCall).length;
				const errs = group.filter((a) => a.errorCount > 0).length;
				return [
					label,
					group.length,
					pct(succeeded, group.length),
					round(group.reduce((s, a) => s + a.iterations, 0) / group.length),
					pct(eager, group.length),
					pct(rlm, group.length),
					errs,
				];
			}),
		);
	}

	console.log();

	// Write GitHub Actions Job Summary if running in CI
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		const md = buildMarkdownSummary(data, analyses);
		appendFileSync(summaryPath, md);
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function buildMarkdownSummary(data: BenchmarkResult, analyses: TaskAnalysis[]): string {
	const { aggregate: agg } = data;
	const n = analyses.length;
	const score = round(agg.meanScore * 100, 1);
	const cfg = data.config;

	const lines: string[] = [];

	// Header
	lines.push(`## ${data.benchmark.toUpperCase()} — ${score}%`);
	lines.push("");
	lines.push(`**${data.model}** | maxDepth=${cfg.maxDepth} maxIter=${cfg.maxIterations} concurrency=${cfg.concurrency}${cfg.filter ? ` filter=${cfg.filter}` : ""}`);
	lines.push(`${agg.completedTasks} completed, ${agg.failedTasks} failed | ${formatDuration(agg.totalWallTimeMs)} | ~$${agg.costEstimateUsd.toFixed(2)}`);
	lines.push("");

	// Score stats
	lines.push("### Scores");
	lines.push("");
	lines.push(`| Mean | Median | Std | P25 | P75 |`);
	lines.push(`|------|--------|-----|-----|-----|`);
	lines.push(`| ${round(agg.meanScore * 100, 1)}% | ${round(agg.medianScore * 100, 1)}% | ${round(agg.stdScore * 100, 1)}% | ${round(agg.p25Score * 100, 1)}% | ${round(agg.p75Score * 100, 1)}% |`);
	lines.push("");

	// Per-task results
	lines.push("### Tasks");
	lines.push("");
	lines.push("| Task | Score | Iters | Time | Answer | Expected |");
	lines.push("|------|-------|-------|------|--------|----------|");
	for (const result of data.results) {
		const scoreStr = result.score === 1 ? "1.00" : result.score === 0 ? "0" : result.score.toFixed(2);
		const answer = truncate(result.answer, 40);
		const expected = truncate(String(result.expected), 40);
		const errTag = result.error ? " **ERR**" : "";
		lines.push(`| ${result.taskId} | ${scoreStr} | ${result.iterations} | ${formatDuration(result.wallTimeMs)} | ${escapemd(answer)}${errTag} | ${escapemd(expected)} |`);
	}
	lines.push("");

	// Behavioral patterns
	const eagerCount = analyses.filter((a) => a.eagerReturn).length;
	const selfCorrected = analyses.filter((a) => a.selfCorrected).length;
	const rlmUsers = analyses.filter((a) => a.hasRlmCall).length;
	const withErrors = analyses.filter((a) => a.errorCount > 0).length;

	lines.push("<details><summary>Behavioral patterns</summary>");
	lines.push("");
	lines.push("| Pattern | Count | Rate |");
	lines.push("|---------|-------|------|");
	lines.push(`| Eager return (iter 1) | ${eagerCount} | ${pct(eagerCount, n)} |`);
	lines.push(`| Self-corrected | ${selfCorrected} | ${pct(selfCorrected, n)} |`);
	lines.push(`| Used rlm() | ${rlmUsers} | ${pct(rlmUsers, n)} |`);
	lines.push(`| Had errors | ${withErrors} | ${pct(withErrors, n)} |`);
	lines.push("");

	// Iteration distribution
	lines.push("**Iterations:**");
	lines.push(`Mean ${round(agg.meanIterations, 1)} | Median ${round(agg.medianIterations, 1)}`);
	lines.push("");
	lines.push("</details>");
	lines.push("");

	return lines.join("\n");
}

function truncate(s: string, max: number): string {
	const oneline = s.replace(/\n/g, " ");
	if (oneline.length <= max) return oneline;
	return oneline.slice(0, max - 1) + "\u2026";
}

function escapemd(s: string): string {
	return s.replace(/\|/g, "\\|");
}

const RESULTS_DIR = join(new URL(".", import.meta.url).pathname, "results");

const files = process.argv.slice(2);
if (files.length === 0) {
	// Analyze all result files
	const allFiles = readdirSync(RESULTS_DIR)
		.filter((f: string) => f.endsWith(".json"))
		.sort();

	if (allFiles.length === 0) {
		console.log("No result files found in eval/results/");
		process.exit(1);
	}

	for (const f of allFiles) {
		analyzeFile(join(RESULTS_DIR, f));
	}
} else {
	for (const f of files) {
		analyzeFile(f);
	}
}
