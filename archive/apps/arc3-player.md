---
name: arc3-player
kind: app
version: 1.8.0
description: Play one ARC-3 level — learn mechanics by experimenting, then execute strategically
author: sl
tags: [arc, arc3, exploration, learning]
requires: []
---

## ARC-3 Level Player

You play ONE level of an interactive 64x64 grid game. The rules are unknown — learn them by experimenting. You have a limited action budget, so balance exploration (learning what things do) with exploitation (completing the level efficiently).

### Rules (CRITICAL — read these FIRST)

1. **YOUR MOST IMPORTANT RULE:** The FIRST LINE of EVERY code block must be:
   ```
   if (__guard()) return(__guard.msg);
   ```
   This checks the iteration deadline and action budget. It is already defined from setup. Just call it.
2. NEVER call `arc3.start()`. The game is already running. Calling it resets ALL progress.
3. Use `step(action)` to take actions. `arc3.step()` has been replaced — both call the same budget-enforced wrapper (32 actions max). The wrapper is locked via `Object.defineProperty` — you cannot reassign or bypass it.
4. Iteration 1: call `await __discover()` to test each direction and get a diff analysis. Do not skip this.
5. Plan your work: iter 0 = setup, iter 1 = discover, iters 2-8 = play, iter 9 = return results.
6. Return a result before timeout. Partial knowledge is infinitely better than no return.

### API

- `step(action)` → frame after action (budget-enforced, auto-tracks actions)
- `arc3.observe()` → current frame (free, no action cost)
- Frame: `{ frame: number[][][], state, levels_completed, available_actions }`
- `frame.frame[0]` is the 64x64 grid. `frame.frame[0][row][col]` → color index 0-15.
- When action budget is exceeded, `step()` returns `{ state: 'BUDGET_EXCEEDED' }` and stops taking actions.

### Iteration 0: Setup

Read prior knowledge and define your perceptual toolkit.

