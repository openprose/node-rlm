# Run 007: Claude Opus 4.6 - 50 Iterations, Single Game (ls20) - Plugin v2

**Date:** 2026-02-15
**Branch:** `feat/arc3-benchmark`

## Run Configuration

| Parameter | Value |
|-----------|-------|
| Model | `anthropic/claude-opus-4-6` (via OpenRouter) |
| Max Iterations | 50 |
| Max Depth | 2 (delegation enabled) |
| Concurrency | 1 |
| Drivers | none |
| App | `arc3-player-v2` (frame shape docs, action loop guidance, phased strategy) |
| Games | 1 (`ls20` only) |
| Rate Limit | 5 req/s (burst: 10) |

### Run Command

```bash
npx tsx eval/run.ts --benchmark arc3 --game ls20 --model anthropic/claude-opus-4-6 \
  --max-iterations 50 --max-depth 2 --concurrency 1 --app arc3-player-v2
```

## Summary Results

| Metric | Value |
|--------|-------|
| Total Score | **0.0%** |
| Levels Completed | 0 / 7 |
| Game Actions Taken | ~137 |
| Mean Iterations | 50.0 (hit limit) |
| Total Wall Time | 18m 43s |
| Input Chars | 5,785,520 (~1,446,380 tokens) |
| Output Chars | 131,012 (~32,753 tokens) |
| Est. Cost | $4.83 (at Sonnet 4.5 pricing) |

### Per-Level Breakdown

| Level | Completed | Agent Actions | Human Baseline | Efficiency |
|:-----:|:---------:|:------------:|:--------------:|:----------:|
| 1 | No | 137+ | 29 | 0.0 |
| 2 | No | 0 | 41 | 0.0 |
| 3 | No | 0 | 172 | 0.0 |
| 4 | No | 0 | 49 | 0.0 |
| 5 | No | 0 | 53 | 0.0 |
| 6 | No | 0 | 62 | 0.0 |
| 7 | No | 0 | 82 | 0.0 |

The agent spent all 137+ game actions on level 1 without completing it. The game ended (progress bar exhausted) before the RLM iteration budget was exhausted. The last 8 iterations (42-49) received "Game already completed" errors.

## Scorecard (from ARC-3 API at action 122)

```json
{
  "level_actions": [122, 0, 0, 0, 0, 0, 0],
  "level_baseline_actions": [29, 41, 172, 49, 53, 62, 82],
  "levels_completed": 0
}
```

## Comparison with Run-006 (Same Model, Same Plugin, 5 Iterations)

| Metric | Run-006 (5 iter) | Run-007 (50 iter) | Delta |
|--------|:----------------:|:-----------------:|:-----:|
| Total Score | 0.0% | 0.0% | 0 |
| Levels Completed | 0 | 0 | 0 |
| Game Actions (ls20) | 13 | ~137 | +124 |
| Iterations Used | 5/5 | 50/50 | +45 |
| Wall Time | ~1m 18s | 18m 43s | +17m 25s |
| Input Chars | 357,284 | 5,785,520 | +16x |
| Output Chars | 41,241 | 131,012 | +3.2x |
| Est. Cost | $0.42 | $4.83 | +11.5x |
| Frame Error | No | No | same |
| Core Mechanic Discovered | Partial (block movement) | Yes (cursor transforms) | improved |
| Sub-puzzle Solved | No | Yes (at least 2) | improved |
| llm() Calls | 0 | 2 | +2 |
| rlm() Calls | 0 | 1 (failed) | +1 |

### Did 10x More Iterations Help?

**Mechanistic understanding: YES, substantially.** Run-006 (5 iterations) only discovered that directional keys move a colored block along corridors. Run-007 (50 iterations) discovered the complete game mechanic:

1. Cross-shaped maze with 5-wide corridors and a fixed cursor
2. Block slides in 5-pixel steps, interacts with cursor on overlap
3. Reference display transforms based on direction of arrival at cursor
4. Certain approach sequences "solve" a sub-puzzle (reference goes empty, progress bar advances)
5. Multiple sub-puzzles needed per level

**Score outcome: NO.** Despite 10x more iterations and discovering the complete mechanic, the agent still scored 0.0%. The bottleneck shifted from "not enough iterations to discover mechanics" to "unable to exploit discovered mechanics efficiently."

