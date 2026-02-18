# ARC-3 v2.2.0 Wrong Moves Analysis

**Run:** `arc3_openrouter_anthropic_claude-opus-4-6_2026-02-16T21-10-07-088Z.json`
**Score:** 17% (2/7 levels completed)
**Total actions:** 431 (L1=25, L2=214, L3=192)
**Replay:** https://three.arcprize.org/scorecards/24c0fd8e-d474-4cb6-b3cf-00262b6ca977
**Plugin:** `arc3-level-react.md` v2.2.0

## Executive Summary

The agent wastes the majority of its actions on Level 2 and Level 3 due to five interlocking failures:

1. **Broken player position tracking** -- the agent searches for ALL pixels of colors 12 and 9 across the maze instead of finding the dense 5x5 player cluster, causing it to report wildly wrong positions (e.g., "rows 40-48, cols 14-31" when the player is a 5x5 block at rows 45-49, cols 14-18).

2. **No wall-bump response** -- when an action produces 0 maze changes (wall collision), the agent does not alter its strategy. It repeats the same blocked direction in tight loops, burning 10-20 actions at a time.

3. **No fuel/death model** -- the agent doesn't understand that running out of fuel kills the player and respawns them. When death occurs, it misreads the respawn as "Player lost, fuel=768" and continues blindly.

4. **Repeated full-map traversals** -- across react agent invocations on L3, the same path (UP to row 5, RIGHT toward goal) is attempted three separate times, each time running out of fuel or hitting walls.

5. **Orchestrator over-retry** -- L2 takes 6 react agent invocations (214 actions) to complete a level whose baseline is 41 actions. The orchestrator does not skip ahead when a level becomes uneconomical.

## Per-Level Breakdown

### Level 1 (Root iter 1): 25 actions, COMPLETED, 100% efficient

Clean execution. Discovery phase (4 directional tests) followed by goal navigation. No wall bumps. The human baseline is 29 actions, so this was actually more efficient than human play.

### Level 2 (Root iters 2-8): 214 actions, COMPLETED, 19.2% efficient

Human baseline: 41 actions. The agent took 5.2x more actions than necessary.

| Root | Actions | Wall Bumps | Key Failure |
|------|---------|------------|-------------|
| 2 | 32 | 3 | Navigates into walls testing paths; wrong mental model of maze layout |
| 3 | 40 | 0 | Explores but doesn't find goal |
| 4 | 30 | 0 | "Exploration mode" -- collects items but doesn't know win condition |
| 5 | 50 | 0 | Moves player around but can't find goal, uses SPACE action (no effect) |
| 7 | 40 | 0 | Builds BFS pathfinding but still can't complete |
| 8 | 22 | 0 | **Finally completes** -- uses BFS reachability to find goal |

**Root cause for L2:** The agent doesn't understand the win condition (match pattern then reach goal). It spends 5 attempts wandering the maze and collecting items, not realizing it needs to match the Goal Icon GateKeeper pattern. Only on attempt 6 does it accidentally stumble into the goal.

### Level 3 (Root iters 9-13): 192 actions, NOT COMPLETED, GAME_OVER

| Root | Actions | Wall Bumps | Key Failure |
|------|---------|------------|-------------|
| 9 | 35 | 0 | Paths to collectible, reaches it, but doesn't complete |
| 10 | 40 | 0 | BFS navigation, runs out of budget 4 steps from goal |
| 11 | 50 | ~26 | **CATASTROPHIC** -- massive wall-bump loop (see below) |
| 12 | 50 | ~30* | Player position tracking breaks, every action wasted (see below) |
| 13 | 17 | 0 | Navigates toward goal but GAME_OVER (3 lives lost) |

*Root 12's wall bumps are masked by incorrect position reporting -- the player doesn't actually move for most actions but the tracking code reports changing positions.

## Detailed Failure Analysis

### Failure 1: Player Position Tracking Bug

**Severity: Critical. Causes ~80 wasted actions on L3.**

The react agent tracks player position by scanning for pixels of color 12 (cyan, player top) and color 9 (red, player bottom). The code in Root 12, iteration 6:

