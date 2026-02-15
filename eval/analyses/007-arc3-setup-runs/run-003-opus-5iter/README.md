# Run 003: Claude Opus 4.6 - 5 Iterations (Budget-Constrained)

**Date:** 2026-02-14
**Branch:** `feat/arc3-benchmark`

## Run Configuration

| Parameter | Value |
|-----------|-------|
| Model | `anthropic/claude-opus-4-6` (via OpenRouter) |
| Max Iterations | 5 |
| Max Depth | 1 (no delegation) |
| Concurrency | 3 |
| Drivers | none |
| App | `arc3-player` |
| Games | all 3 (ls20, ft09, vc33) |

## Summary Results

| Metric | Value |
|--------|-------|
| Total Score | **0.0%** |
| Games Completed | 0 / 3 |
| Levels Completed | 0 / 20 |
| Mean Iterations | 5.0 (all hit limit) |
| Total Wall Time | 1m 37s |
| Mean Wall Time | ~1m 19s per game |
| Input Chars | 291,355 (~72,839 tokens) |
| Output Chars | 39,236 (~9,809 tokens) |
| Est. Cost | $0.37 |

## Per-Game Breakdown

| Game | Task ID | Score | Iters | Wall Time | Win Levels | Actions | Available Actions | Error |
|------|---------|:-----:|:-----:|:---------:|:----------:|:-------:|:-----------------:|-------|
| ls20 | `arc3-ls20-cb3b57cc` | 0 | 5/5 | 1m 1s | 7 | 1,2,3,4 (directional) | timeout |
| vc33 | `arc3-vc33-9851e02b` | 0 | 5/5 | 1m 19s | 7 | 6 (click only) | timeout |
| ft09 | `arc3-ft09-9ab2447a` | 0 | 5/5 | 1m 37s | 6 | 1,2,3,4,5,6 (all) | timeout |

All three games hit the 5-iteration limit without completing any levels or returning a scorecard.

## Notable Observations

### Frame Structure Confusion (Iter 1, all games)
Every game started with the same frame structure bug: the model assumed `frame[y][x]` is a 64x64 grid, but the actual structure is `frame[0][y][x]` (a `[1][64][64]` tensor). This caused a `TypeError: Cannot read properties of undefined` on iter 1 for all three games. Opus recovered on iter 2 by probing the structure dimensions, but this wasted 1 of 5 iterations every time.

### Visualization-First Strategy
All three games showed the same pattern: Opus spent its first 2-3 iterations building visualization infrastructure (mapping values to characters, printing compact grids) rather than taking game actions. This is a good strategy for understanding the puzzle, but catastrophic under a 5-iteration budget.

### Game-Specific Behavior

**ls20 (directional navigation):**
- Successfully visualized the grid and identified key regions (bordered patterns, progress bar, movable blocks)
- Took 2 actions (DOWN, RIGHT) and observed that blocks moved and a progress bar shifted
- Was beginning to understand the game mechanics when iterations ran out
- Key insight discovered: directional keys move colored blocks; progress bar at bottom tracks state

**vc33 (click-based puzzle):**
- Identified a complex layout: left half = input (background 3), right half = output area (background 0)
- Discovered a cross/T shape pattern (values 4, 11) and colored blocks (9s) in specific positions
- Clicked once on (52, 40) and discovered it changed the palette selector at (63, 0) from 7 to 4
- Was analyzing the relationship between input patterns and output area when iterations ran out
- Beginning to understand this as a "paint the output" puzzle

**ft09 (mixed actions):**
- Identified the 3x3 block grid structure with input/output example pairs
- Extracted and compared center block patterns between input and output
- Made a significant analytical insight: the center pattern is shifted RIGHT by 1 column (input col2 dropped, col0 replaced by gray)
- Did NOT take any game actions (all 5 iterations were analysis)
- Was furthest from scoring but closest to understanding the transformation rule

### Iteration Budget Analysis

With only 5 iterations, the effective budget after the frame structure error is 4 iterations. The model's natural exploration-heavy strategy consumed all of them:

| Game | Iter 1 (error) | Iters 2-3 (explore) | Iters 4-5 (first actions) | Remaining |
|------|:-:|:-:|:-:|:-:|
| ls20 | frame error | visualize, analyze | 2 actions taken | 0 |
| vc33 | frame error | visualize, analyze | 1 click (palette) + analysis | 0 |
| ft09 | frame error | visualize, analyze | pattern analysis only | 0 |

## Comparison with Expected Performance at Higher Budgets

At 5 iterations, scoring 0% is expected. The model needs at minimum:
- 1 iter: frame structure discovery (could be eliminated by fixing app plugin documentation)
- 1-2 iters: game visualization and layout understanding
- 1-2 iters: game mechanics discovery (what do actions do?)
- 5+ iters: strategic play per level
- 7 levels per game

So even at 25 iterations (the recommended budget), completing all 7 levels of even one game would be aggressive. A model would need to:
1. Quickly understand the game type (1-2 iters)
2. Formulate a strategy (1 iter)
3. Execute actions efficiently (3-4 iters per level minimum)
4. That's ~25 iterations for 7 levels

At 25 iterations with Opus 4.6, we might expect:
- ls20: possibly 1-3 levels completed (simplest action space)
- vc33: possibly 0-1 levels (click targeting requires understanding the full puzzle)
- ft09: possibly 0-1 levels (complex transformation rule + multi-action interaction)

The key bottleneck is that ARC-3 games are **interactive loops** requiring many observe-act cycles, not one-shot reasoning. The RLM's iteration-per-turn model maps poorly to the rapid action loops these games need. A single iteration should ideally contain a tight `while(!done) { observe(); act(); }` loop rather than one action per iteration.

## Trajectory Files

- [arc3-ls20-cb3b57cc.md](trajectories/arc3-ls20-cb3b57cc.md) - Directional navigation game
- [arc3-vc33-9851e02b.md](trajectories/arc3-vc33-9851e02b.md) - Click-based puzzle game
- [arc3-ft09-9ab2447a.md](trajectories/arc3-ft09-9ab2447a.md) - Mixed-action puzzle game

## Results File

`eval/results/arc3_anthropic_claude-opus-4-6_2026-02-14T23-51-23-102Z.json`
