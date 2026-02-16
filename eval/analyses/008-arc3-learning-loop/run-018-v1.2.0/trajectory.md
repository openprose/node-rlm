# Run 018 -- ARC-3 v1.2.0 Learning-Loop Trajectory (FAIL)

| Field | Value |
|---|---|
| **Score** | 0.0% (0/7 levels) |
| **Iterations** | 30 / 30 (max) |
| **Wall Time** | 20m 11s (1,210,662 ms) |
| **Cost** | ~$4.49 |
| **Model** | anthropic/claude-opus-4-6 |
| **Version** | v1.2.0 |
| **Config** | maxIterations=30, maxDepth=2, concurrency=5 |
| **Task ID** | arc3-ls20-cb3b57cc |
| **Scorecard** | [441f9dde-a78f-4de7-a54c-73e92df3cf8f](https://three.arcprize.org/scorecards/441f9dde-a78f-4de7-a54c-73e92df3cf8f) |
| **Tokens** | 5.06M input, 186K output |

**Result**: Total failure. The orchestrator delegated three times to child agents using `app: "arc3-player"` with `__level_task`/`__level_result`. All three children timed out without returning. The orchestrator then violated the P1 rule ("never call arc3.step()") by calling `arc3.step()` directly for the remaining 18 iterations. Despite this, the orchestrator made significant game-understanding progress -- discovering the sliding-block mechanics, mapping the maze walls, and developing a multi-step navigation strategy. The game ended in GAME_OVER (action budget exhausted) at 138 actions with 0 levels completed.

---

## v1.2.0 Compliance Audit

| Rule | Expected | Actual | Verdict |
|---|---|---|---|
| **P0**: Self-calibrating deadline guard (`if (typeof __iterCount === 'undefined') __iterCount = 0`) | Children use defensive init | No child transcripts visible; children timed out every time | UNKNOWN -- children did not return so we cannot verify |
| **P1**: Orchestrator forbidden from calling `arc3.step()` | Orchestrator never calls `arc3.step()` | Orchestrator called `arc3.step()` directly starting at iteration 8 | **VIOLATED** |
| **P2**: Orchestrator iteration budgeting with `__outerIter` | Budget guard prevents iteration burn | Present and functional (guard at `>= 28`) | COMPLIANT |
| **P3**: Child forbidden from calling `arc3.start()` | No child calls `arc3.start()` | No evidence of child calling `arc3.start()` (children timed out without returning) | LIKELY COMPLIANT |
| **P5**: Action budget cap (40 actions per level) | Max 40 actions per child | Child 1 used 24 actions; Child 2 used 21+ actions; no cap enforcement visible | NOT ENFORCED |

---

## Phase Summary

| Phase | Iterations | Actions | Outcome |
|---|---|---|---|
| Init + first delegation | 0--1 | 24 (child) | Child timed out, burned 24 actions blind |
| Post-mortem + second delegation | 2--3 | 21 (child) | State check, then child timed out, burned 21 more actions |
| Post-mortem + third delegation | 4--6 | ~0 | State check, orchestrator observed grid directly, then child timed out with 50 more burned |
| Direct play: discovery | 7--9 | 14 | Observed color distribution, printed grid views, discovered player sprite and blocks |
| Direct play: movement testing | 10 | 4 | Tried all 4 directions; player did NOT move (same position after all actions) |
| Block movement discovery | 11 | 10+4 | Tried 10 rights; blocks moved! Discovered sliding-block mechanic |
| Block tracking + directional tests | 12--13 | 3+3 | LEFT/UP/DOWN all move blocks; blocks slide until wall |
| Room layout mapping | 14 | 0 | Analyzed block positions and room structure |
| Bottom strip analysis | 15 | 1+3 | Discovered bottom strip changes with each action (action counter/budget) |
| Navigation strategy | 16--17 | 3+3 | Navigated blocks through top opening, around divider wall |
| Block/player overlap | 18--19 | 2+1 | Pushed blocks onto "player"; "player" disappeared, border indicators appeared |
| Corridor alignment attempts | 20--24 | ~12 | Multiple attempts to align 5-wide blocks with 5-wide corridor; blocks got stuck |
| Wall mapping | 25 | 0 | Precise wall coordinate survey |
| Final navigation attempt | 26 | 4 | RIGHT-DOWN-LEFT-UP sequence; blocks back to start; GAME_OVER at 138 actions |

---

## Iteration-by-Iteration Narrative

### Iteration 0: Game Start

**What**: Called `arc3.start()`, initialized `__knowledge` object and `__outerIter = 0`.

**Observed**: State=NOT_FINISHED, Levels=0. Game running.

**Key decision**: Clean initialization. The orchestrator correctly called `arc3.start()` (this is allowed for the orchestrator) and set up state tracking variables.

---

### Iteration 1: First Delegation (CORRECT PATTERN)

**What**: Incremented `__outerIter` to 1. Checked budget guard (< 28). Called `arc3.observe()`, set `__level_task`, then delegated:
```javascript
__level_task = { level, knowledge: __knowledge };
const summary = await rlm(
  `Play level 1/7 of an interactive grid game...`,
  { app: "arc3-player", model: "intelligent", maxIterations: 25 }
);
```
Included retry logic and knowledge curation code.

**Result**: Child timed out. Error: "RLM reached max iterations (30) without returning an answer."

**Analysis**: The child used 24 of the game's actions (verified in iteration 2) but never returned a result. The error says 30 iterations (the parent's cap), not the child's requested 25 -- suggesting the child's `maxIterations: 25` was not honored or the parent's iteration count was consumed by the child. No evidence the child used a deadline guard or discovery protocol.

