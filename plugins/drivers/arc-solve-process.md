---
name: arc-solve-process
kind: driver
version: 0.1.0
description: Structured ARC solving process adapted from arcgentica's 86% methodology
author: sl
tags: [arc, strategy, process]
requires: []
---

## ARC Solve Process

Solve ARC puzzles in five phases. Do not skip phases. Do not blend them.

### Phase 1 -- Analyze

Before writing any transform, characterize **what is in the grids**. For each training pair:

**Identify objects.** An object is a connected region of same-colored non-background cells. Use flood fill to extract them:

```javascript
function extractObjects(grid, bg = 0) {
  const H = grid.length, W = grid[0].length;
  const visited = Array.from({length: H}, () => Array(W).fill(false));
  const objects = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (visited[r][c] || grid[r][c] === bg) continue;
      const color = grid[r][c];
      const cells = [];
      const queue = [[r, c]];
      visited[r][c] = true;
      while (queue.length) {
        const [cr, cc] = queue.shift();
        cells.push([cr, cc]);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < H && nc >= 0 && nc < W && !visited[nr][nc] && grid[nr][nc] === color) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
      const rs = cells.map(c => c[0]), cs = cells.map(c => c[1]);
      objects.push({
        color,
        cells,
        minR: Math.min(...rs), maxR: Math.max(...rs),
        minC: Math.min(...cs), maxC: Math.max(...cs),
        area: cells.length,
      });
    }
  }
  return objects;
}
```

**Describe relationships.** For each training pair, log:
- How many objects? What colors? What sizes?
- How are objects arranged? (touching, nested, aligned, separated by gaps)
- What is the spatial relationship between input objects and output objects? (same position, moved, merged, split, resized)

**Describe the structural delta.** What specifically changed from input to output?
- Were objects added, removed, moved, recolored, resized, reflected, or combined?
- Did the grid dimensions change? By what rule?

Print all of this. Do not hold analysis in your head.

### Phase 2 -- Hypothesize

From your analysis, formulate a **transformation rule** in plain English before writing code.

**Start simple.** Check these categories in order of likelihood:

| Category | Examples | Key signal |
|----------|----------|------------|
| Color remap | Swap two colors, map by adjacency | Same dims, same structure, different colors |
| Geometric transform | Reflect, rotate, transpose, crop | Output is a rigid transformation of input |
| Object manipulation | Move, copy, resize, align objects | Objects exist in both, positions differ |
| Pattern completion | Fill gaps, extend lines, complete symmetry | Output has more filled cells than input |
| Region extraction | Extract subgrid, select by property | Output is smaller, content matches a part of input |
| Composition | Overlay, tile, stack, interleave grids | Output combines multiple parts of input |
| Conditional fill | Fill cells based on neighborhood, distance, or containment | Same dims, localized changes |
| Sorting/ordering | Reorder rows, columns, or objects by some property | Same content, different arrangement |

**State your hypothesis explicitly:**

```
HYPOTHESIS: For each non-background object, extract its bounding box.
Sort the extracted boxes by area (smallest first).
Stack them vertically to form the output.
```

**Generalization check before coding.** Ask yourself three questions:

1. Does this rule use any **hardcoded constants**? (A specific row index, a specific color value, a magic number.) If yes, find the general principle that produces that constant from the input structure.
2. Does this rule handle **all orientations**? If the rule says "move right," what happens if a training example moves left? The rule should derive direction from input structure, not assume it.
3. Does this rule work for **variable object counts and grid sizes**? Check the test input dimensions and object count now, not after implementing.

### Phase 3 -- Implement

Write a `transform(grid)` function that implements your hypothesis. The function takes `number[][]` and returns `number[][]`.

**Rules for implementation:**

Do not hardcode grid dimensions. Always derive from `grid.length` and `grid[0].length`.

Do not hardcode object counts. Loop over whatever objects you find.

Do not hardcode color values. Discover colors from the input. If your hypothesis says "the red object moves," your code should identify which color plays the role of "the moving object" by its structural properties (e.g., smallest object, unique color, the one that differs between input and output).

