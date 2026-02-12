#!/usr/bin/env node
// Downloads the OOLONG dataset into eval/data/oolong/.
// Default mode (--from-release): downloads pre-built asset from GitHub Release.
// HuggingFace mode (--from-hf): downloads from oolongbench/oolong-synth via HF API.
// Usage: npx tsx eval/download.ts [--from-release | --from-hf] [--dataset oolong] [--max-rows N]

import { createReadStream, createWriteStream, existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const EVAL_DIR = new URL(".", import.meta.url).pathname;
const DATA_DIR = join(EVAL_DIR, "data");
const OOLONG_DIR = join(DATA_DIR, "oolong");

// HuggingFace Datasets Server API
const HF_API_BASE = "https://datasets-server.huggingface.co";
const OOLONG_DATASET = "oolongbench/oolong-synth";

// Default split: validation has trec_coarse (the paper's eval split) + spam
// Test split has metaphors/negation (not needed for standard OOLONG eval)
const DEFAULT_SPLITS = ["validation"];

// We fetch rows in pages of this size (smaller = more reliable with HF API and lower memory pressure)
const PAGE_SIZE = 20;

// Maximum rows to download per split (0 = all)
const MAX_ROWS = 11000;

// GitHub Release asset download
const GITHUB_REPO = "openprose/node-rlm";
const RELEASE_TAG = "eval-data-v1";
const RELEASE_ASSET = "oolong-trec-coarse-validation.jsonl.gz";

interface HFRowsResponse {
	features: Array<{ name: string; type: { dtype?: string; _type?: string } }>;
	rows: Array<{ row_idx: number; row: Record<string, unknown>; truncated_cells: string[] }>;
	num_rows_total: number;
	num_rows_per_page: number;
	partial: boolean;
}

async function fetchJson<T>(url: string, retries = 5, delayMs = 3000): Promise<T | null> {
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
			if (response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delayMs * attempt;
				console.log(`  Rate limited, waiting ${waitMs}ms before retry ${attempt}/${retries}...`);
				await new Promise((r) => setTimeout(r, waitMs));
				continue;
			}
			if (response.status >= 500) {
				const waitMs = delayMs * attempt;
				if (attempt < retries) {
					console.log(`  Server error ${response.status}, retrying in ${waitMs}ms (${attempt}/${retries})...`);
					await new Promise((r) => setTimeout(r, waitMs));
					continue;
				}
				console.log(`  Server error ${response.status} after ${retries} attempts, skipping page.`);
				return null;
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			// Parse JSON inside retry loop so connection drops during body read are retried
			return (await response.json()) as T;
		} catch (err) {
			if (attempt === retries) {
				console.log(`  Request failed after ${retries} attempts: ${err}. Skipping page.`);
				return null;
			}
			console.log(`  Request failed (attempt ${attempt}/${retries}): ${err}. Retrying in ${delayMs * attempt}ms...`);
			await new Promise((r) => setTimeout(r, delayMs * attempt));
		}
	}
	return null;
}

async function downloadSplit(split: string, maxRows: number): Promise<number> {
	console.log(`\n--- Downloading split: ${split} ---`);

	const outputFile = join(OOLONG_DIR, `${split}.jsonl`);
	const progressFile = join(OOLONG_DIR, `.download-progress-${split}`);

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
		writeFileSync(outputFile, "");
	}

	// Get total row count
	const infoUrl = `${HF_API_BASE}/rows?dataset=${encodeURIComponent(OOLONG_DATASET)}&config=default&split=${split}&offset=0&length=1`;
	console.log("  Fetching dataset info...");
	const infoData = await fetchJson<HFRowsResponse>(infoUrl);
	if (!infoData) {
		console.log(`  Could not fetch info for split ${split}, skipping.`);
		return 0;
	}
	const totalRows = maxRows > 0 ? Math.min(infoData.num_rows_total, maxRows) : infoData.num_rows_total;
	console.log(`  Total rows in split: ${infoData.num_rows_total}`);
	console.log(`  Downloading up to: ${totalRows}`);

	let downloaded = startOffset;
	let skippedPages = 0;

	while (downloaded < totalRows) {
		const length = Math.min(PAGE_SIZE, totalRows - downloaded);
		const url = `${HF_API_BASE}/rows?dataset=${encodeURIComponent(OOLONG_DATASET)}&config=default&split=${split}&offset=${downloaded}&length=${length}`;

		const data = await fetchJson<HFRowsResponse>(url);
		if (!data) {
			// Skip this page but keep going
			skippedPages++;
			downloaded += length;
			continue;
		}

		if (!data.rows || data.rows.length === 0) {
			console.log("  No more rows returned, stopping.");
			break;
		}

		const lines = data.rows.map((r) => JSON.stringify(r.row));
		appendFileSync(outputFile, lines.join("\n") + "\n");

		downloaded += data.rows.length;
		writeFileSync(progressFile, String(downloaded));

		const pct = Math.round((downloaded / totalRows) * 100);
		process.stdout.write(`\r  Progress: ${downloaded}/${totalRows} rows (${pct}%)${skippedPages ? ` [${skippedPages} pages skipped]` : ""}`);
	}

	console.log();
	console.log(`  Downloaded to ${outputFile}`);
	if (skippedPages > 0) {
		console.log(`  Warning: ${skippedPages} pages skipped due to server errors`);
	}

	// Clean up progress file
	if (existsSync(progressFile)) {
		unlinkSync(progressFile);
	}

	return downloaded;
}

