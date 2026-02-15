---
name: targeted-recursion
kind: driver
version: 0.1.0
description: When and how to use rlm() delegation — 3 patterns and 4 anti-patterns from trajectory analysis
author: sl
tags: [strategy, delegation, recursion, cost-control]
requires: []
---

## Targeted Recursion

`rlm()` is expensive. Most tasks are solved faster by a single agent iterating. Delegate only when you recognize a pattern below.

**Gate check** — before any `rlm()` call, both must be true:
1. The subtask is **independent** — the child can succeed with just the data and a focused prompt, without your accumulated variables/context.
2. The payoff is **parallelism** — you will run multiple children via `Promise.all()`, or continue other work while the child runs.

### Pattern 1: Parallel Hypothesis Verification (high impact)

**When:** You have 2-3 candidate transforms and would spend 1-2 iterations testing each sequentially.

```javascript
const candidates = [
  { name: "h1", code: `function transform(inp) { /* ... */ }` },
  { name: "h2", code: `function transform(inp) { /* ... */ }` },
];
const results = await Promise.all(candidates.map(h =>
  rlm(
    `Test this transform on ALL training examples. Return JSON: ` +
    `{"name":"${h.name}","results":[{"train":0,"match":true,"diffs":0}]}\n\n` +
    `Transform code:\n${h.code}`,
    __ctx.shared.data,
    {
      model: "fast",
      systemPrompt: "You are a hypothesis tester. Parse the task JSON from context, " +
        "eval the transform code, apply to each training input, compare to expected " +
        "output cell-by-cell, report match results as JSON."
    }
  )
));
console.log("Results:", JSON.stringify(results));
```

Use `model: "fast"` — children do mechanical work (run code, compare grids). Do NOT use this if you have only 1 hypothesis or if hypotheses are vague descriptions rather than concrete code.

### Pattern 2: Edge-Case Subproblem Delegation (medium impact)

**When:** Your solution passes ALL training examples but the test input has a specific edge case (boundary cells, out-of-bounds mapping, ambiguous overlap) requiring focused investigation.

```javascript
const edgeResult = await rlm(
  `Grid has [your known pattern]. Works for most cells, but cells at ` +
  `${JSON.stringify(unknownCells)} map out of bounds. Investigate ` +
  `secondary symmetries and boundary relationships. ` +
  `Return JSON: [{"r":R,"c":C,"value":V}, ...]`,
  __ctx.shared.data,
  {
    systemPrompt: "You are investigating specific unresolvable cells. " +
      "The main pattern is known. Find what determines these cells. " +
      "Work programmatically — write code, test hypotheses."
  }
);
try {
  const fixes = JSON.parse(edgeResult);
  for (const f of fixes) mainResult[f.r][f.c] = f.value;
} catch (e) { console.log("Edge delegation failed, using fallback"); }
```

Use the same model (omit `model`) — this is genuine reasoning. Do NOT use this if training examples still fail; fix the core hypothesis first.

### Pattern 3: Independent Answer Verification (low impact)

**When:** You have a candidate answer and want to catch state-loss regressions (working solution broken during refactoring).

```javascript
const check = await rlm(
  `Verify: apply the transform to each training input, confirm it matches ` +
  `training output. Return JSON: {"valid":true/false,"issues":["..."]}`,
  JSON.stringify({ answer: candidate, task: JSON.parse(__ctx.shared.data) }),
  { model: "fast", systemPrompt: "Verification agent. Run the transform, compare outputs, report mismatches." }
);
```

Skip this if you already verified against training data this iteration.

### Anti-patterns — do NOT delegate

- **Verbal analysis.** "Describe the pattern" produces prose, not code/grids. Use code yourself.
- **Spatial decomposition.** Patterns are holistic — symmetry axes and connected components span the full grid.
- **Brute-force enumeration.** N children x 7 iterations each exceeds your own total budget with no guarantee of finding the right compositional transform.
- **Budget extension.** Children inherit your iteration budget by default and start without your accumulated context.

### Cost-benefit rule

Each `"fast"` child costs ~2-3 iterations of its budget. Each same-model child costs ~3-7 iterations of its budget. Children inherit your iteration budget by default; use `{ maxIterations: N }` to cap them. Delegate only when parallel children save more parent iterations than they consume. Pattern 1 almost always passes; Patterns 2-3 are situational.
