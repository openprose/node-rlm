---
name: arc3-level-react
kind: app
version: 2.2.0
description: Play one ARC-3 level -- explore, discover mechanics, navigate toward goals
author: sl
tags: [arc, arc3, exploration, react, multi-agent]
requires: []
---

## ARC-3 Level React Agent

You play ONE level of an interactive 64x64 grid game. The rules are unknown -- learn them by experimenting. You have a limited action budget, so balance exploration with exploitation.

### Rules

1. NEVER call `arc3.start()`. The game is already running. Calling it resets ALL progress.
2. Use `arc3.step(action)` to take actions. You have a finite action budget (check `__level_task.actionBudget`).
3. Track your action count yourself. When you approach the budget, stop and return what you have.
4. The engine tracks your iteration budget via `__rlm.iteration` and `__rlm.maxIterations`. You will receive iteration warnings automatically -- pay attention to them.
5. Return a result before your iterations run out. Partial observations are infinitely better than no return.

### Iteration Budget Strategy

Check `__rlm.maxIterations` to know your total budget. Suggested allocation:
- **Iteration 0**: Setup -- read prior knowledge, observe the grid, define utilities.
- **Iteration 1**: Discovery -- if prior knowledge covers movement (3+ mechanics), skip to environment mapping; otherwise test each direction.
- **Iterations 2 through N-2**: Gameplay -- explore, interact, try to complete the level.
- **Iteration N-1** (final): Return your results immediately. The engine will warn you.

### API

- `arc3.step(action)` -> frame after action (costs 1 action from your budget)
- `arc3.observe()` -> current frame (free, no action cost)
- Frame: `{ frame: number[][][], state, levels_completed, available_actions }`
- `frame.frame[0]` is the 64x64 grid. `frame.frame[0][row][col]` -> color index 0-15.

### Iteration 0: Setup

Read prior knowledge, observe the grid, and define your perceptual toolkit.

```javascript
// === SETUP ===
const task = (typeof __level_task !== 'undefined') ? __level_task : {};
const prior = task.knowledge || {};
const actionBudget = task.actionBudget || 32;
__actionsUsed = 0;

__k = {
  objectTypes: prior.objectTypes || {},
  mechanics: prior.mechanics || {},
  rules: prior.rules || [],
  openQuestions: prior.openQuestions || [],
};
__rawObs = [];

// === PERCEPTUAL TOOLKIT ===
function diffGrids(a, b) {
  const changes = [];
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[0].length; c++)
      if (a[r][c] !== b[r][c]) changes.push({ r, c, was: a[r][c], now: b[r][c] });
  return changes;
}

function colorFreqs(grid) {
  const freq = {};
  for (const row of grid) for (const v of row) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ color: +c, count: n }));
}

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
    });
  }
  return comps;
}

function renderRegion(g, r0, r1, c0, c1) {
  const rows = [];
  for (let r = r0; r <= Math.min(r1, g.length-1); r++)
    rows.push(g[r].slice(c0, Math.min(c1, g[0].length-1)+1).map(v => v.toString(16)).join(''));
  return rows.join('\n');
}

// === INITIAL OBSERVATION ===
const frame0 = arc3.observe();
__grid = frame0.frame[0];
__startLevel = frame0.levels_completed;
const freqs = colorFreqs(__grid);
console.log(`Level ${__startLevel + 1}. Grid: ${__grid.length}x${__grid[0].length}`);
console.log(`Colors: ${freqs.slice(0, 6).map(f => `${f.color}:${f.count}`).join(', ')}`);
console.log(`Actions: ${frame0.available_actions}`);
console.log(`Action budget: ${actionBudget}. Iteration budget: ${__rlm.maxIterations}.`);

// === ASSESS PRIOR KNOWLEDGE ===
const priorMechKeys = Object.keys(prior.mechanics || {});
const priorHazardKeys = Object.keys(prior.hazards || {});
const priorObjKeys = Object.keys(prior.objectTypes || {});
const priorRules = prior.rules || [];
const priorOpenQs = prior.openQuestions || [];

__skipDiscovery = priorMechKeys.length > 2; // enough baseline to skip 4-dir test

if (priorMechKeys.length > 0) {
  console.log(`PRIOR: ${priorMechKeys.length} mechanics known: ${priorMechKeys.join(', ')}`);
  console.log(`PRIOR: ${priorRules.length} rules, ${priorHazardKeys.length} hazards, ${priorObjKeys.length} object types`);
  if (priorHazardKeys.length > 0) console.log(`HAZARDS to watch for: ${priorHazardKeys.join(', ')}`);
  if (priorOpenQs.length > 0) console.log(`OPEN QUESTIONS to investigate: ${priorOpenQs.join('; ')}`);
  if (__skipDiscovery) {
    console.log("Movement mechanics already known -- will skip 4-direction test, go straight to environment mapping.");
    console.log("NEXT: Map environment, identify new objects, focus on open questions.");
  } else {
    console.log("Some prior knowledge but movement not fully known. NEXT: Abbreviated discovery.");
  }
} else {
  console.log("No prior knowledge -- this is the first level. NEXT: Full discovery (test all 4 directions).");
}
```

### Iteration 1: Discovery (knowledge-adaptive)

If prior knowledge covers movement mechanics (3+ known), skip the 4-direction test and go straight to environment mapping. Otherwise, run full discovery.

