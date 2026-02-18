# Run 002 — ARC-2 Compound Learning (v0.3.0 solver)

**Date:** 2026-02-16
**Status:** Completed
**Branch:** feat/arc3-benchmark
**Model:** anthropic/claude-opus-4-6 (all depths, all aliases)
**Score:** 1/3 (33.3%)
**Duration:** 32 minutes
**API Calls:** ~90 (all Opus 4.6)
**Cost:** ~$20-25 estimated (930k input tokens, 86k output tokens at Opus pricing)

## Configuration

| Param | Value |
|---|---|
| benchmark | arc-compound |
| model | anthropic/claude-opus-4-6 |
| model-alias fast | anthropic/claude-opus-4-6 |
| model-alias orchestrator | anthropic/claude-opus-4-6 |
| model-alias intelligent | anthropic/claude-opus-4-6 |
| max-iterations | 100 |
| max-depth | 2 |
| trace-full | yes |
| selected-problems | 0934a4d8, 135a2760, 136b0064 |

## Changes from Run 001

- **P0 fix:** Solver plugin v0.3.0 — added "one function per iteration" guidance, math-focused exploration strategy, modular code instruction
- **P1 fix:** All model aliases set to Opus 4.6 (no Gemini Flash)

## Results

| Task | Pass@1 Self-Verified | Pass@1 Submitted | Pass@2 Self-Verified | Pass@2 Submitted | Result |
|------|---------------------|------------------|---------------------|------------------|--------|
| 0934a4d8 | true (conf=0.9) | incorrect | true (conf=1.0) | incorrect | FAIL |
| 135a2760 | true (conf=1.0) | incorrect | true (conf=1.0) | incorrect | FAIL |
| 136b0064 | true (conf=1.0) | correct | — | — | PASS |

**5 submissions used out of 6 possible.** The only unspent submission is 136b0064's second.

## Failure Analysis

### 0934a4d8 — Near Miss (wrong values in top region)

30x30 input → 9x3 output. The solver correctly identified the structure and dimensions, but predicted wrong values in the top 4 rows:

```
Expected:  [[7,7,9],[7,2,9],[7,2,9],[7,7,9],[4,4,7],[4,4,7],[6,6,1],[6,6,6],[1,6,1]]
Predicted: [[0,0,9],[0,0,9],[0,0,9],[0,0,9],[4,4,7],[4,4,7],[6,6,1],[6,6,6],[1,6,1]]
```

Bottom 5 rows match exactly. Top 4 rows have 0s where expected has 7s and 2s. The solver's transform works on training data (self-verification passes) but fails on the test input — classic overfitting to training examples.

The solver noted confidence=0.9, not 1.0. The output contained 0s (the `Has zeros: true` message in the trace), which the solver flagged but couldn't resolve within its iteration budget.

### 135a2760 — Near Miss (subtle interior differences)

5x13/21x22/29x29 grids (varying sizes). The solver got the dimensions right (29x29) and most cells correct, but had subtle differences in interior cell values. The self-verification passed on all training pairs but the generalization rule missed edge cases.

### 136b0064 — Correct

Solved correctly on pass@1. Perfect match.

## What Improved (vs Run 001)

### P0: `finish=length` truncation mostly eliminated

| Metric | Run 001 | Run 002 |
|--------|---------|---------|
| Pass@1 truncations | 0 | 0 |
| Pass@2 truncations | 10+ (spiral) | 4 (recovered) |
| Max output (pass@1) | 5.1k chars | 6.2k chars |
| Max output (pass@2) | 11.7k chars | 21k chars |

The solver wrote more modular code during pass@1 — zero truncations, max output 6.2k. Pass@2 retries still hit truncation but recovered in 2 iterations instead of spiraling for 11.

### P1: All Opus at every depth

No Gemini Flash calls. Synthesizer used 6-9 iterations (vs 2 with Flash in run 001). More thorough synthesis.

### Library Growth

The library accumulated 28 primitives and 3 strategies by session end. This is genuine cross-task knowledge accumulation.

## What Still Needs Fixing

### 1. False-Positive Self-Verification (Critical)

The dominant failure mode: solvers self-verify "all training pairs correct" but the test output is wrong. This means the solver writes a transform function that memorizes training examples rather than capturing the true rule.

**Root cause:** The solver verifies ONLY against training pairs. There's no mechanism to check whether the transform generalizes. The solver can write a function that handles each training pair as a special case (overfitting).

**Possible fixes:**
- Require the solver to verify on *held-out* training pairs (leave-one-out cross-validation)
- Have the solver explain its transform rule in natural language before returning — if it can't articulate the rule simply, it's likely overfitting
- Add a confidence calibration: if the transform was discovered late (iter 15+), reduce confidence
- Have the orchestrator refuse to submit answers that "look suspicious" (e.g., contain color 0 when no training output does)

### 2. Pass@2 Still Generates Massive Output

The retry solver produced 21k char outputs (truncated). The "one function per iteration" instruction works during exploratory pass@1 but not during retries when the model tries to write a comprehensive solution.

**Fix:** The orchestrator's retry prompt should explicitly say: "Start by listing available library primitives, then compose them. Write focused code — do not try to solve everything in one code block."

### 3. Orchestrator Iteration Efficiency

11 orchestrator iterations for 3 tasks + 2 retries = 2.2 per task cycle. The plugin targets 1-2. Some iterations are spent printing task data redundantly (iter 6-7 print the raw grid data that the solver already sees).

## API Call Breakdown

| Phase | Calls | Duration | Notes |
|---|---|---|---|
| Orchestrator | 11 | ~2 min | Clean, efficient |
| Solver 1 (0934a4d8) | 18 | ~5 min | Full budget, conf=0.9 |
| Synth 1 | 6 | ~1 min | |
| Solver 2 (135a2760) | 18 | ~6 min | Full budget, conf=1.0 |
| Synth 2 | 6 | ~2 min | |
| Solver 3 (136b0064) | 14 | ~5 min | Solved early, conf=1.0 |
| Synth 3 | 9 | ~2 min | |
| Retry solver 1 | 2 | ~3 min | 1 truncation, recovered |
| Retry solver 2 | 6+ | ~10 min | 3 truncations, recovered |
| **Total** | ~90 | 32 min | |

## Recommendations for v0.4.0

1. **Add leave-one-out validation** — Before returning, verify the transform on held-out training pairs. Train on N-1 examples, predict the Nth, check correctness. If it fails, the transform is likely overfitting.

2. **Improve retry prompt** — Tell retry solvers to compose library primitives, not re-derive solutions.

3. **Add answer sanity checks** — The orchestrator should check for suspicious patterns (unexpected colors, wrong dimensions, all-same values) before submitting.