### Why 50 Iterations Still Wasn't Enough

The iteration budget was technically sufficient. The real problem was how the agent used its iterations:

| Phase | Iterations | Actions | Purpose |
|-------|:----------:|:-------:|---------|
| Visualization/Setup | 0-4 | 12 | Render grid, probe actions, map corridors |
| Navigate to cursor | 5-6 | 9 | Move block to cursor position |
| Pattern analysis | 7-14 | ~15 | Discover cursor transforms, first "solve" event |
| Transform mapping | 15-22 | ~30 | LLM/RLM delegation, column offset analysis |
| Repeated cycling | 23-37 | ~50 | Same transforms rediscovered repeatedly |
| Right-area exploration | 38-42 | ~20 | Explored empty area, game ended |
| Game over | 42-49 | 0 | "Game already completed" errors |

The agent achieved its first sub-puzzle solve at **action 47** (iter 13). If it had recognized this as progress and continued with a tight loop, it could have completed level 1 within the 29-action human baseline. Instead, it spent 90+ more actions (iters 14-42) trying to understand why the level didn't complete, never grasping that multiple sub-puzzles are needed per level.

## Plugin v2 Effectiveness Analysis

### Frame Shape Fix
**Effective.** Zero frame access errors (vs run-003 which lost iteration 1 to TypeError). Agent correctly used `frame.frame[0]` from the first code block.

### Utility Functions (copyGrid, diffFrames, gridSummary, renderRegion)
**Used extensively.** The agent copied all four utility functions verbatim from the plugin template in iteration 0. `diffFrames` was the primary learning tool throughout, used in every action-taking iteration. `renderRegion` was used for detailed area inspection. The utilities worked correctly and saved significant code-writing time.

### Phased Strategy (Orient / Execute / Adapt)
**NOT followed.** The plugin advises:
- Orient (iter 0-2): Probe and understand
- Execute (iter 3+): Write tight game loops with many actions per iteration
- Adapt (ongoing): Check progress, change strategy if stuck

The agent's actual behavior:
- Iter 0-4: Orient (roughly on track)
- Iter 5-6: Brief execution burst (navigate to cursor)
- Iter 7-49: Continuous exploration/analysis with no game loops

The agent never wrote a `while(!completed)` game loop despite the plugin explicitly recommending it. Every iteration was manual single-step analysis with 1-8 actions. The plugin's advice to "take many actions per iteration" was ignored.

### Actions Per Iteration
**Far below recommended.** The plugin advises "games can require hundreds of actions" per iteration via loops. Actual distribution:

| Actions/iter | Count | Iterations |
|:------------:|:-----:|------------|
| 0 | 12 | Pure analysis, no game actions |
| 1-4 | 20 | Single probes |
| 5-8 | 12 | Short sequences |
| 9+ | 6 | Navigation bursts |

Average: ~2.7 actions/iteration. The human baseline for just level 1 is 29 actions.

### "Return Before Timeout" Guidance
**NOT followed.** The plugin says "If you're in the last few iterations and the game isn't over, get the scorecard and return it anyway." The agent checked the score at action 122 (iter ~38) showing 0 levels completed, but never called `return(JSON.stringify(score))`. It continued exploring until the game ended and iterations expired. If it had returned the scorecard, it would have at least produced an answer (even though the score was 0).

## Notable Observations

### Duplicate Code Blocks (Iter 0)

The model generated 3 near-identical code blocks in iteration 0, each calling `arc3.start()`. The game was restarted 3 times. This is the same behavior observed in run-003 and run-006. The harness executes all code blocks sequentially, so only the last execution's grid state persisted. This wastes API calls but doesn't critically harm the trajectory since the game state is the same after each restart.

### Sub-Puzzle Discovery But Not Exploitation

At iteration 13 (action 47), the agent achieved a verifiable sub-puzzle solve: the reference display went completely empty, the icon display went empty, and the progress bar advanced. This was the breakthrough moment. But the agent's response was to move the block away from the cursor, observe the reference reappearing with a new pattern, and conclude "the level didn't complete." It then spent 37 iterations analyzing why, never realizing that it had in fact made progress and simply needed to keep solving sub-puzzles.

This is a classic case of **partial-understanding paralysis**: the agent understood the transform mechanism well enough to trigger a solve, but not well enough to recognize it as one, because `levels_completed` stayed at 0.

