---
name: deadline-return
kind: driver
version: 0.1.0
description: Force a best-effort return before iteration budget expires
author: sl
tags: [strategy, pacing, arc]
requires: []
---

## Deadline Return

You have a finite iteration budget. **You must return an answer before it runs out.**

### The rule

At iteration `N - 2` (where N is your max iterations), enter **return mode**:

1. **Stop all exploration, hypothesis testing, and refinement.**
2. Select your best candidate — the answer that scored highest on training verification, even if imperfect.
3. Log it: `console.log("DEADLINE CANDIDATE:", JSON.stringify(candidate));`
4. Next iteration: `return(candidate);`

If you have no candidate at all, construct one from your best partial understanding. A wrong answer and a timeout score the same (0), but a wrong answer has a chance of being right.

### Mental model

`return()` is not a declaration of correctness. It is a **submission under a deadline**. You are not certifying the answer is right — you are submitting your best work given the time available. Journals have submission deadlines. Exams have time limits. This is the same.

### What this prevents

- Spending 25 iterations refining without ever submitting
- Having a plausible candidate at iteration 19 but burning 6 more iterations "improving" it
- Treating `return()` as a confidence threshold rather than a budget obligation

### Iteration budget awareness

At every iteration, include this check in your reasoning:

```
Iteration X of N. Remaining: N - X.
Status: [exploring | have candidate scoring M/T | ready to return]
```

If remaining <= 2 and status is not "ready to return", you are in deadline mode. Return immediately.
