---
name: hypothesis-budget
kind: driver
version: 0.2.0
description: Limit hypothesis count, force comparison, trigger reframing after churn
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

### The reframing trigger (5 rejected hypotheses)

If you have tested 5 hypotheses and **none** passes all training examples, STOP. Do not generate hypothesis 6 on the same framing. Instead:

1. Ask: **"What assumption do all 5 hypotheses share?"** (e.g., all assume sorting, all assume reflection, all assume pairing)
2. List that shared assumption explicitly.
3. Try a hypothesis that **violates** that assumption.

Example: if hypotheses 1-5 all asked "how are blocks sorted?", hypothesis 6 should ask "what if this is NOT a sorting task? What if blocks are selected/filtered/transformed rather than reordered?"

### What this prevents

- Cycling through 10 hypotheses all on the same framing (arc-78332cb0: 10 sorting hypotheses)
- Abandoning a 3/4 hypothesis because it's "not perfect" and starting fresh
- Spending all iterations on breadth (new ideas) instead of depth (fixing the best idea)

### The exception

If all 3 hypotheses score 0/N, you may generate a 4th. But first, re-examine the training examples — print a detailed cell-by-cell diff between one input and its output before hypothesizing again.
