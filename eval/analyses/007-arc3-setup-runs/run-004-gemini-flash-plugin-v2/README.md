# Run 004: Gemini 2.5 Flash with Plugin v2 (Frame Shape Docs + Action Loop Guidance)

**Date:** 2026-02-14
**Branch:** `feat/arc3-benchmark`
**Results files:**
- `eval/results/arc3_google_gemini-2.5-flash_2026-02-15T00-04-03-477Z.json` (vc33, ls20)
- `eval/results/arc3_google_gemini-2.5-flash_2026-02-15T00-23-01-293Z.json` (ft09)

---

## Run Configuration

| Parameter | Value |
|-----------|-------|
| Model | `google/gemini-2.5-flash` (via OpenRouter) |
| Max Iterations | 15 |
| Max Depth | 1 (no recursive delegation) |
| Concurrency | 3 |
| App Plugin | `arc3-player` v2 (3580 chars) |
| Drivers | none |
| Rate Limit | 5 req/s, burst 10 |
| Attempts | 1 |

### Plugin Changes (v1 -> v2)

The `arc3-player` plugin was updated with two key improvements over the version used in run-001:

1. **Frame shape documentation**: Added explicit documentation that `frame.frame` has shape `[1][64][64]`, with code examples showing `const grid = frame.frame[0]` and `grid[row][col]` for pixel access. Run-001's primary failure mode was the model treating `frame.frame` as a flat 64x64 grid.

2. **Action loop guidance**: Added strategy section advising "Act early, learn by doing" with a concrete game loop example showing how to take multiple actions per iteration, track changes between frames, and check `available_actions`.

## Summary Results

| Metric | Value |
|--------|-------|
| **Total Score** | **0.0%** |
| Games Played | 3 |
| Games Completed (returned scorecard) | 1 (ft09) |
| Games Failed (hit max iterations) | 2 (vc33, ls20) |
| Mean Iterations | 11.0 |
| Median Iterations | 15.0 |
| Total Wall Time | 10m 50s |
| Total Input Chars | ~2,840,000 (~710K tokens) |
| Total Output Chars | ~400,000 (~100K tokens) |
| Est. Cost | ~$3.00 (at Sonnet 4.5 pricing) |

## Per-Game Breakdown

| Game ID | Task ID | Score | Iters | Wall Time | Actions Taken | Levels | Levels Completed | Run State | Baseline Actions (L1) |
|---------|---------|:-----:|:-----:|:---------:|:-------------:|:------:|:----------------:|:---------:|:--------------------:|
| ft09 | `arc3-ft09-9ab2447a` | 0.00 | 3 | 39s | 32 | 6 | 0 | GAME_OVER | 15 |
| vc33 | `arc3-vc33-9851e02b` | 0.00 | 15 | 4m 52s | ~50* | 7 | 0 | timeout | 6 |
| ls20 | `arc3-ls20-cb3b57cc` | 0.00 | 15 | 5m 20s | ~129* | 7 | 0 | timeout | 29 |

\* vc33 and ls20 hit max iterations. Action counts are estimated from trace output; each iteration restarted the game via `arc3.start()`, so the final session's action count may differ from cumulative actions across all sessions.

## Comparison to Run-001 (Baseline Plugin)

| Metric | Run-001 (v1 plugin) | Run-004 (v2 plugin) | Delta |
|--------|:-------------------:|:-------------------:|:-----:|
| Total Score | 0.0% | 0.0% | = |
| ft09 iters | 10 | 3 | -7 |
| ft09 actions | 7 | 32 | +25 |
| ft09 levels completed | 0 | 0 | = |
| vc33 iters | 11 | 15 | +4 |
| vc33 actions | 50 | ~50 | ~ |
| vc33 levels completed | 0 | 0 | = |
| ls20 iters | 15 | 15 | = |
| ls20 actions | 0 | ~129 | +129 |
| ls20 levels completed | 0 | 0 | = |
| Mean wall time | 1m 43s | 3m 24s | +1m 41s |

### Did the Plugin Fixes Help?

**Frame shape comprehension: YES, significant improvement.** The most dramatic change is in frame parsing. In run-001, all three games failed to correctly index into `frame.frame[0][row][col]` -- the model consistently treated `frame.frame` as a 2D array. In run-004, all three games immediately and correctly used `frame.frame[0]` to access the 64x64 grid. The explicit documentation (`const grid = frame.frame[0]`) was directly adopted by the model.

**Action loop adoption: YES, the model takes many more actions.** In run-001, ls20 took 0 actions (stuck parsing frames). In run-004, ls20 took ~129 actions per session -- the model successfully wrote game loops that executed multiple actions per iteration, following the plugin's guidance.

