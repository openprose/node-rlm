---
name: arc3-player
kind: app
version: 1.2.0
description: Play one ARC-3 level — learn mechanics by experimenting, then execute strategically
author: sl
tags: [arc, arc3, exploration, learning]
requires: []
---

## ARC-3 Level Player

You play ONE level of an interactive 64x64 grid game. The rules are unknown — learn them by experimenting. You have a limited action budget, so balance exploration (learning what things do) with exploitation (completing the level efficiently).

### Rules

1. You MUST return a result before hitting the iteration limit. An incomplete return with partial knowledge is infinitely better than a timeout with no return.
2. Reserve the last 2 iterations as a safety margin — the deadline guard handles this automatically via `__maxIter`.
3. Every iteration MUST start with the deadline guard below. Copy it exactly — do NOT skip it.
4. Test each available action ONCE in your first real iteration (the discovery protocol). Do not skip this.
5. Track `__actionsThisLevel` after every `arc3.step()` call. Return if it exceeds 40.
6. NEVER call `arc3.start()`. The game is already running. Calling `arc3.start()` resets ALL progress across ALL levels. You only have `arc3.step()`, `arc3.observe()`, and `arc3.actionCount`.
7. Budget at most 40 game actions per level. If you exceed 40 actions, return immediately with whatever knowledge you have.

### API

- `arc3.step(action)` → frame after action (check `available_actions` for valid action numbers)
- `arc3.observe()` → current frame (free, no action cost)
- `arc3.actionCount` → total actions taken
- Frame: `{ frame: number[][][], state, levels_completed, available_actions }`
- `frame.frame[0]` is the 64x64 grid. `frame.frame[0][row][col]` → color index 0-15.

### Iteration 0: Setup

Read prior knowledge and define your perceptual toolkit.

```javascript
const prior = (typeof __level_task !== 'undefined') ? __level_task.knowledge : {};
__k = {
  objectTypes: prior.objectTypes || {},
  mechanics: prior.mechanics || {},
  rules: prior.rules || [],
  openQuestions: prior.openQuestions || [],
};
__iterCount = 0;
__maxIter = 20; // Return by __maxIter - 2 = iteration 18. Do NOT change this.

// === Perceptual Toolkit ===
// These are general vision algorithms — they encode NO game knowledge.

// Connected-component labeling: find contiguous same-color regions.
// You must determine which colors are "background" by analyzing color frequencies.
function findComponents(grid, bgColors) {
  const H = grid.length, W = grid[0].length;
  const vis = Array.from({length: H}, () => new Uint8Array(W));
  const comps = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (vis[r][c] || bgColors.has(grid[r][c])) continue;
    const color = grid[r][c], px = [], q = [[r, c]];
    vis[r][c] = 1;
    while (q.length) {
      const [cr, cc] = q.shift(); px.push([cr, cc]);
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nr = cr+dr, nc = cc+dc;
        if (nr>=0 && nr<H && nc>=0 && nc<W && !vis[nr][nc] && grid[nr][nc]===color)
          { vis[nr][nc]=1; q.push([nr,nc]); }
      }
    }
    const rs = px.map(p=>p[0]), cs = px.map(p=>p[1]);
    comps.push({ color, count: px.length,
      rMin: Math.min(...rs), rMax: Math.max(...rs),
      cMin: Math.min(...cs), cMax: Math.max(...cs),
      cr: Math.round(rs.reduce((a,b)=>a+b)/rs.length),
      cc: Math.round(cs.reduce((a,b)=>a+b)/cs.length),
    });
  }
  return comps;
}

// Group nearby components into multi-color objects.
// `dist` = max gap in pixels to consider components part of the same object.
function clusterObjects(comps, dist) {
  if (!dist) dist = 3;
  const used = new Set(), objects = [];
  function bDist(a, b) {
    return Math.max(
      Math.max(0, Math.max(a.rMin, b.rMin) - Math.min(a.rMax, b.rMax)),
      Math.max(0, Math.max(a.cMin, b.cMin) - Math.min(a.cMax, b.cMax)));
  }
  for (let i = 0; i < comps.length; i++) {
    if (used.has(i)) continue;
    const cluster = [comps[i]]; used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < comps.length; j++) {
        if (used.has(j)) continue;
        if (cluster.some(c => bDist(c, comps[j]) <= dist)) {
          cluster.push(comps[j]); used.add(j); changed = true;
        }
      }
    }
    objects.push({
      colors: [...new Set(cluster.map(c => c.color))].sort((a,b)=>a-b),
      pixels: cluster.reduce((s, c) => s + c.count, 0),
      rMin: Math.min(...cluster.map(c=>c.rMin)), rMax: Math.max(...cluster.map(c=>c.rMax)),
      cMin: Math.min(...cluster.map(c=>c.cMin)), cMax: Math.max(...cluster.map(c=>c.cMax)),
      cr: Math.round(cluster.reduce((s,c)=>s+c.cr*c.count,0)/cluster.reduce((s,c)=>s+c.count,0)),
      cc: Math.round(cluster.reduce((s,c)=>s+c.cc*c.count,0)/cluster.reduce((s,c)=>s+c.count,0)),
      components: cluster,
    });
  }
  return objects;
}

// Color frequency analysis: find the most common colors (likely background).
function colorFreqs(grid) {
  const freq = {};
  for (const row of grid) for (const v of row) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ color: +c, count: n }));
}

// Render a sub-region as hex for visual inspection.
function renderRegion(g, r0, r1, c0, c1) {
  const rows = [];
  for (let r = r0; r <= Math.min(r1, g.length-1); r++)
    rows.push(g[r].slice(c0, Math.min(c1, g[0].length-1)+1).map(v => v.toString(16)).join(''));
  return rows.join('\n');
}

// Pixel-level diff between two grids.
function diffGrids(a, b) {
  const changes = [];
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[0].length; c++)
      if (a[r][c] !== b[r][c]) changes.push({ r, c, was: a[r][c], now: b[r][c] });
  return changes;
}

// Initial observation
const frame0 = arc3.observe();
__grid = frame0.frame[0];
__startLevel = frame0.levels_completed;
__actionsThisLevel = 0;

// Analyze color distribution to determine background
const freqs = colorFreqs(__grid);
console.log(`Level ${__startLevel + 1}. Grid: ${__grid.length}x${__grid[0].length}`);
console.log(`Color frequencies: ${freqs.slice(0, 6).map(f => `${f.color}:${f.count}`).join(', ')}`);
console.log(`Available actions: ${frame0.available_actions}`);
```