```javascript
// Find player 5x5 block (look for cluster of 12/9)
let pr = 0, pc = 0, cnt = 0;
for (let r = 0; r < 52; r++)
  for (let c = 0; c < 25; c++) // only look in left portion for actual player
    if (after[r][c] === 12 || after[r][c] === 9) { pr += r; pc += c; cnt++; }
const pPos = cnt > 0 ? `(${Math.round(pr/cnt)},${Math.round(pc/cnt)})` : 'check right';
```

**Problems:**
1. Color 9 appears in multiple places: the player (5x5), the Goal Icon GateKeeper (HUD bottom-left), and the goal box in the maze. Searching for ALL color 9 pixels returns a bounding box spanning most of the grid.
2. Even when the column range is restricted (`c < 25`), there are non-player color 9/12 pixels in that range.
3. On later iterations (Root 12 iter 12), the search widens to `c < 45`, picking up even more false positives. Result: `(40-48, 14-31)` -- a 30-pixel-wide "player" that never moves because every action just shifts the centroid of the false-positive set.

**Evidence of position tracking failure:**
```
ROOT 12, iter 6 output:
  UP 1: Player (42,16), fuel=36, completed=2
  UP 2: Player (42,16), fuel=34, completed=2  <-- same position, fuel changed
  UP 3: Player (42,16), fuel=32, completed=2  <-- same position, fuel changed
  RIGHT 1: Player (42,16), fuel=30, completed=2  <-- same position after RIGHT!
  RIGHT 2: Player (42,16), fuel=28, completed=2
  RIGHT 3: Player (42,16), fuel=26, completed=2
  DOWN 1: Player (47,16), fuel=24, completed=2  <-- moved 5px down? Or noise?
```

The fuel decreases (2 per action), confirming actions are being consumed, but the player position stays at (42,16) for UPs, RIGHTs, and DOWNs. The centroid of scattered color 12/9 pixels is approximately constant regardless of player movement because the non-player pixels dominate.

**Impact:** 9 actions in iter 6 alone produce no useful movement. The agent thinks it's navigating but the position data is garbage. This compounds across iters 8, 10, 12, 14 -- each time the agent executes a multi-step navigation plan, none of which can be validated because the position tracking is broken.

### Failure 2: Wall-Bump Perseveration

**Severity: Critical. Causes ~40 wasted actions on L3.**

When `diffGrids(before, after)` returns 0 maze changes, the agent is hitting a wall. The plugin's core loop template says to "observe -> diff -> update knowledge -> decide -> act" but the generated code runs actions in tight loops without checking after each step.

**Root 11, iter 3 -- 8 consecutive wall bumps:**
```
Action 4: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 2: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 2: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 4: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 4: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 2: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 2: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
Action 2: 0 maze changes. Player at ~(46,52). State: NOT_FINISHED
```

The agent was at (46,52) -- the bottom-right corner of the maze -- and tried RIGHT and DOWN repeatedly. Every action returned 0 changes. It did not try UP or LEFT.

**Root 11, iter 8 -- 5 RIGHT wall bumps after 7 UPs:**
```
RIGHT 1: block top-left (10,30), 0 changes. State: NOT_FINISHED
RIGHT 2: block top-left (10,30), 0 changes. State: NOT_FINISHED
RIGHT 3: block top-left (10,30), 0 changes. State: NOT_FINISHED
RIGHT 4: block top-left (10,30), 0 changes. State: NOT_FINISHED
RIGHT 5: block top-left (10,30), 0 changes. State: NOT_FINISHED
```

After successfully moving UP 7 times (reaching row 10), the agent tries RIGHT 5 times in a row, getting 0 changes each time. The wall at column 30 blocks rightward movement but the agent never tries an alternative.

**Root 11, iter 11 -- zigzag perseveration:**
```
RIGHT 1: 50 changes   (moved)
RIGHT 2: 0 changes    (blocked)
  DOWN: 0 changes     (blocked)
  UP: moved
RIGHT 3: 0 changes    (blocked again)
  DOWN: 50 changes    (moved back)
RIGHT 4: 0 changes    (blocked again)
  DOWN: 0 changes     (blocked)
  UP: moved
RIGHT 5: 0 changes    (blocked yet again)
```

The agent developed a "try RIGHT, if blocked try DOWN, if blocked try UP then RIGHT again" strategy. But this strategy loops because the wall extends both up and down from the player's position. The agent repeats this loop 3 times, burning 14 actions to make zero net progress.

