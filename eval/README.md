# RLM Eval

Benchmarks for measuring RLM performance across models.

## Setup

Requires an `OPENROUTER_API_KEY` in a `.env` file in the package root. All models route through OpenRouter.

Download OOLONG data (one-time):

```bash
npx tsx eval/download.ts
```

S-NIAH data is generated synthetically at runtime.

## Running Benchmarks

```bash
# S-NIAH (Single Needle in a Haystack) — ~48 tasks, all context lengths
npx tsx eval/run.ts --benchmark s-niah --model anthropic/claude-sonnet-4-20250514

# OOLONG (long-context aggregation) — 50 tasks, trec_coarse
npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-sonnet-4-20250514 --context-len 16384

# With options
npx tsx eval/run.ts --benchmark s-niah --model anthropic/claude-sonnet-4-20250514 \
  --concurrency 10 --max-iterations 10 --max-depth 3 --tasks-per-length 4
```

Run `npx tsx eval/run.ts --help` for all options.

## Plugins: Profiles, Drivers, and Apps

The plugin system has three kinds of plugins:

- **Drivers** — model-specific reliability patches (e.g., suppress hallucinated tool calls, enforce one code block per response). Stack multiple drivers per run.
- **Apps** — task architectures (e.g., structured data aggregation, recursive delegation). Typically one app per run.
- **Profiles** — named bundles of drivers for a model family. Profiles declare glob patterns to auto-match model strings.

### CLI Flags

| Flag | Description |
|---|---|
| `--profile <name>` | Load a named driver profile (e.g., `gemini-3-flash`) |
| `--app <name>` | Load a named app plugin (e.g., `structured-data-aggregation`) |
| `--drivers <list>` | Comma-separated extra driver names (appended after profile drivers) |

### Auto-detection

When `--model` is provided and no `--profile` is given, the CLI scans all profile files and matches the model string against their `models` glob patterns. If a match is found, that profile's drivers are loaded automatically.

For example, `--model openrouter/google/gemini-3-flash-preview` auto-detects the `gemini-3-flash` profile and loads all five reliability drivers.

### Examples

```bash
# Auto-detect profile from model name, with an app
npx tsx eval/run.ts --benchmark oolong --model openrouter/google/gemini-3-flash-preview \
  --app structured-data-aggregation

# Explicit profile + app
npx tsx eval/run.ts --benchmark oolong --model openrouter/google/gemini-3-flash-preview \
  --profile gemini-3-flash --app structured-data-aggregation

# Extra drivers on top of auto-detected profile
npx tsx eval/run.ts --benchmark oolong --model openrouter/google/gemini-3-flash-preview \
  --drivers verify-before-return --app structured-data-aggregation

# No profile needed — capable models get no extra prompt overhead
npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-sonnet-4-20250514 \
  --app structured-data-aggregation
```

Results are saved as timestamped JSON files in `eval/results/` (gitignored). Each run creates a new file — previous results are never overwritten.

## Analyzing Results

```bash
# Analyze all result files
npx tsx eval/analyze.ts

# Analyze specific files
npx tsx eval/analyze.ts eval/results/s-niah_anthropic_claude-sonnet-4_2026-02-08T21-18-21-437Z.json
```

The analyzer reports:

- **Iteration and code volume** — iterations per task, code blocks, code lines (mean, p20, median, p80, min, max)
- **Behavioral patterns** — eager RETURN rate, self-correction rate, recursive `rlm()` usage, `console.log` usage, `let/const` usage, error rate
- **Score and iteration distributions** — histograms with success rates
- **Context-length breakdown** — for S-NIAH, accuracy and patterns grouped by context size

## File Structure

| File | Purpose |
|---|---|
| `run.ts` | CLI entry point, model resolution, argument parsing |
| `harness.ts` | Core eval runner with concurrency, resumability, incremental saves |
| `analyze.ts` | Post-hoc trace analysis |
| `scoring.ts` | Scoring functions: `exactMatch`, `oolongScore`, `f1Score`, `multipleChoice` |
| `types.ts` | Shared types: `EvalTask`, `EvalResult`, `BenchmarkResult` |
| `download.ts` | Downloads OOLONG data from HuggingFace |
| `datasets/s-niah.ts` | Synthetic needle-in-haystack task generator |
| `datasets/oolong.ts` | OOLONG dataset loader |
| `drivers/openrouter.ts` | OpenRouter `CallLLM` driver |
| `data/` | Downloaded datasets (gitignored) |
| `results/` | Benchmark result JSON files (gitignored) |
| `analyses/` | Per-run analysis documents with hyperparameters, scores, and qualitative notes (gitignored) |
