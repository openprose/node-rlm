import type { TraceEntry } from "../src/rlm.js";

export interface EvalTask {
	id: string;
	query: string;
	context: string;
	expected: string | string[];
	metadata?: Record<string, unknown>;
}

export interface EvalResult {
	taskId: string;
	answer: string;
	expected: string | string[];
	score: number;
	iterations: number;
	trace: TraceEntry[];
	wallTimeMs: number;
	charCount: { input: number; output: number };
	error?: string;
}

export interface BenchmarkResult {
	benchmark: string;
	model: string;
	config: { maxIterations: number; maxDepth: number; concurrency: number; filter?: string };
	timestamp: string;
	results: EvalResult[];
	aggregate: {
		meanScore: number;
		medianScore: number;
		stdScore: number;
		p25Score: number;
		p75Score: number;
		meanIterations: number;
		medianIterations: number;
		meanWallTimeMs: number;
		totalWallTimeMs: number;
		totalInputChars: number;
		totalOutputChars: number;
		costEstimateUsd: number;
		completedTasks: number;
		failedTasks: number;
	};
}

export type ScoringFunction = (predicted: string, expected: string | string[], metadata?: Record<string, unknown>) => number;

export type DatasetLoader = () => Promise<EvalTask[]>;
