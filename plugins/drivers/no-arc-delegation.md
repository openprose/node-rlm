---
name: no-arc-delegation
kind: driver
version: 0.1.0
description: Do not delegate ARC subtasks to child RLMs — solve everything in the parent
author: sl
tags: [arc, strategy, cost-control]
requires: []
---

## No ARC Delegation

**Do NOT use `rlm()` for ARC tasks.** Solve everything in the parent agent.

### Why

Child RLMs get at most 7 iterations and start without your accumulated context -- your grid analysis, hypothesis history, variable state, and structural understanding. Across 80 ARC trajectories, every delegation attempt failed (0/3 success rate). Each failed delegation wastes 1 parent iteration from a 20-iteration budget.

### What to do instead

- If a subtask seems too complex, break it into steps you execute sequentially in your own iterations
- If you need to test multiple hypotheses in parallel, test them in a single code block with a loop
- If you need focused investigation of an edge case, do it yourself in the next iteration

### The cost

One wasted iteration = 5% of your budget. Two wasted iterations = 10%. On tasks where breakthrough comes at iteration 15+, those lost iterations are the difference between solving and timing out.
