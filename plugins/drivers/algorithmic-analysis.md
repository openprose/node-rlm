---
name: algorithmic-analysis
kind: driver
version: 0.1.0
description: Heavy mathematical/algorithmic analysis to discover ARC transformation patterns through code
author: sl
tags: [arc, strategy, pattern-recognition, math]
requires: [arc-helper-library]
---

## Algorithmic Analysis

You solve ARC by **writing code that discovers the pattern**, not by staring at grids and guessing. Every iteration should contain a dense block of algorithmic checks that narrows the hypothesis space. Think like a scientist: measure everything, eliminate impossibilities, converge on truth.

### The Core Principle

You have one code block per iteration. Make it count. Each block should run **5-10 distinct quantitative checks** and print structured results. One iteration of heavy analysis eliminates more hypotheses than five iterations of guess-and-check.

### Iteration 1: The Grand Survey

Your first code block should be a comprehensive **analysis battery** that characterizes the transformation across ALL training pairs. Do not look at one example — look at all of them simultaneously and find what's **invariant**.

```javascript
const task = JSON.parse(context);
const train = task.train;

// === DIMENSIONAL ANALYSIS ===
console.log("=== DIMENSIONS ===");
for (let i = 0; i < train.length; i++) {
  const [iH, iW] = [train[i].input.length, train[i].input[0].length];
  const [oH, oW] = [train[i].output.length, train[i].output[0].length];
  console.log(`Train ${i}: input ${iH}x${iW} -> output ${oH}x${oW}  ratio: ${oH/iH}x${oW/iW}`);
}

// === COLOR TRANSITION MATRIX ===
// For every (input_color -> output_color) pair, count occurrences across all pairs
// Only valid when dimensions match
console.log("\n=== COLOR TRANSITIONS (per-cell) ===");
const transitions = {};
let sameDims = true;
for (const ex of train) {
  if (ex.input.length !== ex.output.length || ex.input[0].length !== ex.output[0].length) {
    sameDims = false; break;
  }
  for (let r = 0; r < ex.input.length; r++)
    for (let c = 0; c < ex.input[0].length; c++) {
      const key = `${ex.input[r][c]}->${ex.output[r][c]}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
}
if (sameDims) {
  const sorted = Object.entries(transitions).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted.slice(0, 15)) console.log(`  ${k}: ${v}`);
  // Check: is it a pure color remap?
  const byInput = {};
  for (const [k] of sorted) {
    const [from] = k.split("->");
    if (!byInput[from]) byInput[from] = new Set();
    byInput[from].add(k.split("->")[1]);
  }
  const pureRemap = Object.values(byInput).every(s => s.size === 1);
  console.log(`Pure color remap: ${pureRemap}`);
}

// === DIFF ANALYSIS ===
// Where do changes happen? What fraction of cells change?
console.log("\n=== CHANGE ANALYSIS ===");
if (sameDims) {
  for (let i = 0; i < train.length; i++) {
    let changed = 0, total = 0;
    const changedPositions = [];
    for (let r = 0; r < train[i].input.length; r++)
      for (let c = 0; c < train[i].input[0].length; c++) {
        total++;
        if (train[i].input[r][c] !== train[i].output[r][c]) {
          changed++;
          changedPositions.push([r, c]);
        }
      }
    console.log(`Train ${i}: ${changed}/${total} cells changed (${(100*changed/total).toFixed(1)}%)`);
    if (changedPositions.length <= 20)
      console.log(`  Changed at: ${JSON.stringify(changedPositions)}`);
  }
}

// === COLOR INVENTORY ===
console.log("\n=== COLOR INVENTORY ===");
for (let i = 0; i < train.length; i++) {
  const ic = [...new Set(train[i].input.flat())].sort((a,b) => a-b);
  const oc = [...new Set(train[i].output.flat())].sort((a,b) => a-b);
  const newColors = oc.filter(c => !ic.includes(c));
  const removedColors = ic.filter(c => !oc.includes(c));
  console.log(`Train ${i}: in=${JSON.stringify(ic)} out=${JSON.stringify(oc)} new=${JSON.stringify(newColors)} removed=${JSON.stringify(removedColors)}`);
}

// === OBJECT COUNT ANALYSIS ===
console.log("\n=== CONNECTED COMPONENTS ===");
for (let i = 0; i < train.length; i++) {
  const countObjs = (grid) => {
    const H = grid.length, W = grid[0].length;
    const seen = Array.from({length: H}, () => Array(W).fill(false));
    let count = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (!seen[r][c] && grid[r][c] !== 0) {
        count++;
        const stack = [[r,c]], color = grid[r][c];
        while (stack.length) {
          const [cr,cc] = stack.pop();
          if (cr<0||cr>=H||cc<0||cc>=W||seen[cr][cc]||grid[cr][cc]!==color) continue;
          seen[cr][cc] = true;
          stack.push([cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]);
        }
      }
    }
    return count;
  };
  console.log(`Train ${i}: input objects=${countObjs(train[i].input)}, output objects=${countObjs(train[i].output)}`);
}

