# Run 006: Opus 4.6 Recursive + Single-Block Enforcement

**FIRST PERFECT SCORE** across all ARC-AGI-2 runs.

## Config

| Param | Value |
|-------|-------|
| Model | anthropic/claude-opus-4.6 (via OpenRouter) |
| Max Iterations | 15 |
| Max Depth | 2 (recursive delegation enabled) |
| Concurrency | 1 |
| Max Tokens | 8192 (Opus override) |
| API Timeout | 120s (Opus override) |
| Single-Block Enforcement | Yes (harness-level, maxBlocksPerIteration=1) |
| App | arc-solver v0.2.0 (recursive delegation) |
| Drivers | one-block-per-iteration v0.2.0, deadline-return |

## Changes from Run 005

1. **Single-block enforcement** — harness extracts only first code block per response, discards rest with warning
2. **max_tokens 8192** — up from 4096 default; prevents Opus finish=length truncation
3. **API timeout 120s** — up from 60s default; gives Opus time to complete responses
4. **Strengthened one-block-per-iteration driver** — explains WHY single-block matters

## Results

| Task | Score | Iters | Wall Time | Verdict |
|------|-------|-------|-----------|---------|
| arc-0934a4d8 | **1.00** | 15 | 11m 16s | **PERFECT** |
| arc-135a2760 | 0.00 | 1 | 3m 29s | API timeout |

**Mean Score: 50%** | **Total Time: 14m 44s** | **Est. Cost: $1.86**

## Key Findings

### The perfect score (arc-0934a4d8)
- Task: 30x30 grid with 8-filled rectangular region; discover the underlying symmetry to fill it
- Algorithm: 180-degree rotational symmetry — fill 8-cells from rotationally symmetric positions
- The model explored systematically (zero distributions, edge patterns, center of mass) before finding the key insight at iteration 3-4
- Verified on all 4 training examples before applying to test
- Single-block enforcement gave the model 15 proper REPL turns instead of 2 bloated ones (run-005)

### The timeout (arc-135a2760)
- First API call took 209s, exceeding 120s limit
- The model produced 19K chars of reasoning before being cut off
- This task has failed across ALL 6 runs with various configs
- Not a model capability issue — infrastructure limit needs adjustment

### Single-block enforcement: validated
- Every iteration of the successful task has exactly 1 code block
- Iter 1 had 8 blocks written (7 discarded) — the model learned to comply by iter 2
- This is the key architectural change that unlocked Opus performance

## Analyses

- [Trajectory: arc-0934a4d8](trajectories/arc-0934a4d8.md) — First perfect score analysis
- [Trajectory: arc-135a2760](trajectories/arc-135a2760.md) — Timeout analysis
- [Analysis & Recommendations](analysis.md) — Pattern analysis and run-007 proposals