**Game understanding: NO improvement.** Despite correctly parsing frames and taking actions, no game completed a single level. The fundamental problem shifted from "cannot read the frame" to "can read the frame but cannot understand what the game wants." Specifically:
- **ft09**: Found entities (char at 63,0; target at 2,4) but movement actions had no effect -- char position did not change between frames, suggesting the model misidentified which pixel is the player.
- **vc33**: Only click (action 6) was available. The model clicked various colored objects but none triggered level completion. It never understood what constitutes a correct click.
- **ls20**: Identified a player-like entity (color 1, 2 pixels) but movement had no visible effect. Tried various strategies: sweep painting, flood fill, BFS navigation -- all scored 0.

**Net assessment: Plugin v2 solved the data access problem but exposed a deeper game comprehension gap.** The bottleneck moved from "infrastructure" to "strategy."

## Notable Observations

### 1. Frame Indexing Fixed Across All Games
Every iteration in run-004 correctly uses `frame.frame[0]` to get the 64x64 grid. This is a direct result of the plugin documentation:
```javascript
const grid = frame.frame[0];  // 64x64 grid (the [0] unwraps the outer array)
```
Compare to run-001 where the model wrote `frame[y][x]` with `frame.length = 1`.

### 2. Game Loop Pattern Adopted
The model followed the plugin's game loop guidance, writing `while (frame.state === "NOT_FINISHED")` loops that take multiple actions per iteration. In run-001, the model often wrote single-action-per-iteration code.

### 3. Empty Code Blocks (Gemini Token Limit Issue)
Multiple iterations (vc33 iters 3,5,7-12; ls20 iters 0,6,10-11,14) produced empty code blocks. The model's reasoning text was truncated mid-thought, and the code block was never emitted. This appears to be a Gemini 2.5 Flash token generation limit -- when the reasoning section is long, the model exhausts its output budget before reaching the code. The `finish=length` markers in the eval output confirm this.

### 4. Session State Loss Pattern
Both vc33 and ls20 called `arc3.start()` on every iteration with code, creating a new game session each time. This invalidated previous scorecards (404 errors on `getScore()`). The model never persisted state across iterations -- each iteration's code was a standalone game attempt.

### 5. Entity Detection Heuristics
The model invented creative but incorrect heuristics for identifying game entities:
- ft09: Assumed player=color 12, target=color 9 (reasonable guess, but movement didn't change the grid)
- vc33: Assumed player=color 4 (yellow, smallest object), target=color 9 (arbitrary)
- ls20: Tried multiple strategies -- rarest color, single-pixel blob, min-count color -- none worked reliably

### 6. ft09 Completed in Only 3 Iterations
Remarkably, ft09 completed in 3 iterations (vs 10 in run-001). The model wrote a complete game loop with pathfinding, executed 32 actions, and hit GAME_OVER. However, those 32 actions were all "move up" (action 1) which had no effect -- the character stayed at (63,0) the entire time.

## Key Failure Modes

1. **no-game-understanding**: The model can now read frames but cannot determine game mechanics (what actions do, what constitutes winning).
2. **entity-misidentification**: Color-based entity detection is unreliable across different games.
3. **session-restart-per-iteration**: Each iteration calls `arc3.start()`, losing game progress.
4. **output-budget-exhaustion**: Gemini 2.5 Flash exhausts its output token budget on reasoning before emitting code, causing empty iterations.
5. **blind-movement**: Taking many actions without verifying they have any effect (ft09: 32 identical "move up" commands).

## Trajectory Files

- [`trajectories/arc3-ft09-9ab2447a.md`](trajectories/arc3-ft09-9ab2447a.md) -- Pattern puzzle game, 6 levels, click-based
- [`trajectories/arc3-vc33-9851e02b.md`](trajectories/arc3-vc33-9851e02b.md) -- Click puzzle game, 7 levels, click-only
- [`trajectories/arc3-ls20-cb3b57cc.md`](trajectories/arc3-ls20-cb3b57cc.md) -- Navigation game, 7 levels, directional + click

## Implications for Next Runs

1. **Game mechanics documentation needed**: The model can parse frames now, but needs help understanding what games expect. Per-game hints (or a generic "observe what changes after each action" strategy) would help.
2. **State persistence across iterations**: The model should NOT call `arc3.start()` every iteration. A driver or plugin guidance saying "only call start() once" would prevent session loss.
3. **Action verification loop**: After taking an action, the model should compare the new frame to the previous one. If nothing changed, the action was ineffective. This basic feedback loop is missing.
4. **Stronger model or longer output budget**: Gemini 2.5 Flash hits output limits frequently. A model with more output headroom (or the `max-blocks-per-iteration=1` setting) might reduce wasted iterations.
5. **Entity detection strategy**: Color-based heuristics are insufficient. A diff-based approach (take an action, see what pixels changed) would be more reliable for identifying the player entity.
