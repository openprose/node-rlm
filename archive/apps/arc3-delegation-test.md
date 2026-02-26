---
name: arc3-delegation-test
kind: app
version: 0.8.0
description: ARC-3 delegation experiment -- adaptive navigation order (rect-first when marker far), respawn timer measurement, bidirectional round-trip search
author: sl
tags: [arc, arc3, delegation, experiment]
requires: []
---

## ARC-3 Delegation Test

**YOUR #1 JOB IS TO CALL `return()`.** Everything else is secondary. A partial result scores points. No result scores zero.

You are running a **delegation experiment**. Your goal is to solve an ARC-3 game by delegating exploration to a scout, then navigating efficiently using BFS pathfinding. On level transitions, re-delegate scouting to map the changed maze.

The `arc3` sandbox API is documented in your Environment section.

### The Return Protocol

**Every single code block you write MUST start with this guard:**

```javascript
// === RETURN GUARD (MANDATORY — COPY THIS VERBATIM) ===
if (typeof __iter === 'undefined') __iter = 0;
__iter++;
console.log(`--- Iteration ${__iter} of ~30 ---`);

// Check 1: Near iteration limit → MUST return NOW
if (__iter >= 25) {
  console.log("APPROACHING LIMIT — RETURNING SCORE NOW");
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}

// Check 2: Game finished → return score
const __f = arc3.observe();
if (__f && (__f.state === "WIN" || __f.state === "GAME_OVER")) {
  console.log("GAME ENDED — RETURNING SCORE");
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}

// Check 3: Fuel critically low (< 6 = 3 moves left)
let __fuel = 0;
const __fg = __f.frame[0];
for (let r = 0; r < 64; r++)
  for (let c = 0; c < 64; c++)
    if (__fg[r][c] === 11) __fuel++;
if (__fuel < 6) {
  console.log(`FUEL CRITICAL (${__fuel}px) — RETURNING SCORE NOW`);
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}

// Check 4: All-fuel transition frame (grid entirely color 11 after level change)
if (__fuel > 200) {
  console.log(`ALL-FUEL FRAME (${__fuel}px). Executing action to advance past transition...`);
  await arc3.step(1);
  // Don't do anything else this iteration — let the next iteration see the real grid
}
console.log(`Fuel: ${__fuel}px (~${Math.floor(__fuel/2)} moves)`);
// === END RETURN GUARD ===
```

This guard goes ABOVE all other code. **Paste it verbatim at the top of every code block you write.** Do not skip it. Do not modify it. Every code block. Every time. No exceptions. The strategy steps below show `// [paste full return guard]` as a placeholder — always expand it to the full guard above.

### Variable Persistence Warning

**Variables and functions do NOT persist across iterations.** The sandbox resets between code blocks. This means:
- `scoutReport` from an `rlm()` call will NOT be available in the next iteration
- Helper functions must be redefined every iteration

**Workaround:** Print critical data (scout report, positions, BFS paths) to the console — the console output is visible in your conversation history even though variables are lost.

**Helper template (copy into every code block after the return guard):**

