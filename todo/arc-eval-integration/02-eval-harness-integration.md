# ARC Eval Harness Integration Plan

How to integrate ARC-AGI-2 into the existing eval harness as `--benchmark arc`.

We are benchmarking **our RLM agent** against the same ARC-AGI-2 tasks that arcgentica used. The agent runs as-is — no modifications, no Python, no special scaffolding. Arcgentica's 85.28% is a reference baseline from a different agent architecture; we're measuring where RLM lands on the same test.

## 1. ARC EvalTask Design

### Mapping ARC Tasks to EvalTask

```typescript
interface EvalTask {
  id: string;                        // ARC task ID, e.g., "arc-0934a4d8"
  query: string;                     // The prompt instructing the model
  context: string;                   // The ARC task data (serialized)
  expected: string | string[];       // The expected output grid(s) as JSON string
  metadata?: Record<string, unknown>;
}
```

### Task ID Format

```
arc-{taskId}          e.g., "arc-0934a4d8"
```

### Query Construction

The query must instruct the model to:
1. Analyze the training examples (input/output pairs)
2. Discover the transformation rule
3. Apply it to the test input(s)
4. Return the output grid as a JSON 2D array

Proposed query template:

```typescript
const query = `You are solving an ARC-AGI task. The task data is in the \`context\` variable as a JSON string.

The task contains:
- "train": An array of training examples, each with "input" and "output" grids
- "test": An array of test inputs (grids with "input" only)

Each grid is a 2D array of integers 0-9, where each integer represents a color.

Your job:
1. Parse the task data from the \`context\` variable
2. Analyze all training examples to discover the transformation rule
3. The transformation rule must explain how EVERY training input maps to its output
4. Apply the rule to each test input to produce the output grid(s)
5. Return ONLY the output grid(s) as a JSON array

If there is one test input, return a single 2D array: [[1,2],[3,4]]
If there are multiple test inputs, return an array of 2D arrays: [[[1,2],[3,4]], [[5,6],[7,8]]]

Return ONLY the raw JSON grid(s). No explanation, no markdown, no code fences.`;
```

### Context Construction

The context is the full ARC task serialized as JSON:

```typescript
const context = JSON.stringify({
  train: challenge.train,   // Array of {input, output} pairs
  test: challenge.test,     // Array of {input} objects
});
```

This is typically small (a few KB -- far smaller than OOLONG's 128K+ contexts).

### Expected Answer

The expected answer is the solution grid(s) as a JSON string:

```typescript
// For single test input (most common):
const expected = JSON.stringify(solutions[taskId][0]);
// e.g., "[[7,7,9],[7,2,9],[7,2,9]]"

// For multiple test inputs:
const expected = JSON.stringify(solutions[taskId]);
// e.g., "[[[7,7,9],[7,2,9]],[[1,2],[3,4]]]"
```

### Metadata

```typescript
const metadata = {
  numTrainExamples: challenge.train.length,
  numTestInputs: challenge.test.length,
  // Optionally include grid dimensions
  trainInputDims: challenge.train.map(t => [t.input.length, t.input[0]?.length]),
  testInputDims: challenge.test.map(t => [t.input.length, t.input[0]?.length]),
};
```

## 2. Dataset Loader

### New File: `eval/datasets/arc.ts`

```typescript
// ARC-AGI-2 dataset loader.
// Data is downloaded by eval/download.ts into eval/data/arc/.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalTask } from "../types.js";

const EVAL_DIR = new URL("..", import.meta.url).pathname;
const DATA_DIR = join(EVAL_DIR, "data", "arc");

interface ArcChallenge {
  train: Array<{ input: number[][]; output: number[][] }>;
  test: Array<{ input: number[][] }>;
}

type ArcChallenges = Record<string, ArcChallenge>;
type ArcSolutions = Record<string, number[][][]>;

export async function loadArcTasks(
  maxTasks?: number | null,
  selectedProblems?: string[],
): Promise<EvalTask[]> {
  const challengesPath = join(DATA_DIR, "arc-agi_evaluation_challenges.json");
  const solutionsPath = join(DATA_DIR, "arc-agi_evaluation_solutions.json");

  if (!existsSync(challengesPath) || !existsSync(solutionsPath)) {
    throw new Error(
      `ARC data not found at ${DATA_DIR}. Run 'npx tsx eval/download.ts --dataset arc' first.`,
    );
  }

  const challenges: ArcChallenges = JSON.parse(readFileSync(challengesPath, "utf-8"));
  const solutions: ArcSolutions = JSON.parse(readFileSync(solutionsPath, "utf-8"));

  let taskIds = Object.keys(challenges);

  // Filter to selected problems if specified
  if (selectedProblems && selectedProblems.length > 0) {
    const selected = new Set(selectedProblems);
    taskIds = taskIds.filter(id => selected.has(id));
  }

  // Limit to maxTasks
  if (maxTasks && maxTasks > 0) {
    taskIds = taskIds.slice(0, maxTasks);
  }

  return taskIds.map((taskId) => {
    const challenge = challenges[taskId];
    const solution = solutions[taskId];

    if (!solution) {
      throw new Error(`No solution found for ARC task ${taskId}`);
    }

    // Build the context: the full task data
    const context = JSON.stringify({
      train: challenge.train,
      test: challenge.test,
    });

    // Build expected answer
    // Most tasks have 1 test input; some have multiple
    const expected = challenge.test.length === 1
      ? JSON.stringify(solution[0])
      : JSON.stringify(solution);

    return {
      id: `arc-${taskId}`,
      query: buildArcQuery(challenge),
      context,
      expected,
      metadata: {
        numTrainExamples: challenge.train.length,
        numTestInputs: challenge.test.length,
      },
    };
  });
}