**Delegation protocol**: Used `app: "arc3-player"`, used `__level_task`/`__level_result`. Retry block included. Knowledge curation code included.

**Children spawned**: 1 (timed out, no result returned).

---

### Iteration 2: Post-Delegation State Check

**What**: Checked game state after child timeout.

**Observed**: State=NOT_FINISHED, Levels=0, Actions=24. Available actions: 1,2,3,4.

**Key finding**: Child burned 24 actions with zero progress. Player still on level 1.

---

### Iteration 3: Second Delegation

**What**: Incremented `__outerIter` to 2. Re-delegated with enriched prompt telling the child that 24 actions were already taken:
```javascript
__level_task = { level: 1, knowledge: __knowledge };
const summary2 = await rlm(
  `Play level 1/7 of an interactive grid game. 24 actions have already been taken...`,
  { app: "arc3-player", model: "intelligent", maxIterations: 25 }
);
```

**Result**: Child timed out again. Error: "RLM reached max iterations (30) without returning an answer."

**Key mistake**: Orchestrator did not change strategy despite identical failure mode. Same delegation pattern, slightly enriched prompt, same outcome.

**Children spawned**: 1 (timed out, no result returned).

---

### Iteration 4: Second Post-Mortem

**What**: Checked game state.

**Observed**: State=NOT_FINISHED, Levels=0, Actions=45. Available actions: 1,2,3,4.

**Key finding**: Second child used 21 more actions (24 to 45 total). 45 actions burned, zero levels completed.

---

### Iteration 5: Grid Analysis Begins (P1 BORDERLINE)

**What**: Incremented `__outerIter` to 3. The orchestrator began directly observing the grid -- calling `arc3.observe()` and analyzing the frame. Computed color distribution across the 64x64 grid.

**Observed**: 9 color values with distribution: 0=3px, 1=2px, 3=968px, 4=2609px, 5=439px, 8=12px, 9=45px, 11=8px, 12=10px.

**Key insight**: First time the orchestrator examined game state directly. This is an `observe()` call (read-only), which is technically acceptable even under P1. The orchestrator began building its own understanding after three delegation failures.

---

### Iteration 6: Grid Visualization

**What**: Printed downsampled 16x16 grid overview and detailed views of specific regions.

**Observed**: Clear structure emerged:
- Yellow (4) background with green (3) maze/rooms
- Player sprite: colors 0,1 forming a cross pattern near row 31-33, col 20-22
- Colored blocks: 12 (pink) at rows 35-36, 9 (orange) at rows 37-39
- Bottom area: colors 8 and 11 forming patterns at rows 61-62

---

### Iteration 7: Detailed Room Map

**What**: Incremented `__outerIter` to 4. Printed the full green room area (rows 8-52, cols 8-52) at 1:1 resolution.

**Observed**: Complete room layout visible:
- Top reference box: rows 8-16, 5-bordered room with 9-pattern inside
- Corridor connecting top box to main room: rows 17-24, cols 33-37 (5 wide)
- Main room: large L-shaped green area, rows 25-49
- Internal wall divider: rows 30-44, cols 30-33
- Player at r31-33, c20-22 in left chamber
- Blocks (12+9) at rows 35-39, c24-28 in right area adjacent to divider

