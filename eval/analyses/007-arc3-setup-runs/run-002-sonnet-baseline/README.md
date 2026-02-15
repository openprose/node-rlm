# Run 002: Sonnet 4.5 Baseline

**Date:** 2026-02-14
**Branch:** `feat/arc3-benchmark`

## Run Configuration

| Parameter | Value |
|-----------|-------|
| Model | `anthropic/claude-sonnet-4.5` (via OpenRouter) |
| Max Iterations | 15 |
| Max Depth | 1 |
| Concurrency | 3 |
| Drivers | none |
| App | `arc3-player` |
| Rate Limit | 5 req/s (burst: 10) |

**Note:** The original command used `anthropic/claude-sonnet-4-5-20250929` which is not a valid OpenRouter model ID (400 error). Re-ran with `anthropic/claude-sonnet-4.5`.

## Summary Results

| Metric | Value |
|--------|-------|
| Total Score | **0%** |
| Mean Iterations | 14.3 |
| Median Iterations | 15.0 |
| Mean Wall Time | 2m 1s |
| Total Wall Time | 2m 22s (concurrent) |
| Total Input Chars | 1,460,787 (~365K tokens) |
| Total Output Chars | 62,418 (~16K tokens) |
| Estimated Cost | $1.33 |
| Completed Tasks | 1 (vc33 returned a score) |
| Failed Tasks | 2 (hit max iterations) |

## Per-Game Breakdown

| Game | Score | Iters | Wall Time | Levels Completed | Actions Used | Error |
|------|-------|-------|-----------|:----------------:|:------------:|-------|
| ls20-cb3b57cc | 0% | 15 | 1m 35s | 0/7 | ~5 | Max iterations (timeout) |
| vc33-9851e02b | 0% | 13 | 2m 4s | 0/7 | 50 (GAME_OVER) | Hit 50-action limit |
| ft09-9ab2447a | 0% | 15 | 2m 22s | 0/6 | 26 | Max iterations (timeout) |

### vc33 Level Baselines

The vc33 scorecard reveals human baselines per level:

| Level | Human Baseline (actions) | AI Actions | Score |
|:-----:|:------------------------:|:----------:|:-----:|
| 1 | 6 | 50 | 0 |
| 2 | 13 | 0 | 0 |
| 3 | 31 | 0 | 0 |
| 4 | 59 | 0 | 0 |
| 5 | 92 | 0 | 0 |
| 6 | 24 | 0 | 0 |
| 7 | 82 | 0 | 0 |

The model spent all 50 actions on level 1 without completing it. Level 1 requires only 6 human actions.

## Notable Observations

### 1. Frame Parsing is the Dominant Cost

All three games spent 3-5 iterations just understanding the frame data structure. The frame is `[1][64]` where each element is a 64-value array (effectively 64x64 grid stored column-major). Every game hit the same confusion:

- **ls20:** 4 iterations (iters 0-3) to parse frame structure. Error: `TypeError: Cannot read properties of undefined (reading '0')` repeated twice.
- **vc33:** 2 iterations to realize the `1x64` structure, then 1 more to properly visualize it.
- **ft09:** 2 iterations to parse frame, same `TypeError`.

**Impact:** At 15 max iterations, losing 3-4 to frame parsing leaves only 10-12 for actual gameplay.

### 2. Player Cannot Move in ls20

The model identified a player sprite (colors 0/1 at position ~(32,21)) surrounded by walls (color 3). It tried all 4 directional actions plus action 5 (interact). The player never moved. The player appears to be inside a walled room with no visible exits in the 2x-downsampled map. The model spent the remaining iterations trying different directions and visualizing the map, but never found a way to move.

### 3. vc33 Made Real Progress (Click Puzzle)

This was the most successful game:
- Identified a top progress bar (row 0) that fills with color 4
- Discovered that clicking color-9 diamonds and color-11 dots advances the bar
- Progressed from 0/64 to 56/64 filled before hitting the 50-action GAME_OVER limit
- The model systematically clicked interactive elements, discovering the diamond->column-shift mechanic

But: level 1 human baseline is **6 actions**. The model used **50 actions** (and still didn't complete it). The model was clicking individual pixels rather than understanding the underlying puzzle logic.

### 4. ft09 Stuck on Game Mechanics

The model understood the frame (a pattern-matching puzzle with examples on the left and a framed target on the right) but could never figure out how to interact with it:
- Clicking on examples, the query pattern, and the frame border produced no visible changes
- Movement actions only changed row 63 (a cursor/selection bar)
- The model burned 26 of its ~30 available actions trying different click positions and movements with zero effect on the game state

### 5. Row 63 Cursor Mechanic (ft09)

Row 63 in ft09 contains an alternating 1-2 pattern that expands from right to left as the player makes movements. This appears to be a progress/selection cursor, but the model never figured out what it represents or how to use it productively.

## Failure Mode Summary

| Game | Primary Failure | Root Cause |
|------|----------------|------------|
| ls20 | No movement possible | Model couldn't find exit from starting room; may need specific action sequence |
| vc33 | 50-action limit exceeded | Brute-force pixel clicking instead of understanding puzzle logic (8x human baseline) |
| ft09 | No interaction discovered | Click/movement actions don't visibly affect game state; game mechanics unknown |

## Results File

`eval/results/arc3_anthropic_claude-sonnet-4.5_2026-02-14T23-50-29-709Z.json`

## Trajectory Files

- [ls20-cb3b57cc](trajectories/arc3-ls20-cb3b57cc.md) -- Navigation game, stuck in room
- [vc33-9851e02b](trajectories/arc3-vc33-9851e02b.md) -- Click puzzle, closest to progress
- [ft09-9ab2447a](trajectories/arc3-ft09-9ab2447a.md) -- Pattern matching, zero interaction