### Failure 3: No Fuel/Death Model

**Severity: High. Causes 1 death + 27 wasted post-respawn actions.**

In Root 12:
- Iter 10: Player moves UP 5 times, RIGHT once. Fuel drops to 0.
- Iter 11: Next action ("RIGHT (0 fuel) 1") causes player death.
  - Output: `"Player lost, fuel=768, state=NOT_FINISHED, completed=2"`
  - The `fuel=768` is the total color 11 pixel count across the entire grid (including HUD bar refill), not actual fuel.
  - Player respawns at starting position (rows 45-49, cols 14-18) with refilled fuel (82).
- Iter 12: Agent correctly identifies respawn but then executes the exact same path (UP 8, RIGHT 4) that ran out of fuel last time.
- Iter 14: Same path again (LEFT, UP 7).
- Iter 15: UP 1 more, RIGHT 1. Budget exhausted.

**The agent traverses the same path from spawn to row 5 three times** (iters 10, 12, 14). Each time it depletes fuel without reaching the goal. It never considers:
- Finding a fuel refill on the way
- Choosing a shorter path
- That the goal might require pattern matching, not just reaching a location

### Failure 4: Stale Mental Model / Incorrect Maze Map

**Severity: High. Underlies failures 2 and 4.**

The agent builds a 13x13 cell map of the maze in iter 0 and uses it to plan paths. But the mapping between cell coordinates and pixel coordinates is fragile:

- Root 11, iter 0: `"Player: {"r":9,"c":6,"colors":[0,3,8,9,12,14]}"` -- the "player cell" contains 6 different colors because the 5x5 cell contains the player, a wall pixel, an item, and maze path. This is not a player cell; it's a cell that happens to contain part of the player.
- Root 11 also reports "Player 'P' at (7,9), (7,10), (9,6)" -- three different cells for a single entity, because the 5x5 player overlaps multiple 5x5 cells.

This confusion propagates: the BFS pathfinding operates on the cell map but the actual navigation uses pixel-level `arc3.step()` calls. The cell-to-pixel correspondence is never validated.

### Failure 5: Orchestrator Over-Retry on L2

**Severity: Medium. Causes 192 excess L2 actions.**

The orchestrator dispatches 6 react agents to L2 before it's completed. Each react agent gets a fresh iteration budget but no memory of what the previous agent's specific movements were. Knowledge transfer is limited to high-level mechanics ("player is 5x5, walls are color 4") which doesn't help with maze navigation.

Orchestrator reasoning at root 5: "Still stuck on level 2 after 3 attempts and 127 actions." Despite this awareness, it dispatches two more attempts. The breakthrough in root 8 (22 actions, completed) comes from a completely different strategy (BFS reachability) that could have been tried on attempt 1.

## Quantifying Waste

| Category | Wasted Actions | % of Total |
|----------|---------------|------------|
| Wall bumps (direct, 0 changes) | ~40 | 9% |
| Player tracking false (position wrong, actions wasted) | ~50 | 12% |
| Post-death repeated path (Root 12 iters 12-15) | ~27 | 6% |
| L2 excess retries (attempts 2-5) | ~152 | 35% |
| Productive actions (L1 + L2 attempt 6 + L3 actual navigation) | ~162 | 38% |

**Only 38% of all 431 actions produced meaningful progress.**

## Root Causes in the Plugin

### RC1: No `findPlayerBlock()` utility in the plugin template

The plugin provides `colorFreqs`, `findComponents`, `renderRegion`, and `diffGrids` but NOT a dedicated function to find the player's 5x5 block. Every react agent writes its own ad-hoc player detection code, and gets it wrong in different ways. The most common bug is searching for ALL pixels of colors 12/9 instead of finding the dense cluster.

