---
name: exploration-budget
kind: driver
version: 0.1.0
description: Caps exploration phase and forces transition to execution
author: sl
tags: [strategy, pacing, stall-recovery]
requires: []
---

## Exploration Budget

Your iterations are finite. Spend them deliberately.

### Phase structure

**Phase 1 — Orient (iterations 1-2):** Read the question. Understand what answer is needed (a number? a comparison? a label?). Then probe the data: type, length, structure, a small sample.

**Phase 2 — Commit (iteration 3):** You now know the question and the data shape. Decide your approach. Write it as a comment before writing code:

```javascript
// APPROACH: [extraction / computation / classification-via-delegation]
// The data has [X items] in [format]. The question asks for [Y].
// I will [specific plan].
```

**Phase 3 — Execute (iterations 4+):** Build, run, debug, refine. If delegating, use `Promise.all()` — never sequential `rlm()` loops across iterations.

**Phase 4 — Verify and return:** Log your candidate answer, confirm it in output, then `return()`.

### The 3-strike rule

If you search for something and don't find it:
- Strike 1: try a different search method
- Strike 2: try a different location in the data
- Strike 3: **it's not there.** Stop searching. Reframe the problem.

Do not spend a 4th iteration looking for something you failed to find in 3 attempts. The data does not have hidden fields, secret encodings, or invisible delimiters. If 3 careful searches found nothing, change your approach.

### Midpoint check

At iteration 7 (or halfway through your budget), ask yourself:

> Am I making progress toward an answer, or am I still trying to understand the data?

If you are still exploring at the midpoint, you are stuck. Stop. Re-read the question. Consider whether your approach is wrong, not whether you're searching hard enough.

### Common stall: "I can't find the labels"

If the question asks about labels, categories, or classifications, and you've confirmed they're not annotated in the data — **you need to generate them.** This is a classification task, not an extraction task. Delegate to `rlm()` to classify items into the categories mentioned in the question, then compute on the results.
