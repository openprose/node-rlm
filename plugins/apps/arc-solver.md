---
name: arc-solver
kind: app
version: 0.2.0
description: Recursive ARC solver — outer strategist delegates hypothesis testing to child RLMs
author: sl
tags: [arc, reasoning, grids, pattern-recognition, delegation]
requires: []
---

## ARC Solving Protocol (Recursive)

You are the **strategist** solving an ARC-AGI task. Your job is to understand the transformation rule, generate hypotheses, and manage a portfolio of attempts — NOT to spend 40 iterations debugging code yourself.

The task data is in `context` as a JSON string with `train` (input/output pairs) and `test` (input-only grids). Each grid is a 2D array of integers 0-9.

You have **two delegation tools**:
- `await rlm(query, context, { systemPrompt, model })` — spawn a child RLM with its own REPL loop (5-10 iterations). Use for implementation and testing.
- `await llm(query, context, { model })` — one-shot LLM call. Use for quick analysis questions.

Available model aliases: `fast` (Gemini Flash — cheap), `orchestrator` (Sonnet), `intelligent` (Opus).

### Your iteration plan (8-10 iterations max)

**Iter 1 — Parse and explore.** Parse the task, visualize all training examples, note dimensions, colors, structure. Do this yourself in code.

**Iter 2 — Hypothesize.** Based on your exploration, generate exactly 3 candidate transformation rules. Write them as clear English descriptions. Number them.

**Iter 3-5 — Test hypotheses via delegation.** For each hypothesis, spawn a child RLM:

```javascript
const h1Result = await rlm(
  "Implement and test this ARC transformation hypothesis.",
  context,
  {
    model: "fast",
    systemPrompt: `You are implementing an ARC grid transformation.

HYPOTHESIS: <your clear description of the rule>

HELPER FUNCTIONS — copy these into your first code block and use them:
${HELPER_LIBRARY}

YOUR TASK:
1. Parse the task: const task = JSON.parse(context);
2. Write a transform(grid) function implementing the hypothesis above.
3. Test it against ALL training examples:

let correct = 0;
for (let i = 0; i < task.train.length; i++) {
  const predicted = transform(task.train[i].input);
  const expected = task.train[i].output;
  const match = JSON.stringify(predicted) === JSON.stringify(expected);
  console.log("Train " + i + ": " + (match ? "PASS" : "FAIL"));
  if (!match && predicted) {
    console.log("  Expected row 0:", JSON.stringify(expected[0]));
    console.log("  Got row 0:     ", JSON.stringify(predicted[0]));
  }
  if (match) correct++;
}
console.log("Score: " + correct + "/" + task.train.length);

4. If Score < 100%, try to debug and fix. You have a few iterations.
5. When done, return a JSON object:
   return(JSON.stringify({ score: correct + "/" + task.train.length, code: transform.toString() }));

IMPORTANT: You MUST call return() before running out of iterations, even if imperfect.`
  }
);
console.log("Hypothesis 1 result:", h1Result);
```

You can run all 3 in parallel with `Promise.all` if they're independent.

**Iter 6 — Compare and commit.** Parse the results. Pick the best-scoring hypothesis.

```
HYPOTHESIS COMPARISON:
  #1 <name>: 2/4 examples
  #2 <name>: 0/4 examples
  #3 <name>: 3/4 examples  <-- BEST
DECISION: Refine #3.
```

If the best scores 100%, skip to iter 8. Otherwise, continue to refinement.

**Iter 7 — Refine via delegation.** Spawn a child RLM to fix the failing examples:

```javascript
const refined = await rlm(
  "Fix and improve this ARC transform that scores 3/4.",
  context,
  {
    model: "orchestrator",
    systemPrompt: `You are debugging an ARC transformation that almost works.

CURRENT CODE (scores 3/4):
<paste the transform code from the best hypothesis>

FAILURE: It fails on training example 2. The diff is:
<paste the diff you computed>

YOUR TASK:
1. Investigate WHY it fails on that specific example.
2. Fix the transform to handle all examples.
3. Test against ALL training examples after each fix.
4. return(JSON.stringify({ score, code: transform.toString() })) when done.

You MUST return before running out of iterations.`
  }
);
```

**Iter 8 — Apply to test.** Take your best transform, apply it to the test input, and prepare the answer.

```javascript
// Reconstruct the best transform from returned code
// Apply to test input
const task = JSON.parse(context);
const testOutput = transform(task.test[0].input);
console.log("Test output:", JSON.stringify(testOutput));
```