---

### Iteration 8: Third Delegation

**What**: Incremented `__outerIter` to 5. Delegated again with much richer context -- passed full maze layout knowledge, pre-identified mechanics, and specific game rules:
```javascript
__level_task = {
  level: 1,
  knowledge: {
    ...__knowledge,
    mechanics: {
      maze_navigation: { description: "Player moves through green(3) corridors..." },
      player_sprite: { description: "Player is a small sprite with colors 0,1..." },
      colored_blocks: { description: "There are colored blocks (12=pink, 9=orange)..." },
      target_pattern: { description: "Bottom of screen has a pattern..." }
    },
    rules: [...]
  }
};
```

**Result**: Child timed out a third time. Error: "RLM reached max iterations (30) without returning an answer."

**Key decision**: Orchestrator passed substantial pre-computed knowledge to the child. This was the best-informed delegation attempt. Despite this, the child could not complete the level.

**Children spawned**: 1 (timed out, no result returned).

---

### Iteration 9: Third Post-Mortem -- P1 VIOLATION BEGINS

**What**: Checked game state after third child timeout.

**Observed**: State=NOT_FINISHED, Levels=0, Actions=95. Available actions: 1,2,3,4. Player still at r31-33, c20-22 -- identical position to start.

**Critical finding**: After 95 total actions, the "player" had not moved at all. All three children were taking actions but achieving nothing visible. The orchestrator decided to investigate directly.

---

### Iteration 10: Direct Movement Testing (P1 VIOLATION)

**What**: The orchestrator called `arc3.step()` directly for the first time, testing all four directions:
```javascript
const after_right = await arc3.step(4);  // RIGHT
const after_down = await arc3.step(2);   // DOWN
const after_up = await arc3.step(1);     // UP
const after_left = await arc3.step(3);   // LEFT
```

**Observed**: Player position unchanged after all four directions. The "player" (colors 0,1) did not move.

**P1 status**: VIOLATED. The orchestrator is forbidden from calling `arc3.step()` under the v1.2.0 rules. However, after three child timeouts consuming 95 actions with zero progress, the orchestrator resorted to direct play.

**Key discovery**: Actions 1-4 do not move the player sprite. This was the fundamental insight that all three children apparently failed to discover (or failed to act on).

---

### Iteration 11: Block Movement Breakthrough

**What**: Orchestrator tried 10 rapid `arc3.step(4)` (RIGHT) calls and checked what changed.

**Observed**:
- Player still at same position after 10 more actions
- BUT the colored blocks (12 and 9) MOVED. Block 12 shifted from rows 35-36 to rows 40-44, cols 44-48
- Bottom area color 11 expanded dramatically
- Total actions: 109

**Key discovery**: The directional actions move the BLOCKS, not the player. This is a sliding-block puzzle (like Sokoban or ice-tile mechanics). The "player" sprite is actually a stationary cursor/marker, not an avatar.

---

### Iteration 12: Directional Block Mechanics

**What**: Tested each direction individually while tracking block 12 position.

**Observed**:
- LEFT: blocks slid left (c49-53 to c44-48)
- UP: blocks slid up (r40-41 to r35-36)
- DOWN: blocks slid back down (r35-36 to r40-41)

**Key insight**: Blocks slide in the pressed direction until hitting a wall. Both block 12 (pink, 2 rows) and block 9 (orange, 3 rows) move together as a single 5x5 unit. Classic sliding/ice-tile mechanics confirmed.

---

### Iteration 13: Room Structure Analysis

**What**: Mapped both block types across the grid. Printed detailed views of the right chamber, bottom area, top room, and left chamber.

**Observed**:
- Blocks form a 5-wide, 5-tall combined unit (2 rows pink on top, 3 rows orange below)
- Top reference room: 7x7 box with 5s and a 3x3 pattern of 9s inside
- Bottom-left: same 9-pattern at 2x scale
- Bottom strip: rows 61-62 contain a progress indicator with colors 3, 11(b), 8, 5

---

### Iteration 14: Pattern Recognition

**What**: Extracted the inner patterns from top room and bottom-left area. Analyzed corridor dimensions.

**Observed**:
- Top room inner (7x7): `5555555 / 5599955 / 5555955 / 5595955 / 5555555` -- 9s form an inverted triangle
- Bottom-left (10x10): same pattern at 2x scale
- Corridor: cols 34-38 (5 wide), rows 17-24