function buildArcQuery(challenge: ArcChallenge): string {
  const numTests = challenge.test.length;
  const returnFormat = numTests === 1
    ? "Return the output as a JSON 2D array of integers, e.g.: [[1,2,3],[4,5,6]]"
    : `There are ${numTests} test inputs. Return an array of ${numTests} output grids as JSON, e.g.: [[[1,2],[3,4]], [[5,6],[7,8]]]`;

  return `You are solving an ARC-AGI task. The task data is available in the \`context\` variable as a JSON string.

The JSON contains:
- "train": Training examples, each with "input" and "output" grids (2D arrays of ints 0-9)
- "test": Test inputs with "input" grids only (you must predict the outputs)

Analyze all training examples to discover the transformation rule that maps each input to its output. The rule must be consistent across ALL training examples. Then apply it to the test input(s).

${returnFormat}

Return ONLY the raw JSON grid(s). No explanation, no markdown, no wrapping.`;
}
```

## 3. Scoring Function

### ARC Grid Exact Match

ARC scoring is exact match on grids. The predicted grid must have the same dimensions and identical values at every position.

Add to `eval/scoring.ts`:

```typescript
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
```

### Scoring Notes

- **No partial credit:** Following arcgentica's approach, a grid is either fully correct (1.0) or wrong (0.0)
- **No pass@2:** Our harness runs single attempts. If we want pass@2, we would need to run each task twice and take the best score. This is a future enhancement.
- **Robust parsing:** The `parseArcGrid` function handles common LLM output quirks (markdown wrapping, explanatory text)

## 4. Changes to `eval/run.ts`

### Add ARC to CLI Options

Update the help text and benchmark choices:

```typescript
// In usage():
// Add to benchmarks:
//   arc             ARC-AGI-2 (abstract reasoning, 120 tasks)

// Add ARC-specific options:
//   --selected-problems <ids>  ARC: comma-separated problem IDs to run
```

### Add CLI Argument

```typescript
interface CliArgs {
  // ... existing fields
  selectedProblems: string[];  // New: ARC-specific
}

// In parseArgs():
selectedProblems: args["selected-problems"]
  ? args["selected-problems"].split(",").map(s => s.trim())
  : [],
```

### Add ARC Benchmark Config

```typescript
import { loadArcTasks } from "./datasets/arc.js";
import { arcGridMatch } from "./scoring.js";

// In getBenchmarkConfig():
case "arc":
  return {
    loadTasks: () => loadArcTasks(
      args.maxTasks,
      args.selectedProblems.length > 0 ? args.selectedProblems : undefined,
    ),
    scoringFn: arcGridMatch,
  };
```

### Update Benchmark Description

```typescript
// In usage():
`Benchmarks:
  oolong          OOLONG aggregation benchmark (trec_coarse, 50 tasks)
  s-niah          Single Needle in a Haystack (synthetic, ~48 tasks)
  arc             ARC-AGI-2 abstract reasoning (120 tasks)`
```

## 5. ARC-Specific CLI Options

| Flag | Default | Description |
|:---|:---|:---|
| `--selected-problems <ids>` | all | Comma-separated ARC task IDs (e.g., "0934a4d8,135a2760") |
| `--max-tasks <n>` | 120 | Limit number of tasks (existing flag, works for ARC too) |

No other ARC-specific flags are needed initially. The existing `--max-iterations`, `--max-depth`, `--concurrency`, and plugin flags all apply.

## 6. Recommended Default Parameters for ARC

| Parameter | Recommended Value | Rationale |
|:---|:---|:---|
| `--max-iterations` | `25` | ARC tasks need more iteration than text tasks. Calibrate with pilot run. |
| `--max-depth` | `2` | Allow recursive `rlm()` delegation for complex tasks |
| `--concurrency` | `10` | ARC contexts are tiny (KB) so higher concurrency is safe |
| `--rate-limit` | `5` | Standard OpenRouter rate limiting |

## 7. File Changes Summary

| File | Change |
|:---|:---|
| `eval/datasets/arc.ts` | **New file** -- ARC dataset loader |
| `eval/scoring.ts` | Add `arcGridMatch()` scoring function |
| `eval/run.ts` | Add `arc` benchmark case, `--selected-problems` arg, import new files |
| `eval/download.ts` | Add `--dataset arc` support |
| `eval/README.md` | Document ARC benchmark usage |

## 8. Example End-to-End Flow

```bash
# 1. Download ARC data
npx tsx eval/download.ts --dataset arc

# 2. Run ARC eval with Opus 4.6
npx tsx eval/run.ts \
  --benchmark arc \
  --model anthropic/claude-opus-4-6 \
  --max-iterations 25 \
  --max-depth 2 \
  --concurrency 10

# 3. Run a subset of problems
npx tsx eval/run.ts \
  --benchmark arc \
  --model anthropic/claude-opus-4-6 \
  --selected-problems "0934a4d8,135a2760,136b0064" \
  --max-iterations 30

# 4. Analyze results
npx tsx eval/analyze.ts
```