```javascript
if (__skipDiscovery) {
  // === ABBREVIATED DISCOVERY: Prior knowledge covers movement mechanics ===
  console.log("Skipping 4-direction test -- movement mechanics known from prior levels.");

  // Log known hazards and object types so we know what to watch for
  const hazardKeys = Object.keys(__k.hazards || {});
  if (hazardKeys.length > 0) console.log(`Known hazards: ${hazardKeys.join(', ')} -- will avoid these.`);
  const objKeys = Object.keys(__k.objectTypes || {});
  if (objKeys.length > 0) console.log(`Known object types: ${objKeys.join(', ')}`);

  // Go straight to environment mapping -- find what's unique to THIS level
  const freqs = colorFreqs(__grid);
  const bgColors = new Set(freqs.filter(f => f.count > 500).map(f => f.color));
  const comps = findComponents(__grid, bgColors);
  console.log(`Environment: ${comps.length} components, bg colors: ${[...bgColors]}`);

  // Identify NEW object types not seen in prior levels
  const knownColors = new Set();
  for (const obj of Object.values(__k.objectTypes || {})) {
    if (obj.color !== undefined) knownColors.add(obj.color);
  }
  const newComps = comps.filter(c => !knownColors.has(c.color));
  if (newComps.length > 0) {
    console.log(`NEW objects not in prior knowledge: ${newComps.map(c => `color=${c.color},size=${c.count}`).join('; ')}`);
  } else {
    console.log("All object colors seen before -- focus on spatial layout and goal conditions.");
  }

  // Focus: log open questions to investigate this level
  const openQs = __k.openQuestions || [];
  if (openQs.length > 0) {
    console.log(`INVESTIGATING open questions: ${openQs.join('; ')}`);
  }

  // Take ONE exploratory action to confirm mechanics still apply on this level
  if (__actionsUsed < (typeof actionBudget !== 'undefined' ? actionBudget : 32)) {
    const before = arc3.observe().frame[0];
    const result = await arc3.step(1); // test UP
    __actionsUsed++;
    const after = result.frame[0];
    const changes = diffGrids(before, after);
    console.log(`Sanity check (action UP): ${changes.filter(c => c.r < 52).length} maze, ${changes.filter(c => c.r >= 52).length} HUD changes`);
    if (result.levels_completed > __startLevel) { console.log("LEVEL COMPLETED!"); }
  }

  __rawObs.push({ type: 'abbreviated-discovery', reason: 'prior knowledge sufficient', comps: comps.length, newComps: newComps.length });
  __grid = arc3.observe().frame[0];
  console.log(`Abbreviated discovery done. ${__actionsUsed} actions used (saved ~3 actions).`);
} else {
  // === FULL DISCOVERY: Test each direction and record diffs ===
  const discoveries = [];
  for (const action of [1, 2, 3, 4]) {
    if (__actionsUsed >= (typeof actionBudget !== 'undefined' ? actionBudget : 32)) break;
    const before = arc3.observe().frame[0];
    const result = await arc3.step(action);
    __actionsUsed++;
    const after = result.frame[0];
    const changes = diffGrids(before, after);
    const mazeChanges = changes.filter(c => c.r < 52);
    const hudChanges = changes.filter(c => c.r >= 52);
    discoveries.push({ action, maze: mazeChanges.length, hud: hudChanges.length,
      mazeEx: mazeChanges.slice(0, 10), hudEx: hudChanges.slice(0, 5), state: result.state });
    console.log(`Action ${action}: ${mazeChanges.length} maze, ${hudChanges.length} HUD changes`);
    if (result.levels_completed > __startLevel) { console.log("LEVEL COMPLETED!"); break; }
    if (changes.length > 1000) console.log("  WARNING: Massive change -- possible death");
  }
  // Analyze: the entity that MOVED is your character
  const movingColors = new Set();
  for (const d of discoveries) for (const mc of d.mazeEx) { movingColors.add(mc.was); movingColors.add(mc.now); }
  console.log("Colors that moved:", [...movingColors]);
  __rawObs.push({ type: 'discovery', discoveries });
  __grid = arc3.observe().frame[0];
  console.log(`Discovery done. ${__actionsUsed} actions used.`);
}
```

### Core Loop (Iteration 2+)

Each iteration: **observe -> diff -> update knowledge -> decide -> act**.

```javascript
// 1. Observe and diff
const grid = arc3.observe().frame[0];
const changes = diffGrids(__grid, grid);

// 2. Record raw observation
__rawObs.push({ type: 'observation', changes: changes.length, iter: __rlm.iteration });

// 3. Decide: explore or exploit?
// Explore if: unknown object types, or goal condition unclear
// Exploit if: you understand the win condition

// 4. Execute using arc3.step(action) -- track your action count
// const result = await arc3.step(1); // example: move up
// __actionsUsed++;

// 5. Update state
__grid = grid;
```

### Behavioral Priorities

1. **Discover movement first.** Take each available action once and observe what moves, by how much, and in which direction.

2. **Identify all distinct objects.** Use `colorFreqs` to determine background colors, then `findComponents` to catalog every non-background feature.

3. **Interact with every object type.** Navigate to it, step on it, observe what changes across the *entire* grid.

4. **Watch the whole grid for changes, especially edges and corners.** HUD elements (bars, corner displays, counters) carry game state.

5. **Compare before committing.** If you identify what looks like a goal, check whether reaching it actually completes the level.

6. **Record observations, not just conclusions.** In `__rawObs`, store what you observed alongside your hypothesis.

7. **Surprises are the most valuable data.** When something unexpected happens -- investigate.

8. **The player character is the largest multi-color object that moves.** Do NOT assume the smallest or most visually distinctive object is the player. Test movement first.

### On Completion

Return a JSON string with raw observations for the synthesizer to process.

```javascript
const result = {
  mechanics: __k.mechanics || {},
  objectTypes: __k.objectTypes || {},
  actions: __actionsUsed,
  completed: arc3.observe().levels_completed > __startLevel,
  rawObservations: __rawObs,
  rules: __k.rules || [],
};
return(JSON.stringify(result));
```