**Key hypothesis**: This is a puzzle where sliding blocks must be positioned to match or interact with the reference pattern.

---

### Iteration 15: Bottom Strip = Action Budget

**What**: Recorded bottom strip state, performed UP action, compared strip.

**Observed**: After UP action, the strip changed -- one `b` (color 11) was removed and one `3` was added. The strip is an action-budget counter; each action depletes it.

**Confirmed**: Block 12 moved from r40-41 to r35-36, block 9 moved from r42-44 to r37-39 on UP. Actions: 114.

---

### Iteration 16: Multi-Direction Tracking

**What**: Tested LEFT, DOWN, RIGHT in sequence, tracking block positions and bottom strip state after each.

**Observed**:
- LEFT: blocks c44-48 to c39-43
- DOWN: blocks r35-36 back to r40-41
- RIGHT: blocks c39-43 back to c44-48
- Bottom strip consistently shortened by one `b` per action

**Confirmed**: Blocks slide freely within the room, constrained only by walls. Each action costs one unit from the budget bar.

---

### Iteration 17: Navigation Strategy -- Blocks Through the Opening

**What**: Executed UP, UP, LEFT sequence trying to navigate blocks around the internal wall divider.

**Observed**:
- UP: blocks to r35-36
- UP again: blocks to r30-31 (not r25-26 -- block 9 beneath prevented further sliding)
- LEFT: blocks to c39-43

**Key insight**: The combined block (5 tall) cannot slide all the way to the top of the room because the bottom portion hits internal constraints. The orchestrator began reasoning about wall geometry for path-planning.

---

### Iteration 18: Blocks Enter Left Chamber

**What**: Continued navigation with LEFT, LEFT, LEFT. Then tried LEFT, DOWN to push blocks toward the cursor.

**Observed**:
- Blocks moved from right chamber through the top opening (rows 25-29 have no divider wall) into the left chamber
- After DOWN: blocks at r30-31 (12) and r32-34 (9), cols 24-28

---

### Iteration 19: Blocks Overlap Cursor -- Border Activation

**What**: Pushed blocks LEFT again. Blocks slid through the cursor's position.

**Observed**:
- Block 12 now at r30-31, c19-23; Block 9 at r32-34, c19-23
- The "player" (colors 0,1) DISAPPEARED from its original position
- Color 0 now forms BORDERS around both the top reference room (rows 9-15, cols 33-39) and the bottom-left pattern (rows 53-62, cols 1-10)
- These borders were not present before the overlap

**Key discovery**: Pushing blocks onto the cursor activates border indicators on the reference patterns. This is likely part of the level completion mechanic -- the cursor marks a target position for the blocks.

---

### Iteration 20: Pattern Comparison

**What**: Extracted inner patterns of the newly-bordered reference areas.

**Observed**:
- Top room with 0-border: `0000000 / 0555550 / 0599950 / 0555950 / 0595950 / 0555550 / 0000000`
- Bottom-left with 0-border: same pattern at 2x scale
- Corridor dimensions: cols 34-38 (5 wide) between walls at c28-33 and c39-42

**Analysis**: The blocks (5 wide) fit exactly in the corridor. The orchestrator recognized it needed to push them up through the corridor into the top reference room.

---

### Iteration 21: Corridor Alignment Attempt

**What**: Moved blocks UP to top of room, then RIGHT trying to align with corridor columns.

**Observed**:
- UP: blocks to r25-26 (top of room opening)
- RIGHT: blocks to c24-28 to c29-33 (only moved 5 positions, stopped at corridor wall)
- Second UP: blocks stayed at r25-26 (already at top, corridor too narrow at this column)

**Problem**: Blocks at c24-28 cannot enter the corridor at c34-38. They are 10 columns away and there is no intermediate wall to stop them at the right position when sliding RIGHT.

---

### Iteration 22: Failed Right-Alignment

**What**: Tried DOWN, RIGHT, UP sequence to reposition blocks.

**Observed**:
- DOWN: blocks to r30-31 (hit wall)
- RIGHT: blocks stayed at c24-28 (wall at c29-33 to the right in rows 30+)
- UP: blocks back to r25-26

**Problem**: In the region below the corridor (rows 30+), the wall at c29-33 blocks rightward movement. In the open region above (rows 25-29), there is no wall to stop blocks at c34-38.

---

### Iteration 23: Corridor Geometry Survey