async function downloadOolong(maxRows: number, requestedSplits: string[]): Promise<void> {
	console.log("Downloading OOLONG dataset from HuggingFace...");
	console.log(`  Dataset: ${OOLONG_DATASET}`);
	console.log(`  Splits: ${requestedSplits.join(", ")}`);
	console.log(`  Target directory: ${OOLONG_DIR}`);

	mkdirSync(OOLONG_DIR, { recursive: true });

	let totalDownloaded = 0;
	for (const split of requestedSplits) {
		totalDownloaded += await downloadSplit(split, maxRows);
	}

	console.log(`\n  Total rows downloaded across all splits: ${totalDownloaded}`);

	// Summarize all data files
	await summarizeData(requestedSplits);
}

async function summarizeData(requestedSplits: string[]): Promise<void> {
	console.log();
	console.log("Dataset summary:");

	const datasets = new Map<string, number>();
	const contextLens = new Map<number, number>();
	let totalRows = 0;

	for (const split of requestedSplits) {
		const filePath = join(OOLONG_DIR, `${split}.jsonl`);
		if (!existsSync(filePath)) continue;

		// Stream line-by-line to avoid Node.js string length limits on large files
		const rl = createInterface({ input: createReadStream(filePath, "utf-8"), crlfDelay: Infinity });
		for await (const line of rl) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			totalRows++;
			try {
				const row = JSON.parse(trimmed) as { dataset: string; context_len: number };
				datasets.set(row.dataset, (datasets.get(row.dataset) ?? 0) + 1);
				contextLens.set(row.context_len, (contextLens.get(row.context_len) ?? 0) + 1);
			} catch {
				// skip
			}
		}
	}

	console.log(`  Total rows: ${totalRows}`);
	console.log(`  Datasets: ${[...datasets.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}`);
	console.log(
		`  Context lengths: ${[...contextLens.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([k, v]) => `${k}(${v})`)
			.join(", ")}`,
	);
}

async function downloadFromRelease(): Promise<void> {
	const assetUrl = `https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/${RELEASE_ASSET}`;
	const outputFile = join(OOLONG_DIR, "validation.jsonl");

	console.log("Downloading OOLONG dataset from GitHub Release...");
	console.log(`  Asset: ${RELEASE_ASSET}`);
	console.log(`  URL: ${assetUrl}`);
	console.log(`  Target: ${outputFile}`);

	mkdirSync(OOLONG_DIR, { recursive: true });

	const response = await fetch(assetUrl, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok) {
		throw new Error(`Failed to download release asset: HTTP ${response.status} ${response.statusText}`);
	}
	if (!response.body) {
		throw new Error("Response body is empty");
	}

	await pipeline(
		Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
		createGunzip(),
		createWriteStream(outputFile),
	);

	console.log(`  Downloaded and decompressed to ${outputFile}`);

	await summarizeData(["validation"]);
}

function parseArgs(argv: string[]): { dataset: string; maxRows: number; splits: string[]; source: "release" | "hf" } {
	const args: Record<string, string> = {};
	const flags = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--from-release" || arg === "--from-hf") {
			flags.add(arg.slice(2));
		} else if (arg.startsWith("--") && i + 1 < argv.length) {
			args[arg.slice(2)] = argv[i + 1];
			i++;
		}
	}

	let source: "release" | "hf" = "release";
	if (flags.has("from-hf")) {
		source = "hf";
	}

	return {
		dataset: args.dataset ?? "oolong",
		maxRows: args["max-rows"] ? parseInt(args["max-rows"], 10) : MAX_ROWS,
		splits: args.splits ? args.splits.split(",") : DEFAULT_SPLITS,
		source,
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	console.log("RLM Eval — Dataset Downloader");
	console.log("=============================");
	console.log();

	switch (args.dataset) {
		case "oolong":
			if (args.source === "release") {
				await downloadFromRelease();
			} else {
				await downloadOolong(args.maxRows, args.splits);
			}
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
