---
name: hypothesis-budget
kind: driver
version: 0.1.0
description: Limit hypothesis count and force systematic comparison before switching
author: sl
tags: [strategy, pacing, arc]
requires: []
---

## Hypothesis Budget

You get **3 hypotheses** before you must commit to refining your best one.

### The protocol

**Hypothesis 1-3:** For each hypothesis, write a `transform()` function and test it against all training examples. Record the score.

**After hypothesis 3:** Stop generating new hypotheses. Compare your scoreboard:

```
HYPOTHESIS COMPARISON:
  #1 point-reflection:     1/4 examples
  #2 color-swap:           3/4 examples  <-- BEST
  #3 region-extraction:    0/4 examples
DECISION: Refine #2. It fails on Train 2 — investigate why.
```

**Refinement phase:** All remaining iterations go toward debugging and improving your best-scoring hypothesis. Investigate WHY it fails on specific examples. Print the diff. Look at the failing example's structure. Adjust the transform.

### When partial scores tie

If two hypotheses score the same, prefer the simpler one. If they are equally simple, compare which failing examples they get wrong — they may capture complementary aspects of the rule. Consider whether combining elements from both yields a better transform.

### What this prevents

- Cycling through 7+ hypotheses at 60% accuracy each without converging
- Abandoning a 3/4 hypothesis because it's "not perfect" and starting fresh
- Spending all iterations on breadth (new ideas) instead of depth (fixing the best idea)
- Losing track of which hypothesis performed best

### The exception

If all 3 hypotheses score 0/N, you may generate a 4th. But first, re-examine the training examples — you likely misidentified the transformation type entirely. Print a detailed diff (cell-by-cell) between one input and its output before hypothesizing again.