**Iter 9 — Return.** Submit your answer. Use `JSON.stringify()` to ensure proper 2D array format.

```javascript
return(JSON.stringify(testOutput));
```

### The helper library constant

Build this string to pass to children. These are tested, correct utility functions:

```javascript
const HELPER_LIBRARY = `
function gridDims(grid) { return [grid.length, grid[0].length]; }
function gridEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function gridCopy(grid) { return grid.map(r => [...r]); }
function gridNew(H, W, fill = 0) { return Array.from({length: H}, () => Array(W).fill(fill)); }
function subgrid(grid, r1, c1, r2, c2) { return grid.slice(r1, r2).map(row => row.slice(c1, c2)); }

function colorCounts(grid) {
  const counts = {};
  for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
  return counts;
}
function backgroundColor(grid) {
  const counts = colorCounts(grid);
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function reflectH(grid) { return grid.map(r => [...r].reverse()); }
function reflectV(grid) { return [...grid].reverse().map(r => [...r]); }
function rotate90(grid) {
  const [H, W] = gridDims(grid);
  return Array.from({length: W}, (_, c) => Array.from({length: H}, (_, r) => grid[H - 1 - r][c]));
}
function transpose(grid) {
  const [H, W] = gridDims(grid);
  return Array.from({length: W}, (_, c) => Array.from({length: H}, (_, r) => grid[r][c]));
}
function testAllSymmetries(grid, target) {
  const ops = [
    ['identity', grid], ['reflectH', reflectH(grid)], ['reflectV', reflectV(grid)],
    ['rotate90', rotate90(grid)], ['rotate180', reflectV(reflectH(grid))],
    ['rotate270', rotate90(rotate90(rotate90(grid)))], ['transpose', transpose(grid)],
  ];
  for (const [name, result] of ops) { if (gridEqual(result, target)) return name; }
  return null;
}

function labelComponents(grid, ignoreColor = 0) {
  const [H, W] = gridDims(grid);
  const labels = gridNew(H, W, 0);
  let id = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (labels[r][c] === 0 && grid[r][c] !== ignoreColor) {
        id++;
        const stack = [[r, c]];
        const color = grid[r][c];
        while (stack.length) {
          const [cr, cc] = stack.pop();
          if (cr < 0 || cr >= H || cc < 0 || cc >= W) continue;
          if (labels[cr][cc] !== 0 || grid[cr][cc] !== color) continue;
          labels[cr][cc] = id;
          stack.push([cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]);
        }
      }
    }
  }
  return { labels, count: id };
}

function boundingBox(grid, predicate) {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (predicate(grid[r][c], r, c)) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR === -1) return null;
  return { minR, maxR, minC, maxC, height: maxR - minR + 1, width: maxC - minC + 1 };
}

function findRepeatingTile(seq, minLen, maxLen) {
  minLen = minLen || 2;
  const n = seq.length;
  maxLen = maxLen || Math.floor(n / 3);
  let bestTile = null, bestErrors = Infinity;
  for (let len = minLen; len <= Math.min(maxLen, Math.floor(n / 2)); len++) {
    const tile = [];
    for (let pos = 0; pos < len; pos++) {
      const votes = {};
      for (let i = pos; i < n; i += len) { votes[seq[i]] = (votes[seq[i]] || 0) + 1; }
      tile.push(+Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]);
    }
    let errors = 0;
    for (let i = 0; i < n; i++) { if (seq[i] !== tile[i % len]) errors++; }
    if (errors < bestErrors) { bestErrors = errors; bestTile = tile; if (errors === 0) break; }
  }
  return { tile: bestTile, errors: bestErrors };
}
`;
```

### Critical rules

1. **You are a strategist, not a coder.** Do your own exploration in iters 1-2. After that, delegate implementation to children. Your job is to *think about the rule* and *manage the budget*.

2. **Always JSON.stringify your return value.** Call `return(JSON.stringify(grid))`, never `return(grid)`. This prevents serialization bugs.

3. **Return by iter 9 no matter what.** If you reach iter 8 without a perfect solution, apply your best-scoring transform to the test input and return it. A wrong answer scores the same as a timeout (0), but has a chance of being right.

4. **Pass the HELPER_LIBRARY to every child.** Children reimplementing grid utilities from scratch is the #1 source of wasted iterations. Give them tested code.

5. **3 hypotheses max, then commit.** After testing 3 approaches, pick the best and refine it. Do not generate hypothesis 4 unless all 3 scored 0.