// === SYMMETRY CHECK ===
console.log("\n=== SYMMETRY TRANSFORMS ===");
if (sameDims) {
  const gridEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (let i = 0; i < train.length; i++) {
    const inp = train[i].input, out = train[i].output;
    const checks = {
      identity: gridEqual(inp, out),
      hFlip: gridEqual(inp.map(r => [...r].reverse()), out),
      vFlip: gridEqual([...inp].reverse(), out),
      rot90: (() => {
        const H = inp.length, W = inp[0].length;
        if (out.length !== W || out[0].length !== H) return false;
        const rotated = Array.from({length: W}, (_, c) => Array.from({length: H}, (_, r) => inp[H-1-r][c]));
        return gridEqual(rotated, out);
      })(),
      rot180: gridEqual([...inp].reverse().map(r => [...r].reverse()), out),
      transpose: (() => {
        const H = inp.length, W = inp[0].length;
        if (out.length !== W || out[0].length !== H) return false;
        const t = Array.from({length: W}, (_, c) => Array.from({length: H}, (_, r) => inp[r][c]));
        return gridEqual(t, out);
      })(),
    };
    const matches = Object.entries(checks).filter(([,v]) => v).map(([k]) => k);
    console.log(`Train ${i}: ${matches.length > 0 ? matches.join(", ") : "none"}`);
  }
}
```

This single iteration tells you: dimension relationship, color mapping, where changes happen, object structure, and whether it's a simple geometric transform. Most puzzles are immediately narrowed to 1-2 hypothesis classes.

### Iteration 2: Targeted Deep Dive

Based on the survey results, write **focused algorithms** to test the most likely pattern class. This is where you write custom math.

**If dimensions change** — analyze the mathematical relationship (factor, crop, tile):

```javascript
// Is output a tiling of a sub-pattern from input?
function detectTiling(input, output) {
  const [oH, oW] = [output.length, output[0].length];
  // Try every possible tile size that divides output dimensions
  for (let th = 1; th <= oH; th++) {
    if (oH % th !== 0) continue;
    for (let tw = 1; tw <= oW; tw++) {
      if (oW % tw !== 0) continue;
      const tile = output.slice(0, th).map(r => r.slice(0, tw));
      let match = true;
      for (let r = 0; r < oH && match; r++)
        for (let c = 0; c < oW && match; c++)
          if (output[r][c] !== tile[r % th][c % tw]) match = false;
      if (match) return { tileH: th, tileW: tw, tile };
    }
  }
  return null;
}
```

**If same dimensions** — mine the local transformation rule:

```javascript
// For each cell, what neighborhood pattern predicts the output?
// Build a lookup: neighborhood_hash -> output_value
function mineLocalRule(input, output, radius) {
  const H = input.length, W = input[0].length;
  const rules = {};
  let conflicts = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const neighborhood = [];
      for (let dr = -radius; dr <= radius; dr++)
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = r + dr, nc = c + dc;
          neighborhood.push(nr >= 0 && nr < H && nc >= 0 && nc < W ? input[nr][nc] : -1);
        }
      const key = neighborhood.join(",");
      const val = output[r][c];
      if (rules[key] !== undefined && rules[key] !== val) conflicts++;
      rules[key] = val;
    }
  }
  return { ruleCount: Object.keys(rules).length, conflicts };
}