```javascript
// === HELPERS (must redefine each iteration — variables don't persist) ===
function getEntityPosition(g, color) {
  let rMin = 64, rMax = 0, cMin = 64, cMax = 0;
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === color) {
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      }
  return rMin <= rMax ? { rMin, rMax, cMin, cMax, rMid: (rMin + rMax) / 2, cMid: (cMin + cMax) / 2 } : null;
}

function findMarker(g) {
  // Colors 0 and 1 appear as the marker AND as rectangle borders.
  // Use clustering: find connected groups, return the smallest one (the marker).
  const pixels = [];
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === 0 || g[r][c] === 1) pixels.push([r, c]);
  if (pixels.length === 0) return null;
  // Simple clustering: group pixels within 3px of each other
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < pixels.length; i++) {
    if (used.has(i)) continue;
    const cluster = [pixels[i]];
    used.add(i);
    for (let j = 0; j < cluster.length; j++) {
      for (let k = 0; k < pixels.length; k++) {
        if (used.has(k)) continue;
        if (Math.abs(cluster[j][0] - pixels[k][0]) <= 3 &&
            Math.abs(cluster[j][1] - pixels[k][1]) <= 3) {
          cluster.push(pixels[k]);
          used.add(k);
        }
      }
    }
    clusters.push(cluster);
  }
  // The marker is the smallest cluster (typically 4-5 pixels).
  // Rectangle borders are large clusters (20+ pixels).
  clusters.sort((a, b) => a.length - b.length);
  const marker = clusters[0];
  if (marker.length > 15) return null; // all clusters are large = no marker (absorbed)
  const avgR = marker.reduce((s, p) => s + p[0], 0) / marker.length;
  const avgC = marker.reduce((s, p) => s + p[1], 0) / marker.length;
  return { row: Math.round(avgR), col: Math.round(avgC), count: marker.length };
}

function countColor(g, color) {
  let n = 0;
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === color) n++;
  return n;
}

// === BFS PATHFINDING ===
// Finds shortest path for the entity (2 rows x 5 cols, moves in 5-pixel steps).
// walkable: Set of colors the entity can traverse.
// Returns array of actions [1=UP, 2=DOWN, 3=LEFT, 4=RIGHT] or null if no path.
function bfsPath(grid, startR, startC, goalR, goalC, walkable) {
  const STEP = 5, EH = 2, EW = 5;
  function isValid(r, c) {
    if (r < 0 || r + EH > 64 || c < 0 || c + EW > 64) return false;
    for (let dr = 0; dr < EH; dr++)
      for (let dc = 0; dc < EW; dc++)
        if (!walkable.has(grid[r + dr][c + dc])) return false;
    return true;
  }
  const visited = new Set();
  visited.add(`${startR},${startC}`);
  const queue = [{ r: startR, c: startC, path: [] }];
  const dirs = [[1, -STEP, 0], [2, STEP, 0], [3, 0, -STEP], [4, 0, STEP]];
  while (queue.length > 0) {
    const { r, c, path } = queue.shift();
    for (const [action, dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      const atGoal = nr === goalR && nc === goalC;
      if (!isValid(nr, nc) && !atGoal) continue;  // atGoal overrides walkability (entering rect triggers level complete)
      visited.add(key);
      const newPath = [...path, action];
      if (atGoal) return newPath;
      queue.push({ r: nr, c: nc, path: newPath });
    }
  }
  return null; // No path exists
}

function getWalkable() {
  // Colors the entity can walk through.
  // 3=path, 12=self, 11=fuel, 0=marker/activated border, 1=marker, 9=rect interior, 5=rect border
  return new Set([3, 12, 11, 0, 1, 9, 5]);
}

// === RECTANGLE ENTRY PLANNER ===
// Tries BFS to multiple entry points around a rectangle.
// Returns the shortest path, or null if none found.
function planRectangleEntry(grid, entityR, entityC, rectRMin, rectRMax, rectCMin, rectCMax, walkable) {
  const entryPoints = [];
  // Try entry from above (one step above top edge)
  for (let c = rectCMin; c <= rectCMax - 4; c += 5)
    entryPoints.push({ r: rectRMin, c, dir: "above" });
  // Try entry from below (one step below bottom edge)
  for (let c = rectCMin; c <= rectCMax - 4; c += 5)
    entryPoints.push({ r: rectRMax - 1, c, dir: "below" });
  // Try entry from left
  for (let r = rectRMin; r <= rectRMax - 1; r += 5)
    entryPoints.push({ r, c: rectCMin, dir: "left" });
  // Try entry from right
  for (let r = rectRMin; r <= rectRMax - 1; r += 5)
    entryPoints.push({ r, c: rectCMax - 4, dir: "right" });

  let bestPath = null, bestEntry = null;
  for (const entry of entryPoints) {
    const path = bfsPath(grid, entityR, entityC, entry.r, entry.c, walkable);
    if (path && (!bestPath || path.length < bestPath.length)) {
      bestPath = path;
      bestEntry = entry;
    }
  }
  if (bestPath) console.log(`Best rect entry: ${bestEntry.dir} at [${bestEntry.r},${bestEntry.c}], ${bestPath.length} steps`);
  return bestPath;
}

// === BIDIRECTIONAL ROUND-TRIP SEARCH ===
// For each rectangle entry point, compute BFS from marker to that entry (the "return path").
// Returns the entry point with the shortest return path from the marker, plus all computed data.
// This tells us: if we absorb the marker, what's the fastest way back to a rect entry?
function findBestAbsorptionPoint(grid, markerR, markerC, rectRMin, rectRMax, rectCMin, rectCMax, walkable) {
  const entryPoints = [];
  for (let c = rectCMin; c <= rectCMax - 4; c += 5)
    entryPoints.push({ r: rectRMin, c, dir: "above" });
  for (let c = rectCMin; c <= rectCMax - 4; c += 5)
    entryPoints.push({ r: rectRMax - 1, c, dir: "below" });
  for (let r = rectRMin; r <= rectRMax - 1; r += 5)
    entryPoints.push({ r, c: rectCMin, dir: "left" });
  for (let r = rectRMin; r <= rectRMax - 1; r += 5)
    entryPoints.push({ r, c: rectCMax - 4, dir: "right" });

  let bestEntry = null, bestReturn = null, bestToMarker = null;
  for (const entry of entryPoints) {
    const returnPath = bfsPath(grid, markerR, markerC, entry.r, entry.c, walkable);
    if (!returnPath) continue;
    const toMarker = bfsPath(grid, entry.r, entry.c, markerR, markerC, walkable);
    console.log(`  Entry [${entry.r},${entry.c}] (${entry.dir}): return=${returnPath.length} steps, toMarker=${toMarker ? toMarker.length : 'none'}`);
    if (!bestReturn || returnPath.length < bestReturn.length) {
      bestEntry = entry;
      bestReturn = returnPath;
      bestToMarker = toMarker;
    }
  }
  if (bestEntry) {
    console.log(`BEST round-trip entry: ${bestEntry.dir} at [${bestEntry.r},${bestEntry.c}], return=${bestReturn.length} steps`);
  }
  return { entry: bestEntry, returnPath: bestReturn, toMarkerPath: bestToMarker };
}
// === END HELPERS ===
```

