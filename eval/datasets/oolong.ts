// OOLONG dataset loader (oolongbench/oolong-synth from HuggingFace).
// Data is downloaded by eval/download.ts into eval/data/oolong/.

import { createReadStream, readdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { EvalTask } from "../types.js";

const EVAL_DIR = new URL("..", import.meta.url).pathname;
const DATA_DIR = join(EVAL_DIR, "data", "oolong");

interface OolongRow {
	id: number;
	context_len: number;
	dataset: string;
	context_window_text: string;
	context_window_text_with_labels: string;
	question: string;
	task_group: string;
	task: string;
	answer: string;
	answer_type: string;
	input_subset: string;
	num_labels: number;
	context_window_id: number;
}

export async function loadOolongTasks(
	datasetFilter = "trec_coarse",
	contextLen: number | null = 131072,
	maxTasks = 50,
	withLabels = false,
	filter?: Record<string, string[]>,
): Promise<EvalTask[]> {
	if (!existsSync(DATA_DIR)) {
		throw new Error(
			`OOLONG data not found at ${DATA_DIR}. Run 'npx tsx eval/download.ts' first.`,
		);
	}

	// Load with early filtering to avoid holding unneeded rows in memory
	let filtered = await loadRows(datasetFilter, contextLen);

	// Apply additional field filters (--filter flag)
	if (filter) {
		for (const [key, allowedValues] of Object.entries(filter)) {
			filtered = filtered.filter((row) => {
				const rowValue = String((row as unknown as Record<string, unknown>)[key]);
				return allowedValues.includes(rowValue);
			});
		}
		if (filtered.length === 0) {
			console.warn(
				`Warning: No rows remain after applying --filter. Check field names and values.`,
			);
		}
	}

	// Limit to maxTasks
	const tasks = filtered.slice(0, maxTasks);

	return tasks.map((row) => ({
		id: `oolong-${row.id}`,
		query: `The data is available in the \`context\` variable. ${row.question}`,
		context: withLabels ? row.context_window_text_with_labels : row.context_window_text,
		expected: normalizeAnswer(row.answer),
		metadata: {
			dataset: row.dataset,
			contextLen: row.context_len,
			taskGroup: row.task_group,
			task: row.task,
			answerType: row.answer_type,
			inputSubset: row.input_subset,
			numLabels: row.num_labels,
			contextWindowId: row.context_window_id,
		},
	}));
}

/**
 * Normalize OOLONG answer strings.
 *
 * The HuggingFace dataset stores answers as Python list literals, e.g.:
 *   "['abbreviation']"  -> "abbreviation"
 *   "['more common than']" -> "more common than"
 *   "['42']" -> "42"
 *   "[42]" -> "42"
 *
 * For multi-element lists, return all elements as a string array.
 */
function normalizeAnswer(raw: string): string | string[] {
	const trimmed = raw.trim();

	// Check for Python list format: ['value'] or [value]
	const listMatch = trimmed.match(/^\[(.+)\]$/s);
	if (!listMatch) return trimmed;

	const inner = listMatch[1];

	// Split by comma, handling quoted strings
	const elements: string[] = [];
	let current = "";
	let inQuote = false;
	let quoteChar = "";

	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (!inQuote && (ch === "'" || ch === '"')) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote && ch === ",") {
			const el = current.trim();
			if (el) elements.push(el);
			current = "";
			continue;
		} else {
			current += ch;
		}
	}
	const last = current.trim();
	if (last) elements.push(last);

	if (elements.length === 0) return trimmed;
	if (elements.length === 1) return elements[0];
	return elements;
}

/**
 * Load rows from the downloaded JSONL files with optional early filtering.
 * Uses streaming to avoid Node.js string length limits on large files.
 * Early filtering avoids holding all rows (with massive context text) in memory.
 */
async function loadRows(datasetFilter?: string, contextLen?: number | null): Promise<OolongRow[]> {
	const files = readdirSync(DATA_DIR).filter(
		(f) => f.endsWith(".jsonl"),
	);

	if (files.length === 0) {
		throw new Error(
			`No data files found in ${DATA_DIR}. Run 'npx tsx eval/download.ts' first.`,
		);
	}

	const rows: OolongRow[] = [];
	const allDatasets = new Set<string>();

	for (const file of files) {
		const filePath = join(DATA_DIR, file);
		const rl = createInterface({ input: createReadStream(filePath, "utf-8"), crlfDelay: Infinity });
		for await (const line of rl) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const row = JSON.parse(trimmed) as OolongRow;
				allDatasets.add(row.dataset);
				// Early filter: skip rows that don't match dataset or context_len
				if (datasetFilter && row.dataset !== datasetFilter) continue;
				if (contextLen !== undefined && contextLen !== null && row.context_len !== contextLen) continue;
				rows.push(row);
			} catch {}
		}
	}

	if (rows.length === 0 && datasetFilter) {
		console.warn(
			`Warning: No rows found with dataset="${datasetFilter}"${contextLen ? ` and context_len=${contextLen}` : ""}. ` +
			`Available datasets: ${[...allDatasets].join(", ")}.`,
		);
	}

	return rows;
}