### hasCursor() False Positives

The agent's `hasCursor()` function initially scanned the entire 64x64 grid for colors 0 and 1. When the 0-border appeared around the icon and reference displays during cursor interaction, this produced false positives (detecting "cursor" in the border pixels). The agent eventually narrowed the scan to the play area (rows 25-45, cols 14-54), but this took several iterations to realize.

### rlm() Delegation Failure

At iteration 20, the agent delegated to `rlm()` with a detailed observation context. The child agent (capped at 15 iterations due to max-depth=2) hit its iteration limit without returning an answer. The delegation consumed significant API cost (showed as `[anthropic/claude-opus-4-6 #1] through #19` in stderr) and produced no useful output. The problem was fundamentally not suited for delegation -- it required interactive game manipulation, not text analysis.

### Progress Bar as Action Budget

The progress bar (rows 61-62, cols 13-54) started with 84 color-11 pixels and consumed 2 pixels per action (or per action that "counted"). By action ~88, the agent noted only 3 color-11 pixels remained. The game ended around action 132-137 when the progress bar was fully depleted. The agent never connected progress bar depletion to a game-over condition, continuing to explore the right maze area as the bar ran out.

### Transform Rules Never Fully Resolved

The agent attempted to determine exact transformation rules for each approach direction but never achieved a consistent model. The observed transforms were:
- **UP arrival:** Vertical mirror (swap rows) -- confirmed multiple times
- **DOWN arrival:** Horizontal mirror (mirror each row) OR pattern match (empty ref)
- **LEFT arrival:** Horizontal mirror -- observed but inconsistently
- **RIGHT arrival:** CW rotation OR horizontal mirror -- never pinned down

The inconsistency was likely because the transforms depend on the pre-arrival pattern state, and the agent was testing from different starting states without controlling for this variable.

## Failure Modes

1. **incomplete-mechanic-understanding:** Discovered the cursor transform mechanic and achieved sub-puzzle solves, but failed to understand the sub-puzzle-within-level structure. Interpreted `levels_completed: 0` after a solve as "something is wrong" rather than "keep going."

2. **hypothesis-churn:** Tested 8 hypotheses over 50 iterations, but 6 were rejected and the agent cycled between accepted hypotheses without deepening any of them. Iterations 23-37 showed clear stalling behavior with the same transforms being rediscovered.

3. **catastrophic-forgetting:** Key discoveries from early iterations (empty ref = progress, progress bar = action budget) were not retained in later iterations. The agent re-derived the same transform rules multiple times.

4. **over-analysis, under-action:** The average of 2.7 actions per iteration was far too low for an interactive game. The agent's instinct to analyze before acting dominated despite the plugin's explicit guidance to act early and learn by doing.

## Recommendations for Future Runs

1. **Stronger game-loop mandate in plugin.** The current "write tight game loops" advice is ignored. Consider: "You MUST write a `while(!arc3.completed)` loop that takes at least 20 actions by iteration 3. Do NOT analyze individual frames for more than 2 iterations."

2. **Sub-puzzle concept in plugin.** Add: "Some games have sub-puzzles within levels. Progress bar advancing means you solved a sub-step. Keep going -- `levels_completed` only increments after all sub-puzzles for that level are done."

3. **Progress bar = action budget warning.** Add: "The progress bar at the bottom shows your remaining action budget. When it runs out, the game ends. Monitor it and budget your actions accordingly."

4. **Disable rlm() for ARC-3 games.** The child agent cannot interact with the game and will always fail for interactive tasks. Either disable delegation or pre-populate the child with relevant context.

5. **Higher iteration count is necessary but not sufficient.** 50 iterations provided enough exploration time but the agent didn't transition from exploration to exploitation. The bottleneck is behavioral (the visualization-first instinct), not computational.

## Trajectory Files

- [arc3-ls20-cb3b57cc.md](trajectories/arc3-ls20-cb3b57cc.md) - Full annotated trajectory (50 iterations)

## Results File

`eval/results/arc3_anthropic_claude-opus-4-6_2026-02-15T01-29-12-446Z.json`

## Scorecard

- ID: `3dd81271-48c3-47d9-8434-cfedddd3f389`
- Replay: https://three.arcprize.org/scorecards/3dd81271-48c3-47d9-8434-cfedddd3f389
