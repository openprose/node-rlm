# Run 001: Gemini 2.5 Flash Baseline

**Date:** 2026-02-14
**Branch:** `feat/arc3-benchmark`
**Results file:** `eval/results/arc3_google_gemini-2.5-flash_2026-02-14T23-49-38-957Z.json`

---

## Run Configuration

| Parameter | Value |
|-----------|-------|
| Model | `google/gemini-2.5-flash` (via OpenRouter) |
| Max Iterations | 15 |
| Max Depth | 1 (no recursive delegation) |
| Concurrency | 3 |
| App Plugin | `arc3-player` (2694 chars) |
| Drivers | none |
| Rate Limit | 5 req/s, burst 10 |
| Attempts | 1 |

## Summary Results

| Metric | Value |
|--------|-------|
| **Total Score** | **0.0%** |
| Games Played | 3 |
| Games Completed | 2 (returned scorecard) |
| Games Failed | 1 (hit max iterations) |
| Mean Iterations | 12.0 |
| Median Iterations | 11.0 |
| Total Wall Time | 2m 29s |
| Total Input Chars | 1,590,889 (~398K tokens) |
| Total Output Chars | 175,811 (~44K tokens) |
| Est. Cost | $1.85 (at Sonnet 4.5 pricing) |

## Per-Game Breakdown

| Game ID | Task ID | Score | Iters | Wall Time | Actions Taken | Levels | Levels Completed | Run State | Baseline Actions (L1) |
|---------|---------|:-----:|:-----:|:---------:|:-------------:|:------:|:----------------:|:---------:|:--------------------:|
| ft09 | `arc3-ft09-9ab2447a` | 0.00 | 10 | 1m 9s | 7 | 6 | 0 | NOT_FINISHED | 15 |
| vc33 | `arc3-vc33-9851e02b` | 0.00 | 11 | 1m 30s | 50 | 7 | 0 | GAME_OVER | 6 |
| ls20 | `arc3-ls20-cb3b57cc` | 0.00 | 15 | 2m 29s | 0 | 7* | 0 | timeout | 29 |

\* ls20 hit max iterations without returning; no scorecard was retrieved.

## Notable Observations

### 1. Frame Data Misinterpretation (all games)

The most critical failure across all three games was the model's inability to correctly interpret the frame data structure. The frame is returned as `number[][][]` with shape `[1][64][64]` -- a single "layer" of a 64x64 grid where each cell is a color index. The model consistently misinterpreted this as:
- A "1x64" grid (iter 1 of ft09: `Frame dimensions: 1 x 64`)
- A flattened array of color values
- An RGBA pixel array (ls20 iter 11)

The ft09 model correctly identified (via LLM delegation) that `frame[0][row][col]` gives the color index, but never systematically applied this understanding.

### 2. LLM Delegation for Frame Analysis (ft09)

The ft09 trajectory delegated frame interpretation to `llm()` with `model: "intelligent"` (Claude Opus). The Opus LLM correctly identified the frame encoding and game structure but could not provide actionable click coordinates -- its suggestions were based on visual pattern analysis that didn't match the actual game mechanics.

### 3. Brute-Force Click Scanning (vc33)

After failing to understand the frame, vc33 resorted to brute-force clicking at every coordinate from (0,0) through (63,0). It found that clicking at (46,0) triggered GAME_OVER, but this was a loss, not a win. It then tried to restart but lost the scorecard due to the `arc3.start()` resetting the session, causing a 404 on `getScore()`.

### 4. Persistent Color Detection Bug (ls20)

The ls20 trajectory spent all 15 iterations trying to find color index 9 (the player) in the frame, but the `findColorCoordinates` function never worked because the model kept misunderstanding the frame's nested array structure. It treated `frame[0][row]` (a 64-element array) as a single pixel rather than a row of 64 pixels. The player color 9 was visibly present in the debug output but the code could never locate it.

### 5. No Levels Completed

No game completed even a single level. The fundamental blocker was frame comprehension: without understanding the 64x64 grid layout, the model could not identify game entities (player, target, walls) and therefore could not form any game strategy.

### 6. Action Efficiency

- **ft09**: 7 actions on level 1 (baseline: 15) -- but none were strategic; they were random clicks
- **vc33**: 50 actions on level 1 (baseline: 6) -- brute-force sequential clicking
- **ls20**: 0 actions -- never got past frame parsing

## Key Failure Modes

1. **frame-misinterpretation**: The `number[][][]` frame structure with shape `[1][64][64]` was never correctly parsed by any game. This is a data format comprehension failure.
2. **delegation-parse-failure**: LLM responses were not reliably parseable (ft09 iter 4: LLM returned prose instead of "x,y" coordinates).
3. **session-state-loss**: Calling `arc3.start()` invalidates the previous scorecard, causing 404 errors on `getScore()` (vc33 iter 8-9).
4. **no-game-understanding**: Even with a correct frame interpretation, no game trajectory showed evidence of understanding the game's mechanics (what the player is, what the goal is, how to win).

## Trajectory Files

- [`trajectories/arc3-ft09-9ab2447a.md`](trajectories/arc3-ft09-9ab2447a.md) -- Pattern puzzle game, 6 levels, click-based
- [`trajectories/arc3-vc33-9851e02b.md`](trajectories/arc3-vc33-9851e02b.md) -- Click puzzle game, 7 levels, click-only
- [`trajectories/arc3-ls20-cb3b57cc.md`](trajectories/arc3-ls20-cb3b57cc.md) -- Navigation game, 7 levels, directional + click

## Implications for Next Runs

1. **Frame parsing must be fixed**: The app plugin should document the actual frame shape (`[1][64][64]` where `frame[0][row][col]` = color index) more explicitly, or the sandbox should reshape the frame before passing it to the model.
2. **Action semantics need documentation**: The model doesn't know what actions 1-6 do. The plugin should explain: 1=up, 2=down, 3=left, 4=right, 5=interact, 6=click(x,y).
3. **Game-specific strategy hints**: Without understanding what game elements look like (player=color 9 in ls20), the model cannot form strategies. Consider adding per-game hints to the plugin.
4. **Stronger model needed**: Gemini 2.5 Flash struggled with basic data structure comprehension. A stronger model (Opus, Sonnet) may handle this better.
