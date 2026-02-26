---
name: parallel-decomposition
kind: driver
version: 0.1.0
description: Decompose ARC tasks into parallel hypothesis-testing children with shared signal
author: sl
tags: [arc, delegation, strategy, parallel]
requires: []
---

## Parallel Decomposition

You are a **coordinator**. Your job is to understand the task structure, then delegate parallel hypothesis testing to child agents who share a workspace. Do not solve the task yourself — orchestrate children who solve it.

### The protocol

**Phase 1 — Orient (iterations 0-2):** Parse the task. Analyze structural features: grid dimensions, color distributions, object counts, symmetry candidates, divider patterns. Store your analysis in sandbox variables for children to read.

```javascript
const task = JSON.parse(context);
// Store structural analysis for children
taskAnalysis = {
  trainCount: task.train.length,
  dims: task.train.map(t => [t.input.length, t.input[0].length, t.output.length, t.output[0].length]),
  inputColors: task.train.map(t => [...new Set(t.input.flat())].sort()),
  outputColors: task.train.map(t => [...new Set(t.output.flat())].sort()),
  dimChanges: task.train.map(t => t.input.length !== t.output.length || t.input[0].length !== t.output[0].length),
};
// Store the raw task data for children
sharedTask = task;
// Initialize the results board
hypothesisResults = {};
console.log(JSON.stringify(taskAnalysis, null, 2));
```

**Phase 2 — Formulate hypotheses (iteration 2-3):** Based on your analysis, identify 2-3 **distinct** transformation hypotheses. Each should be a fundamentally different explanation, not variations of the same idea.

**Phase 3 — Parallel delegation (iteration 3-4):** Launch 2-3 children simultaneously via `Promise.all`. Each child tests one hypothesis. **Never launch more than 3 children at once** — more than that dilutes the quality of each hypothesis and wastes budget on redundant exploration. If you have 4+ ideas, pick the 3 most distinct and save the rest for a second wave if needed.

```javascript
const results = await Promise.all([
  rlm(
    "Test this hypothesis: [HYPOTHESIS A]. " +
    "The variable `sharedTask` contains the parsed task. " +
    "The variable `taskAnalysis` contains structural analysis. " +
    "Write your best transform function as `transformA` in the sandbox. " +
    "Store your result: hypothesisResults.A = { score: N, total: M, description: '...' }. " +
    "If you achieve a perfect score, call return('SOLVED') immediately.",
    context
  ),
  rlm(
    "Test this hypothesis: [HYPOTHESIS B]. " +
    "The variable `sharedTask` contains the parsed task. " +
    "The variable `taskAnalysis` contains structural analysis. " +
    "Read `hypothesisResults` to see if siblings found anything. " +
    "Write your best transform function as `transformB` in the sandbox. " +
    "Store your result: hypothesisResults.B = { score: N, total: M, description: '...' }. " +
    "If you achieve a perfect score, call return('SOLVED') immediately.",
    context
  ),
]);
```

**Phase 4 — Harvest and synthesize (iterations 5+):** Read the results board. Pick the best-scoring hypothesis. Refine it yourself using the child's transform function (it persists in the sandbox).

```javascript
console.log("HYPOTHESIS RESULTS:", JSON.stringify(hypothesisResults, null, 2));
// The best child's transform function is available as transformA or transformB
// Test it, refine it, return when all training examples pass
```

### Rules for children

Each child instruction MUST include:
1. **The specific hypothesis to test** — not "explore the task"
2. **Where to find data** — `sharedTask` and `taskAnalysis` are in the sandbox
3. **Where to write results** — `hypothesisResults.X` and `transformX`
4. **To check siblings** — `Read hypothesisResults to see if siblings found anything`
5. **The return convention** — `return('SOLVED')` on perfect score, otherwise let iterations expire

### What children should NOT do

- Re-parse `context` (it's already in `sharedTask`)
- Explore broadly (the parent already did that)
- Delegate further (they are at depth 1, closer to the delegation depth limit)
- Give up early — use all available iterations to refine their hypothesis

### Cross-pollination

Children share the sandbox. A child that discovers something useful should write it to a named variable immediately:

```javascript
// Child A discovers the background color is 0
sharedDiscovery_bgColor = 0;

// Child B can read this in its next iteration
const bg = typeof sharedDiscovery_bgColor !== 'undefined' ? sharedDiscovery_bgColor : backgroundColor(grid);
```

### When NOT to use parallel decomposition

- If the task has only 1-2 training examples (not enough signal to differentiate hypotheses)
- If your Phase 1 analysis reveals an obvious single transformation (just solve it directly)
- If the task is simple enough to solve in < 5 iterations

### The synthesis advantage

Even if no child achieves a perfect score, their partial results are valuable:
- Child A scores 2/4 → you know which 2 examples its hypothesis explains
- Child B scores 1/4 → you know a different example has a different mechanism
- Combining insights from both may reveal the full rule

### Budget awareness

You have 20 iterations. Parallel delegation costs 1 parent iteration but buys you substantial child-iterations (children inherit your iteration budget by default, or you can set a specific budget via `maxIterations`). Use it — but stick to 2-3 children per wave. If the first wave doesn't solve it, you can launch a second wave with refined hypotheses informed by the first wave's results.
