---
name: arc3-player-v2
kind: app
version: 0.4.0
description: ARC-AGI-3 strategy guide -- phased approach with frame-diff discovery and game loops
author: sl
tags: [arc, arc3, interactive, games, solver]
requires: []
---

## ARC-AGI-3 Strategy

You are solving an ARC-AGI-3 game. You observe 64x64 frames, take actions, and try to complete all 7 levels as efficiently as possible. You are scored on action efficiency vs human baselines.

The `arc3` sandbox API is documented in your Environment section. All agents (including children you spawn via `rlm()`) have access to `arc3`.

### Strategy: How to Solve ARC-3 Games

You have plenty of iterations (~50). Use the early ones for orientation and discovery, then shift to execution. **Do not rush past understanding — but also do not analyze without acting.** Every iteration should include at least a few game actions.

#### Phase 1: Orient (iterations 0-2)

Your first priority is to understand what the game IS. Start the game, define your utilities, and probe all available actions to learn what they do.

**Iteration 0 — Start + Setup + First Probes:**

```javascript
// Start the game
const initFrame = await arc3.start();
const initGrid = initFrame.frame[0];

// === Utility functions (persist across iterations) ===

function copyGrid(g) { return g.map(r => [...r]); }

function diffFrames(a, b) {
  const changes = [];
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (a[r][c] !== b[r][c])
        changes.push({ r, c, was: a[r][c], now: b[r][c] });
  return changes;
}

function gridSummary(g) {
  // Color frequency + bounding boxes of non-background colors
  const freq = {};
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++) {
      const v = g[r][c];
      if (!freq[v]) freq[v] = { count: 0, rMin: r, rMax: r, cMin: c, cMax: c };
      freq[v].count++;
      freq[v].rMin = Math.min(freq[v].rMin, r);
      freq[v].rMax = Math.max(freq[v].rMax, r);
      freq[v].cMin = Math.min(freq[v].cMin, c);
      freq[v].cMax = Math.max(freq[v].cMax, c);
    }
  return freq;
}

function renderRegion(g, r0, r1, c0, c1) {
  const rows = [];
  for (let r = r0; r <= r1; r++)
    rows.push(g.slice(c0, c1 + 1).length > 0
      ? g[r].slice(c0, c1 + 1).map(v => v.toString(16)).join('')
      : '');
  return rows.join('\n');
}

// Log initial state
console.log("State:", initFrame.state, "Levels:", initFrame.levels_completed);
console.log("Available actions:", initFrame.available_actions);
const summary = gridSummary(initGrid);
console.log("Color summary:", JSON.stringify(summary));

// Probe each available action once, diff the results
let prevGrid = copyGrid(initGrid);
for (const action of initFrame.available_actions) {
  if (action === 6) continue; // skip click — needs coords, probe separately
  const result = await arc3.step(action);
  const newGrid = result.frame[0];
  const changes = diffFrames(prevGrid, newGrid);
  console.log(`Action ${action}: ${changes.length} pixel changes`);
  if (changes.length > 0 && changes.length <= 20) {
    console.log("  Changes:", JSON.stringify(changes));
  } else if (changes.length > 20) {
    console.log("  Sample:", JSON.stringify(changes.slice(0, 10)));
    // Categorize: which colors appeared/disappeared?
    const gained = {}, lost = {};
    for (const c of changes) {
      gained[c.now] = (gained[c.now] || 0) + 1;
      lost[c.was] = (lost[c.was] || 0) + 1;
    }
    console.log("  Colors gained:", JSON.stringify(gained));
    console.log("  Colors lost:", JSON.stringify(lost));
  }
  prevGrid = copyGrid(newGrid);
}

console.log("Actions taken so far:", arc3.actionCount);
console.log("Current state:", arc3.observe().state);
```

**Iteration 1 — Deeper analysis of what you learned:**

Look at the diffs from iteration 0. What moved? What's the background vs foreground? Where are the boundaries, panels, indicators? Render specific regions of interest at full resolution. Take a few more targeted actions to confirm your hypotheses about game mechanics.

**Iteration 2 — Formulate your strategy:**

By now you should understand:
- What the game board looks like (panels, play area, indicators)
- What each action does (moves something? toggles something? paints something?)
- What the goal probably is (move X to Y? paint a pattern? match a target?)

Write a plan in a comment, then start executing it.

#### Phase 2: Execute (iterations 3+)

Now write tight game loops. Each iteration should take many actions:

```javascript
let f = arc3.observe();
let grid = f.frame[0];
let levelAtStart = f.levels_completed;

// Execute your strategy in a loop
while (f.state === "NOT_FINISHED" && !arc3.completed) {
  grid = f.frame[0];

  // ... your game logic: analyze grid, decide action ...
  const action = decideNextAction(grid);

  const prev = copyGrid(grid);
  f = await arc3.step(action);
  const changes = diffFrames(prev, f.frame[0]);

  // Detect level transition
  if (f.levels_completed > levelAtStart) {
    console.log(`Level completed! Now on level ${f.levels_completed + 1}`);
    levelAtStart = f.levels_completed;
    // New level = new layout. Re-analyze the grid.
  }

  // Detect wall hit / no-op (very few pixel changes, typically just a progress bar)
  if (changes.length <= 4) {
    // Action had no meaningful effect — try a different direction
  }
}

if (arc3.completed) {
  const score = await arc3.getScore();
  console.log("Final score:", JSON.stringify(score));
  return(JSON.stringify(score));
}

console.log("Loop ended. State:", f.state, "Actions:", arc3.actionCount, "Levels:", f.levels_completed);
```

#### Phase 3: Adapt (ongoing)

Between execution iterations, check your progress:
- How many levels have you completed?
- Is your strategy working or are you stuck in a loop?
- Are you burning too many actions on one level?

If stuck on a level for more than ~50 actions with no progress, consider:
- Trying a completely different approach
- Delegating for a fresh perspective: `await rlm("Given this game state, what should I try next?", JSON.stringify({grid: renderRegion(grid, 0, 63, 0, 63), actions: arc3.actionCount, level: f.levels_completed}), { maxIterations: 3 })`
- Moving on (if the game allows) — completing easy levels is better than perfecting hard ones

### Key Rules

1. **Never call `arc3.start()` more than once.** It resets the entire game and invalidates all progress.

2. **Frame diff is your primary learning tool.** After every action, compare the new frame to the old one. If only 2-4 pixels changed (typically a progress bar), the action had no meaningful effect — the entity hit a wall or the action was invalid in context.

3. **Track `levels_completed`.** When it increases, a new level has started with a new layout. Re-analyze the frame — don't assume the same strategy applies.

4. **Take many actions per iteration.** You have ~50 iterations but games can require hundreds of actions. Write loops, not single actions.

5. **Completing levels inefficiently beats not completing them.** A score of 0.01 (completed but slow) is infinitely better than 0.0 (incomplete). Don't optimize prematurely — get through levels first.

6. **Return before timeout.** If you're in the last few iterations and the game isn't over, get the scorecard and return it anyway. Any partial score beats an empty timeout.
