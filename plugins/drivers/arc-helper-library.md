---
name: arc-helper-library
kind: driver
version: 0.1.0
description: Pre-built utility functions for common ARC grid operations
author: sl
tags: [arc, utilities, pattern-recognition]
requires: []
---

## ARC Helper Library

These utility functions handle common ARC operations that are surprisingly hard to implement correctly under iteration pressure. Copy them into your first code block and use them freely.

### Grid Basics

```javascript
function gridDims(grid) { return [grid.length, grid[0].length]; }
function gridEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function gridCopy(grid) { return grid.map(r => [...r]); }
function gridNew(H, W, fill = 0) { return Array.from({length: H}, () => Array(W).fill(fill)); }
function subgrid(grid, r1, c1, r2, c2) {
  return grid.slice(r1, r2).map(row => row.slice(c1, c2));
}
```

### Color Analysis

```javascript
function colorCounts(grid) {
  const counts = {};
  for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
  return counts;
}

function colorsPresent(grid) {
  return [...new Set(grid.flat())].sort((a, b) => a - b);
}

function backgroundColor(grid) {
  const counts = colorCounts(grid);
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function classifyColors(grid) {
  const counts = colorCounts(grid);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const bg = +sorted[0][0];
  const others = sorted.slice(1).map(([c]) => +c);
  return { background: bg, foreground: others };
}
```

### Dividers and Regions

```javascript
function findRowDividers(grid) {
  // Rows where every cell is the same non-background color
  const bg = backgroundColor(grid);
  const dividers = [];
  for (let r = 0; r < grid.length; r++) {
    const vals = new Set(grid[r]);
    if (vals.size === 1 && !vals.has(bg)) dividers.push(r);
  }
  return dividers;
}

function findColDividers(grid) {
  const bg = backgroundColor(grid);
  const [H, W] = gridDims(grid);
  const dividers = [];
  for (let c = 0; c < W; c++) {
    const vals = new Set();
    for (let r = 0; r < H; r++) vals.add(grid[r][c]);
    if (vals.size === 1 && !vals.has(bg)) dividers.push(c);
  }
  return dividers;
}

function splitByDividers(grid, rowDivs, colDivs) {
  // Returns a 2D array of sub-grids split by divider rows/cols
  const rBounds = [-1, ...rowDivs, grid.length];
  const cBounds = [-1, ...colDivs, grid[0].length];
  const regions = [];
  for (let ri = 0; ri < rBounds.length - 1; ri++) {
    const regionRow = [];
    for (let ci = 0; ci < cBounds.length - 1; ci++) {
      regionRow.push(subgrid(grid, rBounds[ri] + 1, cBounds[ci] + 1, rBounds[ri + 1], cBounds[ci + 1]));
    }
    regions.push(regionRow);
  }
  return regions;
}
```

### Symmetry Testing

```javascript
function reflectH(grid) { return grid.map(r => [...r].reverse()); }
function reflectV(grid) { return [...grid].reverse().map(r => [...r]); }
function rotate90(grid) {
  const [H, W] = gridDims(grid);
  return Array.from({length: W}, (_, c) => Array.from({length: H}, (_, r) => grid[H - 1 - r][c]));
}
function rotate180(grid) { return reflectV(reflectH(grid)); }
function rotate270(grid) { return rotate90(rotate90(rotate90(grid))); }
function transpose(grid) {
  const [H, W] = gridDims(grid);
  return Array.from({length: W}, (_, c) => Array.from({length: H}, (_, r) => grid[r][c]));
}

function testAllSymmetries(grid, target) {
  const ops = [
    ['identity',   grid],
    ['reflectH',   reflectH(grid)],
    ['reflectV',   reflectV(grid)],
    ['rotate90',   rotate90(grid)],
    ['rotate180',  rotate180(grid)],
    ['rotate270',  rotate270(grid)],
    ['transpose',  transpose(grid)],
  ];
  for (const [name, result] of ops) {
    if (gridEqual(result, target)) return name;
  }
  return null;
}
```

### Connected Components

```javascript
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
  // predicate(cellValue, r, c) => boolean
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
```

### Repeating Tile Detection

```javascript
function findRepeatingTile(seq, minLen = 2, maxLen) {
  // Find the shortest repeating unit in a 1D sequence, tolerating errors.
  // maxLen defaults to n/3 to prevent period-memorization (tile ≈ sequence length).
  const n = seq.length;
  maxLen = maxLen || Math.floor(n / 3);
  let bestTile = null, bestErrors = Infinity;
  for (let len = minLen; len <= Math.min(maxLen, Math.floor(n / 2)); len++) {
    // Vote for each position in the tile across all repetitions
    const tile = [];
    for (let pos = 0; pos < len; pos++) {
      const votes = {};
      for (let i = pos; i < n; i += len) {
        votes[seq[i]] = (votes[seq[i]] || 0) + 1;
      }
      tile.push(+Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]);
    }
    // Count errors
    let errors = 0;
    for (let i = 0; i < n; i++) {
      if (seq[i] !== tile[i % len]) errors++;
    }
    if (errors < bestErrors) {
      bestErrors = errors;
      bestTile = tile;
      if (errors === 0) break; // perfect match
    }
  }
  return { tile: bestTile, errors: bestErrors };
}
```

### Concentric Rectangle Fill

```javascript
function fillConcentricRects(H, W, colors) {
  // Fill an HxW grid with concentric rectangular frames alternating colors.
  // colors = [outerColor, innerColor] or [c0, c1, c2, ...]
  const grid = gridNew(H, W);
  const layers = Math.ceil(Math.min(H, W) / 2);
  for (let layer = 0; layer < layers; layer++) {
    const color = colors[layer % colors.length];
    for (let r = layer; r < H - layer; r++) {
      for (let c = layer; c < W - layer; c++) {
        grid[r][c] = color;
      }
    }
  }
  return grid;
}
```

### Usage

Copy any functions you need into your first iteration. They are tested and correct — you do not need to re-derive them. Spend your iteration budget on understanding the transformation rule, not reimplementing grid utilities.