### Iteration 1: Discovery Protocol (MANDATORY — run this before anything else)

Test each action exactly once, diff the full grid, record what changed. This is the foundation for all subsequent reasoning.

```javascript
// === DEADLINE GUARD (copy this exactly into every iteration) ===
if (typeof __iterCount === 'undefined') __iterCount = 0;
if (typeof __maxIter === 'undefined') __maxIter = 20;
__iterCount++;
if (__iterCount >= __maxIter - 2) {
  __level_result = { knowledge: __k, actions: __actionsThisLevel, completed: arc3.observe().levels_completed > __startLevel };
  return(`Level ${__startLevel + 1}: emergency return at iter ${__iterCount}. Results in __level_result.`);
}

// === DISCOVERY PROTOCOL: Test each action once, diff everything ===
const discoveries = [];
for (const action of frame0.available_actions.slice(0, 4)) { // test first 4 actions
  const before = arc3.observe().frame[0];
  const result = await arc3.step(action);
  __actionsThisLevel++;
  const after = result.frame[0];
  const changes = diffGrids(before, after);

  // Separate maze changes (game area) from HUD changes (bottom strip)
  const mazeChanges = changes.filter(c => c.r < 52);
  const hudChanges = changes.filter(c => c.r >= 52);

  discoveries.push({ action, totalChanges: changes.length, mazeChanges: mazeChanges.length,
    hudChanges: hudChanges.length, mazeExamples: mazeChanges.slice(0, 15),
    hudExamples: hudChanges.slice(0, 10), state: result.state });

  console.log(`Action ${action}: ${mazeChanges.length} maze, ${hudChanges.length} HUD changes`);

  // Massive change = something dramatic (death? level transition?)
  if (changes.length > 1000) console.log("  WARNING: Massive grid change — possible death or transition");
  // Level completed?
  if (result.levels_completed > __startLevel) {
    console.log("  LEVEL COMPLETED!");
    break;
  }
}

__grid = arc3.observe().frame[0];
console.log(`Discovery done. ${__actionsThisLevel} actions used.`);

// === POST-DISCOVERY ANALYSIS (do not skip) ===
// 1. Which colors moved in the maze region (r < 52)? That's your character.
const movingColors = new Set();
for (const d of discoveries) {
  for (const mc of d.mazeExamples) { movingColors.add(mc.was); movingColors.add(mc.now); }
}
console.log("Colors that moved in maze:", [...movingColors]);
// 2. How many maze pixels changed per action? 25 pixels = 5x5 block = 5px step.
for (const d of discoveries) console.log(`  Action ${d.action}: ${d.mazeChanges} maze px, ${d.hudChanges} HUD px`);
// 3. Direction mapping: action 1=up (block row decreases), 2=down, 3=left, 4=right
// 4. If any action caused 0 maze changes, you may be blocked by a wall.
// 5. HUD changes = resource meters (fuel, lives, level counter). Track which rows changed.
```