**What**: Checked row 25 from c24-c54 and row 20 from c28-c42. Attempted DOWN-RIGHT-LEFT-UP navigation.

**Observed**:
- Row 25: no walls between c29 and c54 (fully open)
- Corridor walls: left at c28-33, right at c39-42
- DOWN: blocks to r30-31 at c24-28
- RIGHT: blocks did NOT move (wall at c29 blocks)
- LEFT: blocks back to c24-28 (already there)
- UP: blocks back to r25-26

**Key failure**: The orchestrator could not find a path to align blocks with the corridor. The sliding mechanics mean blocks always overshoot -- they slide all the way to the far wall with no intermediate stops.

---

### Iteration 24: Blocks Stuck in Loop

**What**: Tried UP to get blocks into open area, then RIGHT.

**Observed**: Blocks went from c24-28 to c29-33 on RIGHT (stopped by something), but could not reach c34-38.

**Analysis**: There appears to be an obstacle or wall segment at c29-33 even in the open rows. The blocks are trapped in a local area without a clear path to corridor alignment.

---

### Iteration 25: Wall Coordinate Survey

**What**: Mapped all wall (color 4) positions for rows 8-49 with precise column ranges.

**Observed**:
- Rows 25-29: no walls in cols 14-53 (fully open)
- Rows 30-39: wall at cols 29-33 (divider)
- Rows 40-44: walls at cols 14-18 and 24-33 (double barrier)
- Rows 45-49: walls at cols 14-18 only
- Corridor walls: rows 17-24 at cols 28-33 (left) and 39-42 (right)
- Top room walls: rows 8-16 at cols 28-31 (left) and 41-42 (right)

**Analysis**: The corridor inner space is cols 34-38 (5 wide). Blocks at c24-28 in the open area (rows 25-29) could slide RIGHT all the way to c49-53 (room right wall at c54). There is nothing to stop them at c34-38 in the open rows.

---

### Iteration 26: Final Navigation Attempt -- GAME OVER

**What**: Executed the strategy: RIGHT (slide blocks to far right), DOWN (drop into walled area), LEFT (slide back against divider wall), UP (push up toward corridor).

**Observed**:
- RIGHT: blocks from c24-28 to c29-33 (stopped unexpectedly, not at c49-53)
- DOWN: blocks stayed at r25-26 (did not drop)
- LEFT: blocks back to c24-28
- UP: blocks stayed at r25-26

**State**: GAME_OVER. Actions: 138. The action budget was exhausted.

**Analysis**: The game ended due to action-budget exhaustion. The orchestrator's final RIGHT move only shifted blocks 5 positions (c24-28 to c29-33), suggesting there was something blocking at c29 in those rows that wasn't visible as a wall. The orchestrator never completed level 1.

---

## Delegation Analysis

### Children Spawned: 3

| Child | Iteration | maxIterations | Actions Used | Returned Result | Used `app: "arc3-player"` |
|---|---|---|---|---|---|
| Child 1 | 1 | 25 | 24 | NO (timeout) | YES |
| Child 2 | 3 | 25 | 21 | NO (timeout) | YES |
| Child 3 | 8 | 20 | ~50 | NO (timeout) | YES |

**Total actions burned by children**: ~95 out of 138 total (69%)

### Delegation Pattern Compliance

- `app: "arc3-player"`: YES (all three delegations)
- `__level_task`/`__level_result`: YES (set before each delegation)
- `model: "intelligent"`: YES (all three)
- Knowledge curation code: YES (included but never executed because children never returned)
- Retry logic: YES (included in iteration 1 block but the retry was never triggered because the main rlm() call itself timed out)

### Child Behavior (Inferred)

No child transcripts are available in the results JSON. From the orchestrator's observations:

- **Child 1**: Used 24 actions. Player remained at starting position. The child likely tried random actions without understanding the sliding-block mechanic.
- **Child 2**: Used 21 actions. Player still at starting position. Same failure mode.
- **Child 3**: Used ~50 actions. Player still at starting position. Despite receiving rich maze-layout knowledge, the child still failed.

**Deadline guard**: UNKNOWN. No child returned output, so we cannot verify whether children used the defensive `__iterCount` init pattern.

**Discovery protocol**: NOT OBSERVED. Children burned actions without discovering that directional inputs move blocks rather than the player.

**arc3.start() by child**: NOT OBSERVED. Unlike run-017, no child appeared to reset the game (action count increased monotonically).

---

