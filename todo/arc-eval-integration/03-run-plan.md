# ARC Eval Run Plan

Run our RLM agent against ARC-AGI-2 (120 tasks) using Opus 4.6. Arcgentica's 85.28% (different agent, pass@2) is the reference baseline.

## Exact CLI Commands

### Full Evaluation (120 tasks)

```bash
# Download data (one-time)
npx tsx eval/download.ts --dataset arc

# Run full ARC eval
npx tsx eval/run.ts \
  --benchmark arc \
  --model anthropic/claude-opus-4-6 \
  --max-iterations 25 \
  --max-depth 2 \
  --concurrency 10 \
  --rate-limit 5 \
  --rate-burst 10
```

### Pilot Run (10 tasks, for validation)

```bash
npx tsx eval/run.ts \
  --benchmark arc \
  --model anthropic/claude-opus-4-6 \
  --max-tasks 10 \
  --max-iterations 25 \
  --max-depth 2 \
  --concurrency 5
```

### Targeted Run (specific problems)

```bash
npx tsx eval/run.ts \
  --benchmark arc \
  --model anthropic/claude-opus-4-6 \
  --selected-problems "0934a4d8,135a2760,136b0064" \
  --max-iterations 30
```

## Expected Concurrency and Resource Usage

### Task Characteristics

| Property | Value |
|:---|:---|
| Total tasks | 120 |
| Context size per task | 1-10 KB (JSON serialized grid data) |
| Expected output size | 50-500 bytes (JSON grid) |
| Context compared to OOLONG | ~1000x smaller |

### Concurrency

- **Recommended concurrency:** 10
- ARC tasks have tiny contexts (kilobytes) vs OOLONG (128K+ chars), so higher concurrency is safe
- Each task may take many iterations (10-25), so wall time per task could be 1-10 minutes
- With concurrency 10, the full 120-task run would take roughly 1-2 hours

### Token Usage Estimates

Based on arcgentica's token usage and scaling for RLM's different architecture:

**Arcgentica (for reference):**
- ~3.8M cached input tokens + ~180K cache-write tokens + ~130K output tokens per task
- Average 2.6 agents per task
- This is for the full Agentica multi-agent system with Python REPL

**Our RLM estimate (single agent, JS sandbox):**
- RLM has a lighter system prompt (~2-5K tokens)
- ARC context is small (~500-2K tokens per task)
- Each iteration: ~system prompt + conversation history + sandbox output
- Estimate per task with 20 iterations average:
  - Input tokens: ~100K-300K (growing context per iteration)
  - Output tokens: ~10K-30K
  - Total per task: ~200K tokens average

**Full run estimates:**

| Metric | Estimate |
|:---|:---|
| Total input tokens | ~24M-36M (120 tasks * ~200-300K avg) |
| Total output tokens | ~1.2M-3.6M (120 tasks * ~10-30K avg) |
| Estimated duration | 1-3 hours (with concurrency 10) |

### Cost Estimates

Using OpenRouter pricing for Opus 4.6 (approximate):

| Token Type | Rate | Estimated Volume | Cost |
|:---|:---|:---|:---|
| Input | $15/M tokens | 30M tokens | $450 |
| Output | $75/M tokens | 2.4M tokens | $180 |
| **Total** | | | **~$630** |

**Note:** These are rough estimates. Actual costs depend heavily on:
- How many iterations each task requires
- Whether the model solves tasks quickly or hits max iterations
- OpenRouter markup vs direct API pricing

For comparison, arcgentica's cost was $6.94/task * 120 = $833 total, but that used direct Anthropic pricing with prompt caching ($0.50/M for cached tokens). OpenRouter does not offer the same caching discount.

### Cost Reduction Strategies

1. **Start with a pilot run** of 10 tasks to calibrate iteration counts and costs
2. **Tune max-iterations:** If most tasks solve in <15 iterations, reduce from 25

## Comparison Framework: Our Results vs. Arcgentica

### Metric Mapping

| Arcgentica Metric | Our Harness Metric | Notes |
|:---|:---|:---|
| Score (X/120) | `aggregate.meanScore * 120` | Our mean score * total tasks |
| Accuracy (%) | `aggregate.meanScore * 100` | Direct percentage |
| Cost per task | `aggregate.costEstimateUsd / 120` | Our cost / tasks |
| Time per task (mean) | `aggregate.meanWallTimeMs / 1000` | In seconds |

Note: arcgentica used pass@2 (2 attempts, best-of); we run pass@1. This is a known difference, not something to "fix" — we're measuring our agent, not theirs.

## Drivers and Apps

No special drivers or apps needed. Opus 4.6 needs no reliability patches, and RLM's default behavior (REPL loop with code execution) is the right architecture for ARC — the agent should reason about grids and produce answers through its normal iterative process.

## Results File

Results will be saved to:

```
eval/results/arc_anthropic_claude-opus-4-6_2026-02-12T*.json
```

Format (same as all benchmarks):

```json
{
  "benchmark": "arc",
  "model": "anthropic/claude-opus-4-6",
  "config": {
    "maxIterations": 25,
    "maxDepth": 2,
    "concurrency": 10
  },
  "timestamp": "2026-02-12T...",
  "results": [
    {
      "taskId": "arc-0934a4d8",
      "answer": "[[7,7,9],[7,2,9],...]",
      "expected": "[[7,7,9],[7,2,9],...]",
      "score": 1,
      "iterations": 12,
      "trace": [...],
      "wallTimeMs": 45000,
      "charCount": {"input": 150000, "output": 8000}
    },
    // ...119 more
  ],
  "aggregate": {
    "meanScore": 0.55,
    "medianScore": 1.0,
    "completedTasks": 120,
    "failedTasks": 0,
    "costEstimateUsd": 450.00
  }
}
```

## Run Checklist

1. [ ] Implement ARC dataset loader (`eval/datasets/arc.ts`)
2. [ ] Implement ARC scoring function (add to `eval/scoring.ts`)
3. [ ] Update `eval/run.ts` with ARC benchmark config
4. [ ] Update `eval/download.ts` with ARC data download
5. [ ] Upload ARC data as GitHub Release asset
6. [ ] Download ARC data locally: `npx tsx eval/download.ts --dataset arc`
7. [ ] Pilot run: 10 tasks to validate pipeline
8. [ ] Tune parameters based on pilot results
9. [ ] Full run: 120 tasks
10. [ ] Compare results to arcgentica's 85.28%
