#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromProviderModel } from "./drivers/openrouter-compatible.js";
import { rlm } from "./rlm.js";

function usage(): never {
	console.log(`Usage: node-rlm --query <query> [options]

Options:
  --query <text>          The question or task (required)
  --context-file <path>   Load context from a file
  --context-dir <path>    Load context from a directory (concatenates all files)
  --model <provider/id>   Model (default: openrouter/google/gemini-3-flash-preview)
  --base-url <url>        Custom API base URL (for Ollama, vLLM, etc.)
  --max-iterations <n>    Maximum iterations (default: 15)
  --max-depth <n>         Maximum recursion depth (default: 3)

Model format: provider/model-id (e.g. openrouter/google/gemini-3-flash-preview, openai/gpt-4o)

Examples:
  node-rlm --query "Summarize this file" --context-file ./data.txt
  node-rlm --query "Find all TODO comments" --context-dir ./src/
  node-rlm --query "What is 2+2"
  node-rlm --query "Hello" --model openai/gpt-4o
  node-rlm --query "Hello" --model custom/my-model --base-url http://localhost:11434/v1
`);
	process.exit(1);
}

function parseArgs(argv: string[]): {
	query: string;
	contextFile?: string;
	contextDir?: string;
	model: string;
	baseUrl?: string;
	maxIterations: number;
	maxDepth: number;
} {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--") && i + 1 < argv.length) {
			args[arg.slice(2)] = argv[i + 1];
			i++;
		}
	}

	if (!args.query) {
		usage();
	}

	return {
		query: args.query,
		contextFile: args["context-file"],
		contextDir: args["context-dir"],
		model: args.model ?? "openrouter/google/gemini-3-flash-preview",
		baseUrl: args["base-url"],
		maxIterations: parseInt(args["max-iterations"] ?? "15", 10),
		maxDepth: parseInt(args["max-depth"] ?? "3", 10),
	};
}

function loadContextDir(dirPath: string): string {
	const absPath = resolve(dirPath);
	const parts: string[] = [];

	function walk(dir: string) {
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				walk(fullPath);
			} else if (stat.isFile()) {
				try {
					const content = readFileSync(fullPath, "utf-8");
					parts.push(`=== ${fullPath.slice(absPath.length + 1)} ===\n${content}`);
				} catch {
					// Skip binary or unreadable files
				}
			}
		}
	}

	walk(absPath);
	return parts.join("\n\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	let context: string | undefined;
	if (args.contextFile) {
		context = readFileSync(resolve(args.contextFile), "utf-8");
	} else if (args.contextDir) {
		context = loadContextDir(args.contextDir);
	}

	const callLLM = fromProviderModel(args.model, {
		baseUrl: args.baseUrl,
	});

	console.log(`Model: ${args.model}`);
	if (args.baseUrl) console.log(`Base URL: ${args.baseUrl}`);
	if (context) console.log(`Context: ${context.length.toLocaleString()} characters`);
	console.log(`Max iterations: ${args.maxIterations}`);
	console.log(`Max depth: ${args.maxDepth}`);
	console.log(`---`);
	console.log();

	const result = await rlm(args.query, context, {
		callLLM,
		maxIterations: args.maxIterations,
		maxDepth: args.maxDepth,
	});

	for (const entry of result.trace) {
		if (entry.reasoning) {
			console.log(entry.reasoning);
		}
		if (entry.code.length > 0) {
			console.log(`\n--- REPL Output ---`);
			if (entry.output) console.log(entry.output);
			if (entry.error) console.log(`ERROR: ${entry.error}`);
			console.log(`--- End REPL ---\n`);
		}
	}

	console.log(`\n===== ANSWER =====`);
	console.log(result.answer);
	console.log(`==================`);
	console.log(`(${result.iterations} iteration${result.iterations === 1 ? "" : "s"})`);
}

main().catch((err) => {
	console.error("Error:", err.message ?? err);
	process.exit(1);
});