// Test radius 0 (pointwise), 1 (3x3), 2 (5x5) across all training pairs
for (const radius of [0, 1, 2]) {
  let totalConflicts = 0;
  for (const ex of train) {
    const { conflicts } = mineLocalRule(ex.input, ex.output, radius);
    totalConflicts += conflicts;
  }
  console.log(`Radius ${radius}: ${totalConflicts} conflicts across all training pairs`);
}
```

If radius-1 has 0 conflicts, **the transformation is a 3x3 neighborhood rule** — you just need to build the lookup table and apply it to test.

### Iteration 3+: Build and Test Transform from Evidence

Now you have quantitative evidence. Write a `transform()` function that implements the discovered rule, test on ALL training pairs, and iterate on the failures.

The key mindset: every `transform()` you write should be **derived from computed evidence**, not from visual intuition. If your analysis found 0 conflicts at radius 1, build the lookup table. If you found a consistent color remap, build the mapping. If you found a tiling pattern, implement the tiler.

### The Analysis Toolkit

Run whichever of these are relevant. Each is a few lines that can share a code block:

**1. Diff Grid** — visualize exactly what changed:
```javascript
function diffGrid(input, output) {
  // Returns grid: 0=unchanged, 1=changed
  return input.map((row, r) => row.map((v, c) => v === output[r][c] ? 0 : 1));
}
```

**2. Color Adjacency** — what colors neighbor each other?
```javascript
function colorAdjacency(grid) {
  const adj = {};
  const H = grid.length, W = grid[0].length;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    for (const [dr, dc] of [[0,1],[1,0]]) {
      const nr = r+dr, nc = c+dc;
      if (nr < H && nc < W && grid[r][c] !== grid[nr][nc]) {
        const key = `${Math.min(grid[r][c],grid[nr][nc])}-${Math.max(grid[r][c],grid[nr][nc])}`;
        adj[key] = (adj[key] || 0) + 1;
      }
    }
  }
  return adj;
}
```

**3. Row/Column Signatures** — reduce each row/col to a feature for pattern detection:
```javascript
function rowSignatures(grid) {
  return grid.map(row => {
    const counts = {};
    for (const v of row) counts[v] = (counts[v] || 0) + 1;
    return JSON.stringify(Object.entries(counts).sort());
  });
}
// If input and output have identical row signatures in different order -> it's a row sort/permutation
```

**4. Bounding Box Relationship** — how do object positions change?
```javascript
function objectBBoxes(grid, bg = 0) {
  // Returns array of {color, minR, maxR, minC, maxC, area}
  const H = grid.length, W = grid[0].length;
  const seen = Array.from({length: H}, () => Array(W).fill(false));
  const objects = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!seen[r][c] && grid[r][c] !== bg) {
      const color = grid[r][c];
      let minR=r, maxR=r, minC=c, maxC=c, area=0;
      const stack = [[r,c]];
      while (stack.length) {
        const [cr,cc] = stack.pop();
        if (cr<0||cr>=H||cc<0||cc>=W||seen[cr][cc]||grid[cr][cc]!==color) continue;
        seen[cr][cc] = true;
        area++; minR=Math.min(minR,cr); maxR=Math.max(maxR,cr);
        minC=Math.min(minC,cc); maxC=Math.max(maxC,cc);
        stack.push([cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]);
      }
      objects.push({ color, minR, maxR, minC, maxC, area, h: maxR-minR+1, w: maxC-minC+1 });
    }
  }
  return objects;
}
```

**5. Periodicity Detection** — is there a repeating unit?
```javascript
function detectPeriod(grid) {
  const H = grid.length, W = grid[0].length;
  const periods = [];
  // Test horizontal periods
  for (let p = 1; p <= W / 2; p++) {
    if (W % p !== 0) continue;
    let match = true;
    for (let r = 0; r < H && match; r++)
      for (let c = p; c < W && match; c++)
        if (grid[r][c] !== grid[r][c % p]) match = false;
    if (match) periods.push({ axis: "horizontal", period: p });
  }
  // Test vertical periods
  for (let p = 1; p <= H / 2; p++) {
    if (H % p !== 0) continue;
    let match = true;
    for (let r = p; r < H && match; r++)
      for (let c = 0; c < W && match; c++)
        if (grid[r][c] !== grid[r % p][c]) match = false;
    if (match) periods.push({ axis: "vertical", period: p });
  }
  return periods;
}
```

**6. Cross-Example Feature Correlation** — do numerical features predict the transform?
```javascript
// Reduce each training pair to features, look for consistent relationships
const features = train.map(ex => {
  const ic = {}, oc = {};
  for (const v of ex.input.flat()) ic[v] = (ic[v] || 0) + 1;
  for (const v of ex.output.flat()) oc[v] = (oc[v] || 0) + 1;
  return {
    inputH: ex.input.length, inputW: ex.input[0].length,
    outputH: ex.output.length, outputW: ex.output[0].length,
    inputColors: Object.keys(ic).length,
    outputColors: Object.keys(oc).length,
    inputColorCounts: ic, outputColorCounts: oc,
  };
});
console.log("Feature table:", JSON.stringify(features, null, 2));
```

### The Rhythm

Alternate between **exploration** (dense analysis) and **synthesis** (building transforms from evidence):

| Iteration | Mode | What to do |
|-----------|------|------------|
| 1 | Explore | Grand Survey: run 5-10 analyses, print structured results |
| 2 | Explore | Targeted Deep Dive: follow up on the most promising signal from iter 1 |
| 3 | Synthesize | Write `transform()` derived from mathematical evidence, test on ALL training pairs |
| 4 | Explore | Analyze failures: for each failing example, run diff, print expected vs actual, identify the discrepancy mathematically |
| 5+ | Synthesize | Refine transform, re-test, iterate |

At the **midpoint** of your budget, you should have a `transform()` that passes at least some training examples. If you don't, your analysis missed something — go back and run the checks you skipped.

### What This Prevents

- **Guessing from visual intuition** — you shouldn't hypothesize "it looks like a rotation" when you can compute `gridEqual(rotate90(input), output)` in one line
- **One-check-per-iteration** — instead of testing one idea per iteration, test 10 ideas per iteration and eliminate 9
- **Ignoring cross-example consistency** — a pattern that holds for 1 example but not all 4 is noise; only patterns consistent across ALL pairs matter
- **Building transforms from vibes** — every `transform()` should trace back to a specific quantitative finding from your analysis
- **Missing the simple explanation** — the grand survey catches color remaps, geometric transforms, and dimension relationships in iteration 1, before you over-complicate things

### The Mindset

You are not an artist looking at pretty grids. You are an algorithm designer reverse-engineering an unknown function `f(input) = output` from examples. Write code that computes properties of `f`, not code that implements your guess about `f`. Let the math tell you what `f` is.
