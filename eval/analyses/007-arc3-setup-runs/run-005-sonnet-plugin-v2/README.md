# Run 005: Sonnet 4.5 with Updated arc3-player Plugin (v2)

**Date:** 2026-02-15
**Branch:** `feat/arc3-benchmark`

## Run Configuration

| Parameter | Value |
|-----------|-------|
| Model | `anthropic/claude-sonnet-4.5` (via OpenRouter) |
| Max Iterations | 15 |
| Max Depth | 1 |
| Concurrency | 3 |
| Drivers | none |
| App | `arc3-player` (v2 -- updated) |
| Rate Limit | 5 req/s (burst: 10) |

**Plugin changes from run-002:** The `arc3-player` plugin was updated to:
1. Fix frame shape documentation -- clarified that `frame.frame` has shape `[1][64][64]` and that `frame.frame[0]` must be indexed first to get the 64x64 grid. Added explicit code example: `grid[row][col]`.
2. Add action loop guidance -- new "Strategy" section advising the model to act early, use game loops (take multiple actions per iteration), track frame changes, and minimize total actions.

## Summary Results

| Metric | Value |
|--------|-------|
| Total Score | **0%** |
| Mean Iterations | 14.0 |
| Median Iterations | 15.0 |
| Mean Wall Time | 1m 53s |
| Total Wall Time | 2m 18s (concurrent) |
| Total Input Chars | 1,129,949 (~282K tokens) |
| Total Output Chars | 57,459 (~14K tokens) |
| Estimated Cost | $1.06 |
| Completed Tasks | 1 (vc33 returned a score) |
| Failed Tasks | 2 (hit max iterations) |

## Per-Game Breakdown

| Game | Score | Iters | Wall Time | Levels Completed | Actions Used | Error |
|------|-------|-------|-----------|:----------------:|:------------:|-------|
| vc33-9851e02b | 0% | 12 | 1m 30s | 0/7 | 50 (GAME_OVER) | Hit 50-action limit |
| ft09-9ab2447a | 0% | 15 | 1m 52s | 0/6 | ~37 | Max iterations (timeout) |
| ls20-cb3b57cc | 0% | 15 | 2m 18s | 0/7 | ~48 | Max iterations (timeout) |

### vc33 Level Baselines

| Level | Human Baseline (actions) | AI Actions | Score |
|:-----:|:------------------------:|:----------:|:-----:|
| 1 | 6 | 50 | 0 |
| 2 | 13 | 0 | 0 |
| 3 | 31 | 0 | 0 |
| 4 | 59 | 0 | 0 |
| 5 | 92 | 0 | 0 |
| 6 | 24 | 0 | 0 |
| 7 | 82 | 0 | 0 |

## Comparison to Run 002 (Old Plugin)

| Metric | Run 002 (old plugin) | Run 005 (updated plugin) | Delta |
|--------|---------------------|-------------------------|-------|
| Total Score | 0% | 0% | -- |
| Mean Iterations | 14.3 | 14.0 | -0.3 |
| Mean Wall Time | 2m 1s | 1m 53s | -8s |
| Total Input Chars | 1,460,787 | 1,129,949 | -23% |
| Total Output Chars | 62,418 | 57,459 | -8% |
| Estimated Cost | $1.33 | $1.06 | -$0.27 |
| vc33 Iterations | 13 | 12 | -1 |
| ft09 Iterations | 15 | 15 | 0 |
| ls20 Iterations | 15 | 15 | 0 |

### Did the Plugin Fixes Help?

**Frame parsing:** Yes, measurably improved. In run-002, the model spent 3-5 iterations per game understanding the `[1][64]` frame structure, hitting `TypeError` repeatedly (e.g., `frame[0][x].split()` failures in ls20, TypeError in ft09). In run-005, the model correctly accessed `frame.frame[0]` from the very first iteration in all three games -- zero frame parsing errors. This saved 2-3 iterations per game.

**Action loop guidance:** Partially effective. The model adopted the loop pattern in vc33 iter 10 (bulk-clicking in a for loop) and in ft09 iter 8-9 (multiple moves per iteration). However, the core game-understanding problem remains: the model still used 50 brute-force clicks on vc33 level 1 (human baseline: 6), still couldn't move the player in ls20, and still couldn't figure out ft09's mechanics.

**Token efficiency:** 23% reduction in input chars suggests the model needed fewer turns to reach the action phase, consistent with faster frame parsing.

**Bottom line:** The plugin fixes successfully eliminated the frame-parsing tax (saving 2-3 iterations and ~23% tokens), but did not improve game scores. The bottleneck is game strategy, not frame parsing.

## Notable Observations

### 1. Frame Parsing Eliminated as a Cost

All three games correctly accessed `frame.frame[0]` on the first iteration. No `TypeError` errors. This is a direct improvement from the updated frame shape documentation.

### 2. vc33: Same Brute-Force Strategy

Despite the action loop guidance, the model still discovered the "click colored elements to fill the progress bar" mechanic and proceeded to brute-force-click individual pixels. It alternated between clicking color-11 (cyan) and color-9 (maroon) elements. Each click advanced the progress bar by ~1 pixel. The model filled 60/64 of the bar before hitting the 50-action GAME_OVER limit. Human baseline for level 1 is 6 actions, meaning there's a much more efficient mechanic the model didn't discover.

### 3. ft09: Cursor Expanding But No Submission

The model identified the row-63 cursor that expands left/right with movement actions. It tried every combination: left/right expand cursor, up/down, click, interact. Nothing ever triggered a state change on the puzzle itself. The cursor expanded from cols 56-63 to eventually 0-63, at which point the game ended (GAME_OVER). The model used more actions in this run (~37 vs ~26 in run-002), suggesting the loop guidance encouraged more exploration, but the fundamental mechanic remained undiscovered.

### 4. ls20: Player Completely Frozen

The model tried all 4 directional actions repeatedly but the player at (32, 20) never moved. In a novel approach, the model called `arc3.start()` to restart the game (iter 12), but the same stuck behavior persisted. Available actions were [1,2,3,4] only (no interact/click). After 48 total actions across the run, zero player movement occurred. This is unchanged from run-002.

### 5. Model Used Action Loops Effectively

The updated plugin's loop guidance worked in the sense that the model took multiple actions per iteration: vc33 iter 10 took ~43 actions in one iteration via a for loop, ft09 iter 8-9 each took ~6-12 actions per iteration, and ls20 iter 13 took ~20 actions per iteration. This is a structural improvement over run-002, where the model sometimes took only 1 action per iteration.

## Results File

`eval/results/arc3_anthropic_claude-sonnet-4.5_2026-02-15T00-03-33-475Z.json`

## Trajectory Files

- [vc33-9851e02b](trajectories/arc3-vc33-9851e02b.md) -- Click puzzle, brute-force pixel filling
- [ft09-9ab2447a](trajectories/arc3-ft09-9ab2447a.md) -- Pattern matching, cursor mechanic unresolved
- [ls20-cb3b57cc](trajectories/arc3-ls20-cb3b57cc.md) -- Navigation game, player permanently stuck