```javascript
// === SETUP: Define persistent functions and state ===
const prior = (typeof __level_task !== 'undefined') ? __level_task.knowledge : {};
__k = {
  objectTypes: prior.objectTypes || {},
  mechanics: prior.mechanics || {},
  rules: prior.rules || [],
  openQuestions: prior.openQuestions || [],
};
__iterCount = 0;
__actionsThisLevel = 0;
__done = false;

// === GUARD: Call `if (__guard()) return(__guard.msg);` as first line of every code block ===
__guard = function() {
  __iterCount++;
  if (__done && __returnPayload) {
    __guard.msg = __returnPayload;
    return true;
  }
  if (__done) {
    __guard.msg = JSON.stringify({ knowledge: __k || {}, actions: __actionsThisLevel || 0, completed: false });
    return true;
  }
  if (__iterCount >= 10) {
    __guard.msg = JSON.stringify({ knowledge: __k || {}, actions: __actionsThisLevel || 0, completed: false, reason: 'timeout' });
    return true;
  }
  return false;
};
__guard.msg = "";

// === INTERCEPT arc3.step — budget enforcement is UNAVOIDABLE ===
// IIFE + Object.defineProperty: original hidden in closure, property locked
__returnPayload = null;
(function() {
  const _origStep = arc3.step.bind(arc3);
  const _wrappedStep = async function(action) {
    __actionsThisLevel++;
    if (__actionsThisLevel > 32) {
      __done = true;
      __returnPayload = JSON.stringify({ knowledge: __k, actions: __actionsThisLevel, completed: false, reason: 'budget' });
      return { state: 'BUDGET_EXCEEDED', frame: [arc3.observe().frame[0]], levels_completed: arc3.observe().levels_completed, available_actions: [] };
    }
    const result = await _origStep(action);
    if (result.state === 'GAME_OVER') {
      __k.rules.push("GAME_OVER at " + __actionsThisLevel + " actions");
      __done = true;
      __returnPayload = JSON.stringify({ knowledge: __k, actions: __actionsThisLevel, completed: false, reason: 'game_over' });
    }
    if (result.levels_completed > __startLevel) {
      __done = true;
      __returnPayload = JSON.stringify({ knowledge: __k, actions: __actionsThisLevel, completed: true });
    }
    return result;
  };
  Object.defineProperty(arc3, 'step', { value: _wrappedStep, writable: false, configurable: false });
})();
// step() is a convenience alias — both go through the interceptor
async function step(action) { return arc3.step(action); }

// === PERCEPTUAL TOOLKIT (general vision algorithms — no game knowledge) ===
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

// === DISCOVERY: Call `await __discover()` in iteration 1 ===
__discover = async function() {
  const discoveries = [];
  for (const action of [1, 2, 3, 4]) {
    const before = arc3.observe().frame[0];
    const result = await step(action);
    const after = result.frame[0];
    const changes = diffGrids(before, after);
    const mazeChanges = changes.filter(c => c.r < 52);
    const hudChanges = changes.filter(c => c.r >= 52);
    discoveries.push({ action, maze: mazeChanges.length, hud: hudChanges.length,
      mazeEx: mazeChanges.slice(0, 10), hudEx: hudChanges.slice(0, 5), state: result.state });
    console.log(`Action ${action}: ${mazeChanges.length} maze, ${hudChanges.length} HUD changes`);
    if (result.levels_completed > __startLevel) { console.log("LEVEL COMPLETED!"); break; }
    if (changes.length > 1000) console.log("  WARNING: Massive change — possible death");
  }
  // Analyze: the entity that MOVED is your character (largest pixel change per action)
  const movingColors = new Set();
  for (const d of discoveries) for (const mc of d.mazeEx) { movingColors.add(mc.was); movingColors.add(mc.now); }
  console.log("Colors that moved:", [...movingColors]);
  console.log("Your character = the largest group of pixels that changes position each action.");
  return discoveries;
};

// === INITIAL OBSERVATION ===
const frame0 = arc3.observe();
__grid = frame0.frame[0];
__startLevel = frame0.levels_completed;
const freqs = colorFreqs(__grid);
console.log(`Level ${__startLevel + 1}. Grid: ${__grid.length}x${__grid[0].length}`);
console.log(`Colors: ${freqs.slice(0, 6).map(f => `${f.color}:${f.count}`).join(', ')}`);
console.log(`Actions: ${frame0.available_actions}`);
console.log("NEXT: Call `await __discover()` to test each direction.");
```

### Iteration 1: Discovery (MANDATORY)

Call the pre-defined `__discover()` function. It tests each direction, diffs the grid, and prints what moved.

```javascript
if (__guard()) return(__guard.msg);

const disc = await __discover();
__grid = arc3.observe().frame[0];

// Record what you learned in __k
// The entity that moved the MOST pixels is your character
// HUD changes (rows >= 52) indicate resource meters
console.log(`Discovery done. ${__actionsThisLevel} actions, ${disc.length} directions tested.`);
```

### Core Loop (Iteration 2+)

Each iteration: **guard → observe → diff → update knowledge → decide → act**.

```javascript
if (__guard()) return(__guard.msg);

// 1. Observe and diff
const grid = arc3.observe().frame[0];
const changes = diffGrids(__grid, grid);

// 2. Update __k with evidence from diff + last action

// 3. Decide: explore or exploit?
// Explore if: unknown object types, or goal condition unclear
// Exploit if: you understand the win condition

// 4. Execute using step(action) — NOT arc3.step()
// const result = await step(1); // example: move up

// 5. Update state
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

8. **The player character is the largest multi-color object that moves.** Do NOT assume the smallest or most visually distinctive object is the player. Test movement first: the entity that changes position when you take directional actions IS your character. Static objects (even if they look like players) are interactive map objects, not the avatar.

### On Completion

Return a JSON string — this is the ONLY way to send knowledge back to the orchestrator. Sandbox variables do NOT propagate to the parent.

```javascript
const result = {
  knowledge: __k,
  actions: __actionsThisLevel,
  completed: arc3.observe().levels_completed > __startLevel,
};
return(JSON.stringify(result));
```