## Key Failure Modes

### 1. Child Timeout Loop (iterations 1-8)

The orchestrator delegated three times, each child timed out, consuming 69% of the total action budget. The children never discovered the core mechanic (blocks move, not player). The v1.2.0 changes did not prevent this:
- P0 (deadline guard) could not help if children spent all iterations on fruitless exploration
- P5 (40-action cap) was not enforced -- children used 24, 21, and ~50 actions respectively

### 2. P1 Violation: Orchestrator Direct Play (iterations 9-26)

After three failures, the orchestrator began calling `arc3.step()` directly -- a clear v1.2.0 P1 violation. Ironically, the orchestrator was far more effective than the children: it discovered the sliding-block mechanic within 2 iterations of direct play (vs. children failing in 25+ iterations each).

### 3. Block Alignment Puzzle

The orchestrator identified the goal (navigate 5-wide blocks through a 5-wide corridor into the top reference room) but could not solve the alignment problem. The blocks always overshot or undershot the corridor position due to the ice-sliding mechanic (blocks slide until hitting a wall, with no fine-grained control). The orchestrator needed to find an indirect path using walls as stops, but ran out of actions.

### 4. Action Budget Exhaustion

138 total actions were taken. Approximately 95 were wasted by children. The orchestrator's own 43 actions were used efficiently for discovery and navigation, but were insufficient to solve the level.

---

## Comparison with Prior Runs

| Dimension | Run 016 (v1.0.0) | Run 017 (v1.1.0) | Run 018 (v1.2.0) |
|---|---|---|---|
| Score | 0% | 0% | 0% |
| Used `app: "arc3-player"` | NO (inline systemPrompt) | YES | YES |
| Used `__level_task`/`__level_result` | NO | YES | YES |
| Child timeouts | 1 | 2 | 3 |
| Orchestrator called `arc3.step()` | YES | YES | YES (P1 violated) |
| Child called `arc3.start()` | N/A | YES (caused reset) | NO |
| Key mechanic discovered | Block movement | Block movement + walls | Block movement + walls + border activation |
| Actions by children | ~35 | ~35 + reset | ~95 |
| Deepest understanding | Blocks slide; walls block | Same + corridor identified | Same + cursor overlay activates borders |

### v1.2.0 Improvements Observed

1. **No game reset by child**: Unlike v1.1.0 where a child called `arc3.start()` and reset all progress, v1.2.0 children did not reset the game. P3 appears to have worked (or children simply never attempted it).
2. **Correct delegation pattern**: All three delegations used the canonical pattern with `app`, `__level_task`, `model`.
3. **Iteration budgeting**: `__outerIter` guard was present and functional (threshold at 28).

### v1.2.0 Regressions / Unchanged Issues

1. **More actions burned by children**: 95 actions (v1.2.0) vs ~35 (v1.1.0). The third delegation was particularly wasteful.
2. **P1 still violated**: The orchestrator still resorted to direct `arc3.step()` calls after child failures.
3. **Children still ineffective**: Despite receiving enriched knowledge in the third delegation, the child still failed. The fundamental problem is that children cannot discover the sliding-block mechanic within their iteration budgets.
4. **P5 action cap not enforced**: No evidence of a 40-action-per-level cap in child behavior.

---

## Final Assessment

v1.2.0 did not improve the score. The core problem remains unchanged across all three runs: **children cannot independently discover and exploit the sliding-block mechanic**. The delegation pattern is now correct (app, shared vars, model), but the children lack the systematic exploration strategy needed for this puzzle type.

The orchestrator consistently demonstrates superior problem-solving ability when it plays directly. In run-018, it discovered the block mechanic in 2 iterations, identified the cursor-overlay activation in 8 iterations, and developed a multi-step navigation strategy in 6 iterations. The children achieved none of this in 25+ iterations each.

**Root cause**: The children need a structured discovery protocol that tests each action's effect by diffing grid state before/after. Without this, they take random actions and learn nothing. The v1.2.0 plugin improvements (deadline guard, action caps, forbidden APIs) address peripheral failure modes but do not address the fundamental lack of a child-side exploration strategy.

**Recommendation**: v1.3.0 should embed a mandatory grid-diff discovery protocol in the `arc3-player` plugin prompt, forcing children to: (1) observe before, (2) take one action, (3) observe after, (4) diff, (5) record what changed. This is exactly what the orchestrator did successfully in iterations 10-11 when it played directly.