### Level Completion Mechanism (CRITICAL — discovered from prior runs)

The game follows a two-step level completion pattern:

1. **Absorb the marker:** Navigate the entity (color 12) to the color 0/1 marker cluster. On contact, the marker disappears and the two rectangles activate (their borders change color).

2. **Enter the target rectangle:** After marker absorption, navigate the entity into the target rectangle. On Level 1, this is Rect 1 at approximately r9-15 c33-39, entered from above (via the c34-38 corridor going UP). On Level 2+, the rectangle positions change — use `getEntityPosition()` and BFS to compute the route.

**CRITICAL for Level 1:** Approach Rect 1 from ABOVE (via the c34-38 corridor going UP). Approaching from below (r15-16) will NOT work — the color 5 interior blocks entry. After absorbing the marker, navigate to c34-38 alignment, then UP repeatedly until `levels_completed` increases.

**For Level 2+:** Do NOT assume the same rectangle positions or corridor layout. Use BFS pathfinding to compute the route from your position to the target rectangle. The maze changes completely on level transitions.

**Marker respawning:** After absorbing the marker, the marker respawns after some number of actions (~10-19, exact threshold unknown). You must enter the target rectangle BEFORE it respawns. **Use `findBestAbsorptionPoint()` to choose the rect entry point with the shortest return path from the marker.** If the best return path is ≤10 steps: use marker-first strategy. If >10 steps: use rect-first strategy (navigate near the rect first, then go get the marker, sprint back). **ALWAYS measure the respawn timer** — after absorption, check for marker reappearance after each action and log the exact count.

