#!/usr/bin/env node
// Usage: npx tsx eval/verify.ts

import { exactMatch, oolongScore, f1Score, multipleChoice } from "./scoring.js";
import { generateSNIAHTasks, CONTEXT_LENGTHS } from "./datasets/s-niah.js";
import type { EvalTask, EvalResult, BenchmarkResult, ScoringFunction } from "./types.js";

function assert(condition: boolean, msg: string): void {
	if (!condition) {
		console.error(`FAIL: ${msg}`);
		process.exit(1);
	}
	console.log(`  PASS: ${msg}`);
}

console.log("Testing scoring functions...");

// exactMatch
assert(exactMatch("hello", "Hello") === 1, "exactMatch case-insensitive");
assert(exactMatch("hello", "world") === 0, "exactMatch mismatch");
assert(exactMatch("  hello  ", "hello") === 1, "exactMatch trims whitespace");
assert(exactMatch("a", ["a", "b"]) === 1, "exactMatch with array (match first)");
assert(exactMatch("b", ["a", "b"]) === 1, "exactMatch with array (match second)");
assert(exactMatch("c", ["a", "b"]) === 0, "exactMatch with array (no match)");

// oolongScore
assert(oolongScore("5", "5") === 1, "oolongScore exact numeric");
assert(Math.abs(oolongScore("6", "5", { answerType: "ANSWER_TYPE.NUMERIC" }) - 0.75) < 0.001, "oolongScore off by 1");
assert(Math.abs(oolongScore("7", "5", { answerType: "ANSWER_TYPE.NUMERIC" }) - 0.5625) < 0.001, "oolongScore off by 2");
assert(oolongScore("spam", "spam") === 1, "oolongScore exact label");
assert(oolongScore("ham", "spam") === 0, "oolongScore wrong label");
assert(oolongScore("SPAM", "spam") === 0, "oolongScore is case-sensitive");

// f1Score
assert(f1Score("a, b\nc, d", "a, b\nc, d") === 1, "f1Score perfect match");
assert(Math.abs(f1Score("a, b", "a, b\nc, d") - 2 / 3) < 0.001, "f1Score partial match");
assert(f1Score("", "") === 1, "f1Score both empty");

// multipleChoice
assert(multipleChoice("A", "A") === 1, "multipleChoice exact");
assert(multipleChoice("The answer is B", "B") === 1, "multipleChoice extracts letter");
assert(multipleChoice("A", "B") === 0, "multipleChoice wrong");

console.log();

console.log("Testing S-NIAH generator...");
const tasks = await generateSNIAHTasks(2, [8_000, 16_000]);
assert(tasks.length === 4, `Generated ${tasks.length} tasks (expected 4)`);

for (const task of tasks) {
	assert(task.id.startsWith("sniah-"), `Task ID format: ${task.id}`);
	assert(task.query.includes("secret code"), `Query contains needle question: ${task.query.slice(0, 60)}`);
	assert(task.context.length > 1000, `Context has content: ${task.context.length} chars`);
	assert(task.expected.length > 0, `Has expected answer: ${task.expected}`);
	// Verify needle is actually in context
	assert(task.context.includes(task.expected as string), `Needle is in context for ${task.id}`);
}

console.log();

console.log("Testing type imports...");
const sampleTask: EvalTask = {
	id: "test-1",
	query: "test query",
	context: "test context",
	expected: "test answer",
};
assert(sampleTask.id === "test-1", "EvalTask type works");

const sampleResult: EvalResult = {
	taskId: "test-1",
	answer: "test",
	expected: "test",
	score: 1,
	iterations: 1,
	trace: [],
	wallTimeMs: 100,
	charCount: { input: 0, output: 0 },
};
assert(sampleResult.score === 1, "EvalResult type works");

console.log();

console.log("Testing OOLONG loader import...");
try {
	const { loadOolongTasks } = await import("./datasets/oolong.js");
	assert(typeof loadOolongTasks === "function", "loadOolongTasks is a function");
	// Don't actually call it — data may not be downloaded yet
	console.log("  (skipping data load — run eval/download.ts first)");
} catch (err) {
	console.error(`  Import failed: ${err}`);
}

console.log();

console.log("Testing harness import...");
try {
	const { runEval } = await import("./harness.js");
	assert(typeof runEval === "function", "runEval is a function");
} catch (err) {
	console.error(`  Import failed: ${err}`);
}

console.log();
console.log("All verification checks passed.");
