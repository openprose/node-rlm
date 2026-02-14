const COMPARISON_PHRASES = [
	"more common",
	"less common",
	"same frequency",
];

/**
 * Exact match scoring. Returns 1 if predicted === expected (after trimming
 * and case-insensitive comparison), 0 otherwise.
 *
 * Used for: S-NIAH.
 */
export function exactMatch(predicted: string, expected: string | string[]): number {
	const norm = (s: string) => s.trim().toLowerCase();
	const pred = norm(predicted);

	if (Array.isArray(expected)) {
		// Match if any of the expected values match
		return expected.some((e) => norm(e) === pred) ? 1 : 0;
	}
	return norm(expected) === pred ? 1 : 0;
}

/**
 * OOLONG scoring function.
 *
 * For ANSWER_TYPE.NUMERIC answers: score = 0.75^|y - y_hat|
 *   This rewards close answers exponentially — off by 1 gets 0.75, off by 2 gets 0.5625, etc.
 *
 * For all other answer types: exact match (case-sensitive, trimmed), matching
 * the official Python scorer: str(trimmed_output) == str(gold).
 *
 * Additionally strips markdown bold asterisks and bracket wrappers from predicted
 * text before matching, matching the official Python scorer's replace("*", "")
 * .replace("[", "").replace("]", "").
 *
 * OOLONG questions instruct the model to wrap answers in formats like:
 *   "Answer: X is [VALUE] Y", "User: [VALUE]", "Label: [VALUE]"
 * The expected answer is the unwrapped core value, so we extract it before comparing.
 *
 * Used for: OOLONG (trec_coarse).
 */
export function oolongScore(predicted: string, expected: string | string[], metadata?: Record<string, unknown>): number {
	const expectedStr = Array.isArray(expected) ? expected[0] : expected;
	const answerType = metadata?.answerType as string | undefined;
	return oolongScoreSingle(predicted, expectedStr, answerType);
}

function oolongScoreSingle(predicted: string, expected: string, answerType?: string): number {
	const predTrimmed = stripOolongFormatting(predicted.trim());
	const expTrimmed = expected.trim();

	// Try scoring with the raw predicted value first
	const rawScore = oolongScoreRaw(predTrimmed, expTrimmed, answerType);
	if (rawScore > 0) return rawScore;

	// Try extracting the core value from format-wrapped responses
	const extracted = extractOolongValue(predTrimmed, expTrimmed);
	if (extracted !== null) {
		return oolongScoreRaw(extracted, expTrimmed, answerType);
	}

	// Fallback: extract comparison phrase using substring matching (no "Answer:" prefix)
	const expLower = expTrimmed.toLowerCase();
	if (COMPARISON_PHRASES.some((p) => expLower.includes(p))) {
		const compMatch = predTrimmed.match(
			/\b(more common(?:\s+than)?|less common(?:\s+than)?|same frequency(?:\s+as)?)\b/i,
		);
		if (compMatch) return oolongScoreRaw(compMatch[1].trim(), expTrimmed, answerType);
	}

	return 0;
}

function stripOolongFormatting(s: string): string {
	return s.replace(/\*/g, "").replace(/\[/g, "").replace(/\]/g, "");
}

/**
 * Core OOLONG scoring logic (numeric proximity or exact text match).
 *
 * Numeric partial credit (0.75^diff) is only applied when answerType is
 * "ANSWER_TYPE.NUMERIC". For all other answer types, it's exact match only.
 *
 * Text comparison is case-sensitive, matching the official Python scorer.
 */
function oolongScoreRaw(predicted: string, expected: string, answerType?: string): number {
	const allowNumeric = answerType === "ANSWER_TYPE.NUMERIC";

	if (allowNumeric) {
		const predNum = parseNumber(predicted);
		const expNum = parseNumber(expected);

		if (expNum !== null && predNum !== null) {
			const diff = Math.abs(expNum - predNum);
			return Math.pow(0.75, diff);
		}
	}

	return predicted === expected ? 1 : 0;
}

/**
 * Extract the core answer value from an OOLONG format-wrapped response.
 *
 * Handles patterns the questions instruct the model to use:
 *   "User: <value>", "Label: <value>", "Date: <value>", "Answer: <value>"
 *   "Answer: X is <comparison> Y" (e.g. "Answer: human being is more common than abbreviation")
 */
function extractOolongValue(predicted: string, expected: string): string | null {
	const prefixMatch = predicted.match(/^(Answer|Label|User|Date)\s*:\s*(.+)$/is);
	if (!prefixMatch) return null;

	const prefix = prefixMatch[1].toLowerCase();
	const rest = prefixMatch[2].trim();

	// For Label, User, Date — the rest IS the value
	if (prefix !== "answer") return rest;

	// For "Answer:" — check for comparison pattern "X is [COMPARISON] Y"
	const expLower = expected.toLowerCase();
	if (COMPARISON_PHRASES.some((p) => expLower.includes(p))) {
		const compMatch = rest.match(
			/\bis\s+(more common(?:\s+than)?|less common(?:\s+than)?|same frequency(?:\s+as)?)\b/i,
		);
		if (compMatch) return compMatch[1].trim();
	}

	// Otherwise, the rest after "Answer:" is the value itself
	return rest;
}