### Teleport/Portal Mechanics

The maze contains portal/teleport mechanics:

1. **Boundary wrapping:** Moving past the grid edge (row 63 or col 63) may wrap the entity to the opposite side (row 0 or col 0). Coordinates will jump from ~60s to ~0s.

2. **In-maze portals:** Certain positions teleport the entity to a distant location. Moving UP from inside Rect 1 after Level 1 completion has teleported the entity to r35-36 c29-33.

**After ANY movement, check your position.** If the entity's coordinates jump by more than 5 pixels (one step), a teleport occurred. Re-map your position and re-plan your route. Do NOT assume the old route is still valid.

### BFS Pathfinding (ALWAYS use this — never navigate heuristically)

Before moving, ALWAYS compute the shortest path:

1. Get current grid: `const grid = arc3.observe().frame[0]`
2. Get entity position: `const pos = getEntityPosition(grid, 12)`
3. Get target position (marker or rectangle entry point)
4. Compute path: `const path = bfsPath(grid, pos.rMin, pos.cMin, targetR, targetC, getWalkable())`
5. If `path === null`: there is NO navigable route. Do NOT try heuristic navigation. Instead, re-scout or try a different target entry point.
6. If path exists: execute the actions in order, checking position after each step.

**This replaces the heuristic try-and-backtrack approach.** Heuristic navigation has burned 50 blocked moves on Level 2 with zero progress. BFS computes the path (or confirms none exists) in zero game actions.

### Available Child Apps

- `arc3-scout` -- Returns structured JSON with exact positions, resource state, and testable claims. Budget: 10 iterations, ~15 game actions.

### Critical Rules

1. **Call `return()` by iteration 25.** Non-negotiable. Partial credit is infinitely better than 0%.
2. **The sandbox is shared.** After the scout returns, `arc3` still has the active game. Never call `arc3.start()` again.
3. **Navigate with BFS, not heuristics.** ALWAYS compute `bfsPath()` before moving. Never try random directions hoping to find a route.
4. **Re-scout on level completion.** When `levels_completed` increases, the maze changes. Spawn a fresh scout to map the new layout before navigating.
5. **Plan routes before moving.** Compute BFS to marker, then BFS from marker to rectangle. Only absorb the marker when the rect route is confirmed.
6. **Map 1 iteration, then navigate.** Spend at most 1 iteration scanning the grid after the scout report, then start BFS-guided navigation immediately.
7. **Fuel budgeting.** You start with 84 fuel (42 moves). Budget: ~7 for scout, ~12 for level 1, ~20 for level 2. The maze may contain fuel refueling stations — when fuel increases by >4 pixels between actions, log the entity's position (that's a fuel station).
8. **MANDATORY delegation for Level 2+.** After completing Level 1, you MUST delegate scouting to the `arc3-scout` child (Step 4) before navigating Level 2. Do NOT attempt to self-navigate a new level. The maze layout changes completely on level transitions, and heuristic navigation wastes too many actions. You can self-navigate Level 1 (simple maze), but Level 2+ requires a scout report + BFS pathfinding before any movement. Skipping delegation on Level 2 has resulted in 106 wasted actions and zero progress.
9. **Blocked-move detection.** If you get blocked 3+ times in the same area, STOP moving immediately. Re-compute BFS from current position. If BFS returns null (no path), delegate a re-scout or try a different target entry point. Never burn more than 6 actions on blocked moves — that is 12 fuel wasted for zero progress.
10. **Fuel refueling.** The maze contains fuel pickup locations. When fuel increases by more than 4 pixels between actions, log the entity's position — that is a fuel station. Plan routes through known fuel stations when fuel is low.
11. **Fresh grid before BFS.** NEVER execute a BFS path computed on a previous iteration's grid. Always call `arc3.observe()` immediately before `bfsPath()` and use THAT grid. Level transitions change the maze completely — a path valid on the old grid is 100% invalid on the new grid. Executing a stale BFS path has wasted 7 actions (14 fuel) with zero progress.
12. **Entity position verification after level transition.** After `levels_completed` increases, the entity teleports to a new position on a new maze. Before ANY navigation, call `arc3.observe()`, find the entity with `getEntityPosition()`, and verify the entity exists. If entity is null, execute one action to advance past a transition frame, then re-observe.
13. **Measure marker respawn timer.** After absorbing the marker, count every action until the marker reappears (check with `findMarker()` after each `arc3.step()`). Log: `MARKER RESPAWNED after N post-absorption actions`. This measurement is CRITICAL for planning — it determines the maximum return path length.
14. **Adaptive navigation order (MANDATORY for Level 2+).** Before absorbing the marker, compute `findBestAbsorptionPoint()` to find the rect entry with the shortest return path from marker. If `returnPath.length <= 10`: marker-first (go to marker, absorb, sprint to rect). If `returnPath.length > 10`: rect-first (go to rect entry, then to marker, absorb, sprint back). **Tested: marker-first with a 19-step return path caused the marker to respawn and Level 2 was lost.** The rect-first strategy positions the entity closer to the rect before absorbing.