Use parameterized thresholds derived from the data:

```javascript
// BAD: hardcoded threshold
if (object.area > 5) { /* treat as large */ }

// GOOD: threshold derived from data
const areas = objects.map(o => o.area);
const medianArea = areas.sort((a, b) => a - b)[Math.floor(areas.length / 2)];
if (object.area > medianArea) { /* treat as large */ }
```

**Multi-color object detection.** Some ARC objects are multi-colored (a shape made of several colors). When same-color flood fill produces too many fragments, try grouping non-background cells by spatial proximity instead:

```javascript
function extractMultiColorObjects(grid, bg = 0) {
  const H = grid.length, W = grid[0].length;
  const visited = Array.from({length: H}, () => Array(W).fill(false));
  const objects = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (visited[r][c] || grid[r][c] === bg) continue;
      const cells = [];
      const queue = [[r, c]];
      visited[r][c] = true;
      while (queue.length) {
        const [cr, cc] = queue.shift();
        cells.push([cr, cc, grid[cr][cc]]);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < H && nc >= 0 && nc < W && !visited[nr][nc] && grid[nr][nc] !== bg) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
      objects.push(cells);
    }
  }
  return objects;
}
```

### Phase 4 -- Test and Refine

Run your transform on all training examples. (Other drivers cover the verification mechanics -- follow them.)

When a training example fails, do not guess at a fix. Diagnose the failure structurally:

```javascript
// For each failing example, print exactly where the output diverges
for (let r = 0; r < expected.length; r++) {
  for (let c = 0; c < expected[0].length; c++) {
    if (predicted[r]?.[c] !== expected[r][c]) {
      console.log(`DIFF [${r},${c}]: expected ${expected[r][c]}, got ${predicted[r]?.[c]}`);
    }
  }
}
```

Common failure modes and their fixes:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Output shifted by 1 row/col | Off-by-one in coordinate math | Check whether you're including or excluding boundary cells |
| Correct pattern, wrong colors | Color role assignment is fragile | Derive color roles from structural properties, not position |
| Works on 3 of 4 examples | Rule handles the common case but not the edge case | The 4th example reveals a condition your rule missed -- examine what's structurally different about it |
| Correct interior, wrong border | Border handling differs from interior | Add explicit border-cell logic or pad the grid before transforming |
| Wrong dimensions | Output size formula is wrong | Re-derive the dimension relationship across all training pairs |

### Phase 5 -- Generalize to Test

Before returning, verify your transform will generalize to the test input. This is not just running it -- it is checking that the test input's structure falls within what your transform handles.

**Structural compatibility check:**

```javascript
const testGrid = test[0].input;
const testObjects = extractObjects(testGrid);
console.log("Test input:", testGrid.length, "x", testGrid[0].length);
console.log("Test objects:", testObjects.length, "colors:", testObjects.map(o => o.color));

// Does the test input have a structure my transform assumes?
// e.g., if my transform assumes exactly 2 objects:
if (testObjects.length !== 2) {
  console.log("WARNING: transform assumes 2 objects but test has", testObjects.length);
}
```

**Signs your transform will fail on test:**
- Your code has `if (color === 3)` -- the test might use different colors
- Your code has `grid.slice(0, 5)` -- the test might have different dimensions
- Your code counts on objects being in specific grid quadrants -- the test arrangement may differ
- Your code sorts objects by position, but the test has objects in an order not seen in training

**The simplicity heuristic.** If two hypotheses score equally on training, prefer the one with fewer conditions and no magic numbers. ARC rules are typically elegant. A transform with 8 nested conditionals is almost certainly wrong, even if it passes training -- it is overfitting to the examples rather than capturing the rule.

### What this driver does NOT cover

Verification mechanics, iteration budgeting, return discipline, and output format are handled by other drivers. This driver teaches the **problem-solving process**: how to go from a blank slate to a correct, generalizable `transform()` function. Follow the five phases in order. Do not jump to implementation before analyzing. Do not return before testing generalization.