/**
 * F1 score over predicted pairs vs expected pairs.
 *
 * Each answer is expected to be a set of pairs, formatted as one pair per line:
 *   "item1, item2"
 *
 * F1 = 2 * precision * recall / (precision + recall)
 *
 * Used for: OOLONG-Pairs.
 */
export function f1Score(predicted: string, expected: string | string[]): number {
	const parsePairs = (text: string): Set<string> => {
		const pairs = new Set<string>();
		const lines = text.trim().split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			// Normalize: split by comma, sort the two items, rejoin
			const parts = trimmed.split(",").map((p) => p.trim().toLowerCase());
			if (parts.length >= 2) {
				const sorted = [parts[0], parts[1]].sort();
				pairs.add(`${sorted[0]}|||${sorted[1]}`);
			}
		}
		return pairs;
	};

	const expectedStr = Array.isArray(expected) ? expected.join("\n") : expected;

	const predPairs = parsePairs(predicted);
	const expPairs = parsePairs(expectedStr);

	if (expPairs.size === 0 && predPairs.size === 0) return 1;
	if (expPairs.size === 0 || predPairs.size === 0) return 0;

	let truePositives = 0;
	for (const pair of predPairs) {
		if (expPairs.has(pair)) truePositives++;
	}

	const precision = truePositives / predPairs.size;
	const recall = truePositives / expPairs.size;

	if (precision + recall === 0) return 0;
	return (2 * precision * recall) / (precision + recall);
}

/**
 * Multiple choice scoring. The predicted answer should contain the correct
 * option letter (A, B, C, D). We extract the first uppercase letter from
 * the predicted answer and compare.
 *
 * Used for: CodeQA (LongBench-v2).
 */
export function multipleChoice(predicted: string, expected: string | string[]): number {
	const expectedStr = Array.isArray(expected) ? expected[0] : expected;

	// Extract answer letter from predicted text
	// Look for patterns like "A", "(A)", "Answer: A", etc.
	const predMatch = predicted.trim().match(/\b([A-D])\b/);
	const expMatch = expectedStr.trim().match(/\b([A-D])\b/);

	if (!predMatch || !expMatch) {
		// Fallback to exact match if no letter found
		return predicted.trim().toLowerCase() === expectedStr.trim().toLowerCase() ? 1 : 0;
	}

	return predMatch[1] === expMatch[1] ? 1 : 0;
}

/**
 * ARC grid exact match scoring.
 *
 * Compares predicted and expected grids (2D arrays of integers).
 * Both are expected to be JSON strings representing 2D arrays.
 * Returns 1 if the grids have identical shape and values, 0 otherwise.
 *
 * Handles both single-grid and multi-grid (multiple test inputs) cases.
 *
 * Used for: ARC-AGI.
 */
export function arcGridMatch(predicted: string, expected: string | string[]): number {
	const expectedStr = Array.isArray(expected) ? expected[0] : expected;

	try {
		const predGrid = parseArcGrid(predicted.trim());
		const expGrid = JSON.parse(expectedStr);

		if (predGrid === null) return 0;

		return gridsEqual(predGrid, expGrid) ? 1 : 0;
	} catch {
		return 0;
	}
}

/**
 * Parse a predicted ARC grid from LLM output.
 * Handles various formats the model might return:
 * - Raw JSON: [[1,2],[3,4]]
 * - Markdown-wrapped: ```json\n[[1,2],[3,4]]\n```
 * - With explanation text before/after the JSON
 */
function parseArcGrid(text: string): unknown | null {
	// Try direct JSON parse first
	try {
		return JSON.parse(text);
	} catch {
		// Ignore
	}

	// Try extracting JSON from markdown code blocks
	const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (codeBlockMatch) {
		try {
			return JSON.parse(codeBlockMatch[1].trim());
		} catch {
			// Ignore
		}
	}

	// Try finding the first JSON array in the text
	const arrayMatch = text.match(/(\[[\s\S]*\])/);
	if (arrayMatch) {
		try {
			return JSON.parse(arrayMatch[1]);
		} catch {
			// Ignore
		}
	}

	return null;
}

/**
 * Deep equality check for grids (2D or 3D arrays of numbers).
 */
function gridsEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, i) => gridsEqual(item, b[i]));
	}
	return a === b;
}

/**
 * ARC-AGI-3 scoring. Parses the scorecard JSON returned by the agent
 * and computes the average per-level efficiency (0-1).
 *
 * The API scorecard contains `score` (sum of per-level baseline/actual ratios)
 * and `total_levels`. Dividing gives the average efficiency.
 *
 * Used for: ARC-AGI-3.
 */
export function arc3Score(predicted: string, _expected: string | string[]): number {
	try {
		const data = JSON.parse(predicted);
		if (typeof data.score === "number" && typeof data.total_levels === "number") {
			return data.total_levels > 0
				? Math.min(1, data.score / data.total_levels)
				: 0;
		}
		return 0;
	} catch {
		return 0;
	}
}

function parseNumber(s: string): number | null {
	// Remove common formatting: commas, whitespace, brackets
	const cleaned = s.replace(/[\[\]\s,]/g, "").trim();
	if (cleaned === "") return null;
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
}