### Strategy

#### Step 1: Delegate Initial Scouting

```javascript
// === RETURN GUARD (MANDATORY — paste full guard from "The Return Protocol" above) ===

console.log("Delegating game scouting to child agent...");
const scoutReport = await rlm(
  "Explore this ARC-3 game. Discover the mechanics, identify the controlled entity " +
  "(exact color and bounding box), measure any resource depletion (fuel meters), " +
  "map the maze corridors, and return a precise JSON report. " +
  "Stay within 15 game actions -- the parent needs the remaining budget.",
  undefined,
  {
    app: "arc3-scout",
    model: "orchestrator",
    maxIterations: 10,
  }
);
// IMPORTANT: Print the full report so it's visible in conversation history
// (variables do NOT persist to the next iteration)
console.log("=== SCOUT REPORT START ===");
console.log(typeof scoutReport === "string" ? scoutReport.substring(0, 3000) : JSON.stringify(scoutReport).substring(0, 3000));
console.log("=== SCOUT REPORT END ===");
```

#### Step 2: BFS Navigate to Marker

**Variables from Step 1 are LOST.** Re-read the scout report from your conversation history output. Redefine all helper functions. Use BFS to compute the path to the marker, then execute it.

**CRITICAL (Rule #11): Always get a FRESH grid before BFS.** Never reuse a grid from a previous iteration.

```javascript
// === RETURN GUARD (MANDATORY) ===
// [paste full return guard including all-fuel handler]
// === HELPERS (must redefine — variables don't persist) ===
// [paste full helper template including BFS, planRectangleEntry, getWalkable]

// FRESH grid observation (Rule #11)
const grid = arc3.observe().frame[0];
let pos = getEntityPosition(grid, 12);
if (!pos) {
  console.log("Entity NOT FOUND — transition frame? Executing action to advance...");
  await arc3.step(1);
  // Stop this iteration — re-observe on next
}
let marker = findMarker(grid);
console.log("Entity:", JSON.stringify(pos));
console.log("Marker:", JSON.stringify(marker));
console.log("Levels:", arc3.observe().levels_completed, "Actions:", arc3.actionCount);

if (!marker) {
  console.log("No marker found — may already be absorbed. Skip to Step 3b.");
} else {
  // Compute BFS path from entity to marker
  const pathToMarker = bfsPath(grid, pos.rMin, pos.cMin, marker.row, marker.col, getWalkable());
  console.log("BFS to marker:", pathToMarker ? `${pathToMarker.length} steps: [${pathToMarker.join(',')}]` : "NO PATH");

  if (!pathToMarker) {
    console.log("BFS found no path to marker. Need to re-scout or try different approach.");
  } else {
    // Execute the BFS path
    let blockedCount = 0;
    let prevLevels = arc3.observe().levels_completed;
    for (let i = 0; i < pathToMarker.length && blockedCount < 3; i++) {
      const prevPos = getEntityPosition(arc3.observe().frame[0], 12);
      const result = await arc3.step(pathToMarker[i]);
      const newPos = getEntityPosition(result.frame[0], 12);

      // Teleport detection
      if (Math.abs(newPos.rMid - prevPos.rMid) > 7 || Math.abs(newPos.cMid - prevPos.cMid) > 7) {
        console.log(`TELEPORT at step ${i}: [${prevPos.rMin},${prevPos.cMin}] -> [${newPos.rMin},${newPos.cMin}]`);
        console.log("Re-computing BFS from new position...");
        break;
      }

      // Blocked detection
      if (newPos.rMid === prevPos.rMid && newPos.cMid === prevPos.cMid) {
        blockedCount++;
        console.log(`BLOCKED (${blockedCount}/3) at step ${i}`);
        if (blockedCount >= 3) {
          console.log("TOO MANY BLOCKED MOVES. Re-computing BFS from current position.");
          break;
        }
        continue;
      }

      // Check for marker absorption
      const curMarker = findMarker(result.frame[0]);
      if (!curMarker) {
        console.log(`MARKER ABSORBED at step ${i}! Entity@[${newPos.rMin}-${newPos.rMax}, ${newPos.cMin}-${newPos.cMax}]`);
        break;
      }

      if (result.levels_completed > prevLevels) {
        console.log("LEVEL COMPLETED!");
        if (result.state === "WIN") {
          const score = await arc3.getScore();
          return(JSON.stringify(score));
        }
        break;
      }

      if (i % 3 === 0) console.log(`Step ${i}/${pathToMarker.length}: entity@[${newPos.rMin}-${newPos.rMax}, ${newPos.cMin}-${newPos.cMax}]`);
    }
  }
}
console.log("Actions used:", arc3.actionCount);
```

#### Step 3: Adaptive Navigate — Marker + Rectangle (Level Completion)

**CRITICAL (Rule #14):** Before absorbing the marker, compute `findBestAbsorptionPoint()` to determine the best navigation order.

```javascript
// === RETURN GUARD (MANDATORY) ===
// [paste return guard]
// === HELPERS (redefine ALL including BFS, planRectangleEntry, findBestAbsorptionPoint) ===

// FRESH grid observation (Rule #11)
const grid = arc3.observe().frame[0];
const pos = getEntityPosition(grid, 12);
const marker = findMarker(grid);
const rect5 = getEntityPosition(grid, 5);
const walkable = getWalkable();
let prevLevels = arc3.observe().levels_completed;

console.log("Entity:", JSON.stringify(pos));
console.log("Marker:", JSON.stringify(marker));
console.log("Rect:", JSON.stringify(rect5));

if (!marker) {
  console.log("No marker — already absorbed. Navigate to rect directly.");
  // Use planRectangleEntry and execute path to rect (see Step 3 from v0.7.0)
}

if (!rect5) {
  console.log("No rect found. Re-scout needed.");
}

// === ADAPTIVE STRATEGY (Rule #14) ===
console.log("--- Computing round-trip paths ---");
const roundTrip = findBestAbsorptionPoint(grid, marker.row, marker.col,
  rect5.rMin, rect5.rMax, rect5.cMin, rect5.cMax, walkable);

if (!roundTrip.entry) {
  console.log("NO round-trip path found to any rect entry. Try re-scouting.");
} else if (roundTrip.returnPath.length <= 10) {
  // === MARKER-FIRST STRATEGY ===
  console.log(`STRATEGY: MARKER-FIRST (return=${roundTrip.returnPath.length} steps, safe)`);
  // 1. Navigate entity → marker
  const pathToMarker = bfsPath(grid, pos.rMin, pos.cMin, marker.row, marker.col, walkable);
  console.log("BFS to marker:", pathToMarker ? `${pathToMarker.length} steps` : "NO PATH");
  // Execute pathToMarker, then absorb, then execute roundTrip.returnPath to rect
  // ... (execute navigation loop with blocked-move detection, teleport detection)
  // After marker absorption, immediately execute roundTrip.returnPath
} else {
  // === RECT-FIRST STRATEGY ===
  console.log(`STRATEGY: RECT-FIRST (return=${roundTrip.returnPath.length} steps, TOO LONG for marker-first)`);
  // 1. Navigate entity → best rect entry point
  const pathToEntry = bfsPath(grid, pos.rMin, pos.cMin, roundTrip.entry.r, roundTrip.entry.c, walkable);
  console.log("BFS to rect entry:", pathToEntry ? `${pathToEntry.length} steps` : "NO PATH");
  // 2. Navigate rect entry → marker (use roundTrip.toMarkerPath)
  console.log("BFS rect entry → marker:", roundTrip.toMarkerPath ? `${roundTrip.toMarkerPath.length} steps` : "NO PATH");
  // 3. Absorb marker
  // 4. Sprint return path back to rect entry (roundTrip.returnPath)
  console.log("Return sprint:", roundTrip.returnPath.length, "steps");
  // Execute all three segments with respawn timer measurement (Rule #13)
}

console.log("Actions used:", arc3.actionCount, "Levels:", arc3.observe().levels_completed);
```

#### Step 4: On Level Completion — Re-Scout (MANDATORY for Level 2+)

**THIS STEP IS NOT OPTIONAL.** When `levels_completed` increases, you MUST execute Step 4 before attempting any navigation. Skipping delegation on Level 2 has resulted in 106 wasted actions and zero progress. The scout plugin has a re-scout mode that uses at most 5 game actions.

```javascript
// === RETURN GUARD (MANDATORY) ===
// [paste return guard]

// After level completion, re-scout the changed maze
console.log("Level completed! MANDATORY re-scouting new layout...");
const newScoutReport = await rlm(
  "The game just completed a level and the maze has COMPLETELY CHANGED. " +
  "IMPORTANT: Do NOT call arc3.start(). The game is already running. " +
  "CRITICAL: The entity has TELEPORTED to a new position on a new maze. " +
  "You MUST call arc3.step(1) FIRST (1 action) to verify the maze is active " +
  "and get the entity's REAL position — do NOT trust arc3.observe() alone, " +
  "it may show the old level's completion position. Then re-observe. " +
  "Mechanics are already known: entity=color 12 (2x5 block, moves 5px/step), " +
  "fuel=color 11 (-2px/action). Do NOT re-probe mechanics. " +
  "Focus ONLY on: (1) VERIFIED entity position after step, " +
  "(2) new marker position (colors 0/1, small cluster — ignore large rectangle borders), " +
  "(3) both rectangle positions (color 5 borders), " +
  "(4) corridor connections — which 5-column bands have continuous vertical paths, " +
  "which rows have continuous horizontal paths. " +
  "Use at most 5 game actions (observe is free). Return precise JSON.",
  undefined,
  {
    app: "arc3-scout",
    model: "orchestrator",
    maxIterations: 8,
  }
);
// Print full report (variables won't persist)
console.log("=== RE-SCOUT REPORT START ===");
console.log(typeof newScoutReport === "string" ? newScoutReport.substring(0, 3000) : JSON.stringify(newScoutReport).substring(0, 3000));
console.log("=== RE-SCOUT REPORT END ===");
// After re-scouting, repeat: BFS to marker (Step 2), BFS to rectangle (Step 3)
```

### Multi-Level Loop (Level 2+)

After completing each level, repeat this cycle:

1. **Re-scout** (Step 4): MANDATORY. Delegate to `arc3-scout` to map the new maze. Budget: 1-2 iterations, 5 actions.

2. **Compute ALL paths and choose navigation order:**

```javascript
// After re-scout, compute bidirectional paths
const grid = arc3.observe().frame[0];
const pos = getEntityPosition(grid, 12);
const marker = findMarker(grid);
const rect5 = getEntityPosition(grid, 5);
const walkable = getWalkable();

// Find best round-trip: marker <-> rect entry
const roundTrip = findBestAbsorptionPoint(grid, marker.row, marker.col,
  rect5.rMin, rect5.rMax, rect5.cMin, rect5.cMax, walkable);

if (roundTrip.returnPath && roundTrip.returnPath.length <= 10) {
  // MARKER-FIRST: return path is short enough. Absorb marker, sprint to rect.
  console.log(`STRATEGY: marker-first (return=${roundTrip.returnPath.length} steps, safe)`);
  // Navigate: entity -> marker -> absorb -> rect entry
} else {
  // RECT-FIRST: return path too long. Navigate to rect area first,
  // then go get marker, absorb, sprint back.
  console.log(`STRATEGY: rect-first (return=${roundTrip.returnPath?.length ?? 'none'} steps, TOO LONG)`);
  // Navigate: entity -> rect entry -> marker -> absorb -> sprint back to rect entry
}
```

3. **Execute the chosen strategy:**

   **If MARKER-FIRST** (return path ≤ 10):
   - BFS navigate entity → marker. Absorb.
   - Sprint the pre-computed return path to rect entry.
   - Level should complete.

   **If RECT-FIRST** (return path > 10):
   - BFS navigate entity → best rect entry point (from `findBestAbsorptionPoint`).
   - BFS navigate rect entry → marker (use `toMarkerPath`). Absorb.
   - Sprint the return path back to rect entry.
   - The return path is the SAME distance as before, BUT now we are executing it immediately after absorption with no wasted moves.
   - **KEY INSIGHT:** The total trip is longer (entity→rect→marker→rect) but the critical segment (marker→rect) is minimized because we chose the entry point with the shortest return.

4. **Marker respawn measurement:** After absorbing the marker, count every action. When the marker reappears, log: `MARKER RESPAWNED after N post-absorption actions`. This data informs future strategy decisions.

5. **Level complete**: Return to step 1.

**Budget per level:** ~2 iterations scout/plan, ~3-5 iterations navigate. At ~5-7 iterations per level and 25 usable iterations, expect to complete 3-4 levels per run.

#### Step 5: Return Results

**If you reach this step, return NOW.**

```javascript
// === RETURN GUARD (MANDATORY — paste full guard from "The Return Protocol" above) ===

const score = await arc3.getScore();
console.log("Returning score:", JSON.stringify(score));
return(JSON.stringify(score));
```

### Reminders

- **Iteration tracking:** `__iter` persists via the sandbox. At `__iter >= 25`, you MUST return. No exceptions.
- **Variable persistence:** ONLY `__iter` persists. Redefine helpers every time. Read scout data from console output.
- **`return()` format:** Always `return(JSON.stringify(await arc3.getScore()))`.
- **Level 1 pattern:** Absorb marker → navigate to c34-38 → go UP into Rect 1 from above.
- **Level 2+ pattern:** Re-scout (MANDATORY) → compute `findBestAbsorptionPoint()` → choose marker-first or rect-first → navigate → absorb → sprint to rect. Do NOT skip the re-scout.
- **Adaptive order (MANDATORY for L2+):** If best return path ≤10 steps: marker-first. If >10: rect-first (go to rect entry, then marker, absorb, sprint back). Tested: marker-first with 19-step return = Level 2 lost.
- **BFS always:** Never navigate without computing BFS first. Zero game actions to compute. Eliminates blocked moves.
- **Fuel stations:** When fuel increases by >4px between actions, log the position. Plan routes through fuel stations on later levels.
- **Teleport detection:** After each move, verify entity position. If jump > 5px, a teleport occurred — re-plan route.
- **Respawn measurement:** After absorbing marker, check `findMarker()` after EVERY action. When marker reappears, log exact count. This determines the respawn window for future levels.
