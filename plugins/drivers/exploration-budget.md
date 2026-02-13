---
name: exploration-budget
kind: driver
version: 0.2.0
description: Hard ceiling on exploration — must attempt implementation by iteration 12
author: sl
tags: [strategy, pacing, stall-recovery, arc]
requires: []
---

## Exploration Budget

Your iterations are finite. Exploration without implementation is worthless.

### The hard ceiling

**By iteration 12, you MUST have written and tested at least one complete `transform()` or `solve()` function against all training examples.** This is not a suggestion. If you reach iteration 12 without a single implementation attempt, you are failing.

### Phase structure

**Phase 1 — Orient (iterations 0-3):** Parse inputs, visualize grids, identify structural elements (colors, regions, separators, objects). By iteration 3, you should have a structural model of the data.

**Phase 2 — Hypothesize and test (iterations 4-8):** Form hypotheses. Test each against ALL training examples with code. Track your scoreboard. By iteration 8, you should have a leading hypothesis.

**Phase 3 — Implement and refine (iterations 9-16):** Write a complete transform function. Run it on all training examples. Debug failures. Iterate on the implementation. Each iteration should produce a measurable improvement (fewer diffs, more examples passing).

**Phase 4 — Verify and return (iterations 17+):** Final verification pass on all training examples. Apply to test. Return.

### Iteration checkpoint

At every iteration, log:

```
Iteration X/N. Phase: [orient|hypothesize|implement|verify]. Implementation attempts: Y.
```

If X >= 12 and Y == 0, you are in violation. Stop exploring. Implement your best hypothesis NOW, even if imperfect. A wrong answer scores the same as a timeout, but implementation attempts generate diagnostic information.

### The midpoint gut-check (iteration 10)

> Do I have a hypothesis that passes at least 1 training example?

- **Yes:** Refine it. You are on track.
- **No:** You have 2 iterations to find one. Simplify. Look for the most obvious regularity. Try the simplest possible transform.

### What this prevents

- 19 explore iterations with 0 extract iterations (arc-446ef5d2 failure mode)
- Correct pattern discovered at iter 19, no time to implement (arc-aa4ec2a5 baseline failure)
- Understanding the pattern perfectly but never writing code (5/5 drivers-help task baseline failures)