**Fix:** Add a `findPlayerBlock(grid)` function to the plugin's perceptual toolkit:
```javascript
function findPlayerBlock(grid, playerColors = [12, 9]) {
  // Find all pixels of player colors in maze area (r < 52)
  const pixels = [];
  for (let r = 0; r < 52; r++)
    for (let c = 0; c < grid[0].length; c++)
      if (playerColors.includes(grid[r][c])) pixels.push([r, c]);

  // Cluster by proximity -- player is a 5x5 contiguous block
  // Use simple approach: find the densest 5x5 window
  let bestCount = 0, bestR = -1, bestC = -1;
  for (let r = 0; r < 52 - 4; r++) {
    for (let c = 0; c < grid[0].length - 4; c++) {
      let count = 0;
      for (let dr = 0; dr < 5; dr++)
        for (let dc = 0; dc < 5; dc++)
          if (playerColors.includes(grid[r + dr][c + dc])) count++;
      if (count > bestCount) { bestCount = count; bestR = r; bestC = c; }
    }
  }
  return bestCount >= 8 ? { r: bestR, c: bestC, size: bestCount } : null;
}
```

### RC2: No wall-bump guard in the action loop

The plugin's core loop template (`arc3.step(action) -> diff -> update`) does not include logic to detect and respond to failed movements. The agent writes its own action loops that don't check for 0-change results.

**Fix:** Add a `safeStep()` wrapper that detects wall bumps:
```javascript
async function safeStep(action, grid) {
  const result = await arc3.step(action);
  __actionsUsed++;
  const after = result.frame[0];
  const changes = diffGrids(grid, after).filter(c => c.r < 52);
  const moved = changes.length > 0;
  if (!moved) console.log(`WARNING: Action ${action} blocked (wall). 0 maze changes.`);
  return { result, after, moved, changes: changes.length };
}
```

And add behavioral guidance: "If an action produces 0 maze changes, you hit a wall. Do NOT repeat the same action. Try a different direction or reassess your path."

### RC3: No fuel tracking in the perceptual toolkit

The agent has no reliable way to track fuel. Different react agents use different heuristics: counting color 11 pixels in HUD rows, total color 11 in the grid, etc. When fuel hits 0 the agent dies and respawns without understanding what happened.

**Fix:** Add a `readFuel(grid)` utility that counts color 11 pixels in the HUD bar region (rows 61-62, cols 13-54) and expose fuel as a tracked state variable. Add to behavioral priorities: "Track fuel. If fuel < 10, prioritize finding a fuel refill (yellow box). Running out of fuel kills you."

### RC4: No action-efficiency awareness

The plugin mentions "balance exploration with exploitation" but provides no mechanism for the agent to evaluate whether it's making progress. The agent can't tell that burning 50 actions with no level completion is a signal to try a fundamentally different approach.

**Fix:** Add a `progressCheck()` at every N actions:
```javascript
// Every 10 actions, check if you've made progress
if (__actionsUsed % 10 === 0) {
  const frame = arc3.observe();
  if (frame.levels_completed <= __startLevel) {
    console.log(`WARNING: ${__actionsUsed} actions used, no level completion. Reassess strategy.`);
  }
}
```

### RC5: No across-invocation strategy memory

When the orchestrator dispatches a new react agent to the same level, the new agent gets high-level mechanics ("player is 5x5") but not the specific failure history ("RIGHT at row 10 is blocked by a wall at column 30"). This causes repeated traversals of the same dead-end paths.

**Fix:** The orchestrator's knowledge curation should include spatial/navigation failures:
- "Wall blocks rightward movement from (10,30)"
- "Full UP traverse from (45,14) to (5,14) costs 8 actions and 16 fuel"
- "Fuel ran out at (5,15) -- path is too long without refuel"

## Proposed Changes (Priority Order)

1. **Add `findPlayerBlock()` to plugin toolkit** -- eliminates position tracking bugs (saves ~50 actions/run).

2. **Add wall-bump detection to `safeStep()` wrapper** -- the plugin should provide a step wrapper that checks diffGrids and warns on 0 changes. Add "never repeat a blocked direction" as a hard rule (saves ~40 actions/run).

3. **Add fuel tracking** -- `readFuel(grid)` in the toolkit, plus a behavioral rule to seek refuels when low (prevents death, saves ~27 actions/run).

4. **Cap per-level action budget in orchestrator** -- if a level has used 3x the baseline actions, stop retrying and move to the next level (saves ~150 actions on L2-type situations).

5. **Include failure-specific spatial knowledge in orchestrator handoffs** -- "wall at (r,c) blocks direction X", "path from A to B costs N actions and M fuel" (saves repeated dead-end traversals).

6. **Add progress watchdog** -- if the last 10 actions produced no level completion and player position hasn't meaningfully changed, force strategy reassessment (catches perseveration loops early).
