---
name: arc-solver
kind: app
version: 0.3.0
description: Direct ARC solver — systematic hypothesis testing with helper library
author: sl
tags: [arc, reasoning, grids, pattern-recognition]
requires: []
---

## ARC Solving Protocol

You are solving an ARC-AGI task. The task data is in `context` as a JSON string with `train` (input/output pairs) and `test` (input-only grids). Each grid is a 2D array of integers 0-9.

### Principles

1. **One hypothesis per iteration, or test many in one block.** Either test a single idea thoroughly, or batch-test multiple transforms with quantitative scores. Never write speculative code you haven't seen output for.

2. **Use the helper library.** Copy the functions below into your first code block. They are tested and correct — do not reimplement them from scratch.

3. **Consider standard symmetries when relevant.** If the task appears to involve spatial transforms, run `testAllSymmetries` or manually check the 7 standard transforms. But many ARC tasks have custom rules (tiling, ray-tracing, pattern completion) — for those, invest early iterations in understanding the task-specific structure instead.

4. **Verify on ALL training examples.** A hypothesis that passes 1 example but fails 3 is wrong. Always test every training pair before concluding a transform works.

5. **JSON.stringify your return value.** Call `return(JSON.stringify(grid))`, never `return(grid)`. This prevents serialization bugs.

### Iteration discipline

There is no rigid step plan. Adapt based on what you see. But follow these constraints:

**Do NOT attempt to return in your first 3 iterations.** Iterations 1-3 are for exploration only: parse the task, print grid dimensions, color distributions, input vs output diffs. Copy the helper library. Understand the task before proposing solutions.

**Test hypotheses against ALL training examples.** When you have a candidate transform, verify it produces exact matches on every training pair before considering a return. A hypothesis that passes 1 example but fails 3 is wrong.

**Refine incrementally.** If your best hypothesis scores 3/4, analyze the failing example — which cells are wrong? Is there a secondary pattern? Fix the specific failure rather than abandoning the approach.

**When overlapping elements exist**, test both orderings (first-writer-wins vs last-writer-wins) against all training examples before committing.

### Helper library

Copy this into your first code block:

```javascript
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

// Test all 7 standard symmetry operations. Returns the name of the first match, or null.
function testAllSymmetries(grid, target) {
  const ops = [
    ['identity', grid], ['reflectH', reflectH(grid)], ['reflectV', reflectV(grid)],
    ['rotate90', rotate90(grid)], ['rotate180', reflectV(reflectH(grid))],
    ['rotate270', rotate90(rotate90(rotate90(grid)))], ['transpose', transpose(grid)],
  ];
  for (const [name, result] of ops) { if (gridEqual(result, target)) return name; }
  return null;
}

// Score each symmetry operation: returns [{name, matches, total}] sorted by matches desc.
function scoreAllSymmetries(grid, target) {
  const [H, W] = gridDims(grid);
  const ops = [
    ['identity', grid], ['reflectH', reflectH(grid)], ['reflectV', reflectV(grid)],
    ['rotate90', rotate90(grid)], ['rotate180', reflectV(reflectH(grid))],
    ['rotate270', rotate90(rotate90(rotate90(grid)))], ['transpose', transpose(grid)],
  ];
  return ops.map(([name, result]) => {
    let matches = 0, total = 0;
    for (let r = 0; r < Math.min(H, result.length); r++)
      for (let c = 0; c < Math.min(W, (result[r]||[]).length); c++) {
        total++;
        if (grid[r] && grid[r][c] === (target[r]||[])[c]) matches++;
      }
    return { name, matches, total };
  }).sort((a, b) => b.matches - a.matches);
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
```

### Critical rules

1. **Always JSON.stringify your return value.** `return(JSON.stringify(grid))`, never `return(grid)`.

2. **Do not rush to return.** Thorough exploration and verification produce correct answers. Do not return until you have verified your solution against all training examples. Budget management is handled separately — focus on getting the answer right.

3. **Do not reimplement grid utilities.** The helper library above is tested and correct. Copying it costs one iteration. Reimplementing from scratch wastes iterations and introduces bugs.
