#!/usr/bin/env node
// Downloads the OOLONG dataset (oolongbench/oolong-synth) from HuggingFace into eval/data/oolong/.
// Usage: npx tsx eval/download.ts [--dataset oolong]

import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const EVAL_DIR = new URL(".", import.meta.url).pathname;
const DATA_DIR = join(EVAL_DIR, "data");
const OOLONG_DIR = join(DATA_DIR, "oolong");

// HuggingFace Datasets Server API
const HF_API_BASE = "https://datasets-server.huggingface.co";
const OOLONG_DATASET = "oolongbench/oolong-synth";
const OOLONG_SPLIT = "test";

// We fetch rows in pages of this size
const PAGE_SIZE = 100;

// Maximum rows to download (the test split has ~10.6K rows; we only need a subset)
// The paper used 50 tasks from trec_coarse at 131K context. We download more to
// ensure we have enough after filtering.
const MAX_ROWS = 11000;

interface HFRowsResponse {
	features: Array<{ name: string; type: { dtype?: string; _type?: string } }>;
	rows: Array<{ row_idx: number; row: Record<string, unknown>; truncated_cells: string[] }>;
	num_rows_total: number;
	num_rows_per_page: number;
	partial: boolean;
}

async function fetchWithRetry(url: string, retries = 3, delayMs = 2000): Promise<Response> {
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await fetch(url);
			if (response.status === 429) {
				// Rate limited — wait and retry
				const retryAfter = response.headers.get("retry-after");
				const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delayMs * attempt;
				console.log(`  Rate limited, waiting ${waitMs}ms before retry ${attempt}/${retries}...`);
				await new Promise((r) => setTimeout(r, waitMs));
				continue;
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			return response;
		} catch (err) {
			if (attempt === retries) throw err;
			console.log(`  Request failed (attempt ${attempt}/${retries}): ${err}. Retrying in ${delayMs * attempt}ms...`);
			await new Promise((r) => setTimeout(r, delayMs * attempt));
		}
	}
	throw new Error("Unreachable");
}

async function downloadOolong(): Promise<void> {
	console.log("Downloading OOLONG dataset from HuggingFace...");
	console.log(`  Dataset: ${OOLONG_DATASET}`);
	console.log(`  Split: ${OOLONG_SPLIT}`);
	console.log(`  Target directory: ${OOLONG_DIR}`);
	console.log();

	mkdirSync(OOLONG_DIR, { recursive: true });

	const outputFile = join(OOLONG_DIR, `${OOLONG_SPLIT}.jsonl`);
	const progressFile = join(OOLONG_DIR, ".download-progress");

	// Check for resumability
	let startOffset = 0;
	if (existsSync(progressFile)) {
		const progress = readFileSync(progressFile, "utf-8").trim();
		startOffset = parseInt(progress, 10);
		if (Number.isFinite(startOffset) && startOffset > 0) {
			console.log(`  Resuming from offset ${startOffset}...`);
		} else {
			startOffset = 0;
		}
	}

	if (startOffset === 0) {
		// Fresh download — clear any existing file
		writeFileSync(outputFile, "");
	}

	// First, get the total row count
	const infoUrl = `${HF_API_BASE}/rows?dataset=${encodeURIComponent(OOLONG_DATASET)}&config=default&split=${OOLONG_SPLIT}&offset=0&length=1`;
	console.log("  Fetching dataset info...");
	const infoResponse = await fetchWithRetry(infoUrl);
	const infoData = (await infoResponse.json()) as HFRowsResponse;
	const totalRows = Math.min(infoData.num_rows_total, MAX_ROWS);
	console.log(`  Total rows in split: ${infoData.num_rows_total}`);
	console.log(`  Downloading up to: ${totalRows}`);
	console.log();

	let downloaded = startOffset;

	while (downloaded < totalRows) {
		const length = Math.min(PAGE_SIZE, totalRows - downloaded);
		const url = `${HF_API_BASE}/rows?dataset=${encodeURIComponent(OOLONG_DATASET)}&config=default&split=${OOLONG_SPLIT}&offset=${downloaded}&length=${length}`;

		const response = await fetchWithRetry(url);
		const data = (await response.json()) as HFRowsResponse;

		if (!data.rows || data.rows.length === 0) {
			console.log("  No more rows returned, stopping.");
			break;
		}

		// Append rows as JSONL
		const lines = data.rows.map((r) => JSON.stringify(r.row));
		appendFileSync(outputFile, lines.join("\n") + "\n");

		downloaded += data.rows.length;

		// Save progress
		writeFileSync(progressFile, String(downloaded));

		const pct = Math.round((downloaded / totalRows) * 100);
		process.stdout.write(`\r  Progress: ${downloaded}/${totalRows} rows (${pct}%)`);
	}

	console.log();
	console.log(`  Downloaded ${downloaded} rows to ${outputFile}`);

	// Clean up progress file
	if (existsSync(progressFile)) {
		unlinkSync(progressFile);
	}

	// Print summary stats
	summarizeData(outputFile);
}

function summarizeData(filePath: string): void {
	console.log();
	console.log("Dataset summary:");

	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n").filter((l) => l.trim());

	const datasets = new Map<string, number>();
	const contextLens = new Map<number, number>();

	for (const line of lines) {
		try {
			const row = JSON.parse(line) as { dataset: string; context_len: number };
			datasets.set(row.dataset, (datasets.get(row.dataset) ?? 0) + 1);
			contextLens.set(row.context_len, (contextLens.get(row.context_len) ?? 0) + 1);
		} catch {
			// skip
		}
	}

	console.log(`  Total rows: ${lines.length}`);
	console.log(`  Datasets: ${[...datasets.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}`);
	console.log(
		`  Context lengths: ${[...contextLens.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([k, v]) => `${k}(${v})`)
			.join(", ")}`,
	);
}

function parseArgs(argv: string[]): { dataset: string } {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--") && i + 1 < argv.length) {
			args[arg.slice(2)] = argv[i + 1];
			i++;
		}
	}
	return {
		dataset: args.dataset ?? "oolong",
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	console.log("RLM Eval — Dataset Downloader");
	console.log("=============================");
	console.log();

	switch (args.dataset) {
		case "oolong":
			await downloadOolong();
			break;
		case "s-niah":
			console.log("S-NIAH is a synthetic benchmark — no download needed.");
			console.log("Tasks are generated programmatically at eval time.");
			break;
		default:
			console.error(`Unknown dataset: ${args.dataset}`);
			console.error("Available datasets: oolong, s-niah");
			process.exit(1);
	}

	console.log();
	console.log("Done.");
}

main().catch((err) => {
	console.error("Download failed:", err.message ?? err);
	process.exit(1);
});