### Core Loop (Iteration 2+)

Each iteration: **deadline guard → observe → diff → update knowledge → decide → act**.

```javascript
// === DEADLINE GUARD (copy this exactly — MUST be first thing every iteration) ===
if (typeof __iterCount === 'undefined') __iterCount = 0;
if (typeof __maxIter === 'undefined') __maxIter = 20;
__iterCount++;
if (__iterCount >= __maxIter - 2) {
  __level_result = { knowledge: __k, actions: __actionsThisLevel, completed: arc3.observe().levels_completed > __startLevel };
  return(`Level ${__startLevel + 1}: emergency return at iter ${__iterCount}. Results in __level_result.`);
}
// === ACTION BUDGET GUARD ===
if (__actionsThisLevel > 40) {
  __level_result = { knowledge: __k, actions: __actionsThisLevel, completed: false };
  return(`Level ${__startLevel + 1}: action budget exceeded (${__actionsThisLevel}). Results in __level_result.`);
}

// 1. Observe current state
const frame = arc3.observe();
const grid = frame.frame[0];

// 2. Diff against previous state
const changes = diffGrids(__grid, grid);
// - What moved? What appeared/disappeared?
// - Did HUD regions change (bottom bar, corners, edges)?
// - Correlate changes with your last action

// 3. Update __k with evidence from diff + last action
// "I took action X near object Y and Z changed" → hypothesis

// 4. Decide: explore or exploit?
// Explore if: unknown object types exist, or goal condition unclear
// Exploit if: you understand the win condition and can achieve it

// 5. Execute and update state
__grid = grid;
```

### Behavioral Priorities

1. **Discover movement first.** Take each available action once and observe what moves, by how much, and in which direction. This tells you which entity you control and how movement works.

2. **Identify all distinct objects.** Use `colorFreqs` to determine background colors, then `findComponents` + `clusterObjects` to catalog every non-background feature. Each unique object type is something to investigate.

3. **Interact with every object type.** Navigate to it, step on it (or use different actions near it), observe what changes across the *entire* grid. One interaction teaches more than 50 moves of blind navigation.

4. **Watch the whole grid for changes, especially edges and corners.** HUD elements (bars, corner displays, counters) carry game state. Diff these regions separately from the maze interior after every action.

5. **Compare before committing.** If you identify what looks like a goal, check whether reaching it actually completes the level. If not, you're missing a precondition — explore more.

6. **Record evidence, not just conclusions.** In `__k`, store what you observed ("took action 1 near [r,c], bottom-left region changed from pattern A to B") alongside your hypothesis. Evidence lets you correct wrong hypotheses later.

7. **Surprises are the most valuable data.** When something unexpected happens — investigate, don't skip.

### On Completion

```javascript
__level_result = {
  knowledge: __k,
  actions: __actionsThisLevel,
  completed: arc3.observe().levels_completed > __startLevel,
};
return(`Level ${__startLevel + 1}: ${__level_result.completed ? 'done' : 'incomplete'}, ` +
  `${__actionsThisLevel} actions, ${Object.keys(__k.mechanics).length} mechanics found. ` +
  `Results in __level_result.`);
```
