# Run 020 Analysis: ARC-3 v1.4.0 Orchestrator + Player Plugins

**Date:** 2026-02-16
**Run file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T05-45-10-608Z.json`
**Model:** claude-opus-4-6
**Plugins:** arc3-orchestrator v1.4.0 + arc3-player v1.4.0
**Config:** maxIterations=30, maxDepth=2, concurrency=5
**Score:** 2.8% (1/7 levels completed)
**Prior run (run-019, v1.3.0):** 0% (0/7 levels, 154 actions, $3.87)
**Prior best (run-015, no plugin):** 14.3% (1/7 levels, 18 actions on Level 1)
**Replay:** https://three.arcprize.org/scorecards/041168f5-bf04-4d77-aec2-3f733e515eca

---

## 1. Score Breakdown

### Scorecard

| Field | Value |
|-------|-------|
| Final Score | 2.799% |
| State | GAME_OVER |
| Total Actions | 380 |
| Levels Completed | 1 / 7 |
| Resets | 0 |
| Environments Completed | 0 / 1 |

### Per-Level Breakdown

| Level | Actions Used | Baseline Actions | Score | Status |
|-------|-------------|-----------------|-------|--------|
| 1 | 148 | 29 | 19.59 | Completed |
| 2 | 232 | 41 | 0 | Not completed |
| 3 | 0 | 172 | 0 | Not attempted |
| 4 | 0 | 49 | 0 | Not attempted |
| 5 | 0 | 53 | 0 | Not attempted |
| 6 | 0 | 62 | 0 | Not attempted |
| 7 | 0 | 82 | 0 | Not attempted |

**Total baseline actions (all 7 levels):** 488

### Score Calculation

The ARC-3 scoring formula is `baseline_actions / ai_actions` per level, capped at 1.0, then averaged across all 7 levels.

- Level 1: min(29/148, 1.0) = 0.19595 = 19.6%
- Level 2-7: 0
- Average: 19.595 / 7 = **2.799%**

### Efficiency Analysis

Level 1 was completed at 5.1x the human baseline (148 vs 29 actions). This represents extremely inefficient play -- the agent used over 5 times the optimal number of moves. By contrast, the no-plugin run-015 completed Level 1 in 18 actions (0.62x baseline, actually beating the human), scoring the full 100% for that level.

Level 2 consumed 232 actions without completion, burning through the remaining action budget and triggering GAME_OVER. The baseline for Level 2 is only 41 actions, meaning the agent used 5.7x the baseline without even finishing.

---

## 2. Plugin Compliance

### Orchestrator Compliance (arc3-orchestrator v1.4.0)

| Rule | Compliant? | Evidence |
|------|-----------|---------|
| `arc3.start()` called exactly once | YES | Iteration 0: single `arc3.start()` call |
| Delegate using `app: "arc3-player"` | MIXED | Used `arc3-player` but varied `model:` param (intelligent, orchestrator, fast) |
| Never call `arc3.step()` | **VIOLATED** | See below -- orchestrator never called `arc3.step()` directly BUT analyzed the grid |
| Never analyze/print the grid | **VIOLATED** | Iterations 4-6: printed full grid, computed color counts, bounding boxes |
| Max 2 delegation attempts per level | **VIOLATED** | Level 1 received 3+ delegation attempts; Level 2 received 4+ |
| Pass knowledge via `__level_task` | YES | Correctly set `__level_task` before each delegation |
| Return scorecard on GAME_OVER | YES | Iteration 15: returned JSON scorecard |
| Track `__outerIter` | PARTIAL | Tracked but inconsistently incremented |

**Critical violation: Grid analysis by orchestrator.** The plugin states: "You MUST NOT analyze, print, or inspect the grid from the orchestrator -- that is the child's job." Despite this, iterations 4 through 6 contain extensive grid analysis:

- Iteration 4: Computed `colorCounts` and `colorBounds` for all non-zero pixels
- Iteration 5: Printed every-other-row hex dump of entire 64x64 grid
- Iteration 6: Printed full-resolution hex dump of rows 50-63

This analysis consumed 3 outer iterations that should have been used for delegation. While the orchestrator never called `arc3.step()` (maintaining that constraint from v1.3.0), it violated the spirit of the delegation model by doing the child's perceptual work.

**Critical violation: Exceeded 2 attempts per level.** The plugin specifies "NEVER spend more than 2 delegation attempts on a single level." The orchestrator spent at least 3 delegation attempts on Level 1 (iterations 1, 3, and 7) and at least 4 on Level 2 (iterations 9, 11, 13, and 14), grossly exceeding the cap. At no point did the orchestrator skip a failed level.

**New violation: Model parameter experimentation.** The orchestrator varied the `model` parameter across delegations (`"intelligent"`, `"orchestrator"`, `"fast"`), which is not part of the plugin template. This was a creative attempt to work around the API 401 error at iteration 7, but represents prompt deviation.

### Player Compliance (arc3-player v1.4.0)

Without child traces, compliance must be inferred from observable outcomes:

| Rule | Inference | Evidence |
|------|-----------|---------|
| `__guard()` called as first line | LIKELY NOT | Children consumed 25-62+ actions per delegation, exceeding the 25-action budget |
| `step()` wrapper used | LIKELY NOT | Children did not detect GAME_OVER and return (iterations 7, 9, 11) |
| `__discover()` called in iteration 1 | UNKNOWN | Cannot verify without traces |
| Return before timeout | MIXED | 6 of ~8 children timed out; Level 1 completion child may have returned via `step()` auto-detect |
| Never call `arc3.start()` | YES (inferred) | No game resets observed |

**Did `__guard()` fire?** The `__guard()` function checks two conditions: (1) iteration count >= 12, and (2) action count > 25. Evidence suggests it did NOT fire for most children:

- Child 1 (iter 1): Used ~58 actions across all 30 child iterations. If `__guard()` fired at iteration 12 or action 25, the child would have set `__level_result` and returned. Instead, the child timed out with empty output. The guard either was not called or was not present in every code block.
- Child 2 (iter 3): Used ~77 actions (135 - 58). Same pattern -- timed out.
- Child 4 (iter 7, model: orchestrator): Started at 149 actions, ended at 202. Used 53 actions. The child timed out, but crucially, **level 1 was completed during this child's run** (levels_completed went from 0 to 1). This suggests the `step()` wrapper's level-completion detection may have set `__level_result`, but the child did not call `return()`.

**Did children return results?** A breakthrough finding: **at least one child functionally completed Level 1** (iter 7 child advanced levels_completed from 0 to 1). However, the orchestrator received an empty string from the `rlm()` call paired with "RLM reached max iterations (30) without returning an answer." This means:

1. The `step()` wrapper likely detected level completion and set `__level_result`
2. But the child never called `return()` to send the result back to the orchestrator
3. The `__level_result` was set in the child's sandbox but the child continued iterating until timeout

This is a partial success for the persistent function architecture: `step()` did its job (detected completion), but the child did not use the detection signal to return early.

### Summary of Protocol Violations

1. **Orchestrator analyzed grid** (iterations 4-6) -- violated "never inspect the grid" rule
2. **Exceeded 2 attempts per level** -- Level 1 got 3+ attempts, Level 2 got 4+
3. **Orchestrator never skipped a level** -- violated escalation protocol
4. **Model parameter experimentation** -- used "orchestrator" and "fast" models not in template
5. **Grid hints inlined in delegation prompts** (iteration 7) -- violated "do not inline game data in prompts"
6. **Children did not return via `__guard()`** -- the persistent function architecture did not solve the return problem

---

## 3. Knowledge Discovery

### What Mechanics Were Discovered?

Since no child returned `__level_result` with knowledge, and the `__knowledge` object remained empty throughout, the **formal knowledge accumulation was zero** -- identical to v1.3.0.

However, the orchestrator's grid analysis (violations though they were) produced some implicit knowledge:

| Discovery | Source | Accuracy | Notes |
|-----------|--------|----------|-------|
| Grid has colored regions | Iter 4 colorCounts | Correct but shallow | Identified colors 3, 4, 5, 8, 9, 11, 12 |
| Color bounding boxes | Iter 4 colorBounds | Correct | Mapped spatial extent of each color |
| Maze-like structure | Iter 5-6 grid dump | Correct | Recognized "box-like structures" and paths |
| Character-like object | Iter 7 hint text | Partially correct | Identified "9-colored pixels" and "12/c-colored pixels" as key |
| Sokoban-like puzzle hypothesis | Iter 7 hint text | Incorrect | Game is maze navigation, not Sokoban |

### Comparison to Canonical Rules

| # | Canonical Discovery | v1.4.0 Status | Notes |
|---|---------------------|:---:|---|
| 1 | Character identification (5x5 block, orange top/blue bottom) | PARTIAL | Orchestrator identified pixel colors but not the character structure |
| 2 | Movement mechanics (5px steps, 4 directions) | UNKNOWN | Children moved (58+ actions on Level 1) but no trace data |
| 3 | Wall detection | UNKNOWN | Children navigated but no returned knowledge |
| 4 | Fuel depletion | MISSED | Not identified in any trace output |
| 5 | Fuel refill (yellow box) | MISSED | Not identified |
| 6 | Lives counter (3 red squares) | MISSED | GAME_OVER occurred but cause not connected to lives |
| 7 | Pattern toggle (white cross) | MISSED | Color 12 identified in grid but not as pattern toggle |
| 8 | Color changer (rainbow box) | MISSED | Not identified |
| 9 | Goal icon identification | PARTIAL | Orchestrator saw "framed boxes" in grid dump but did not identify as goal |
| 10 | Current pattern display (bottom-left HUD) | PARTIAL | Bottom-left box visible in grid dump (rows 53-62, cols 1-10) but not interpreted as HUD |
| 11 | Pattern matching requirement | MISSED | Not discovered |
| 12 | Strategic sequencing | MISSED | Not discovered |
| 13 | Fog of war (Level 7) | N/A | Never reached Level 7 |

### Discovery Scoring

**Effective discovery score:** 0 full, 2 partial = ~1.0 effective

This is an improvement over v1.3.0's 0.0 but comes entirely from the orchestrator's rule-violating grid analysis. The delegation architecture itself still transfers zero knowledge.

---

## 4. Structural Analysis

### Children Spawned and Returned

Counting distinct `rlm()` calls in the trace:

| # | Iteration | Level | Model | maxIterations | Actions Consumed | Returned? | Outcome |
|---|-----------|-------|-------|---------------|-----------------|-----------|---------|
| 1 | 1 | 1 | intelligent | 25 | ~58 | No (timeout) | "RLM reached max iterations (30)" |
| 2 | 3 | 1 | intelligent | 25 | ~77 | No (timeout) | "RLM reached max iterations (30)" |
| 3 | 7 | 1 | orchestrator | 25 | ~53 | No (timeout) | **Level 1 completed during run** but child timed out |
| 4 | 7 (retry) | 1 | -- | -- | -- | N/A | API 401 error prevented delegation |
| 5 | 9 | 2 | fast | 20 | ~28 | No (timeout) | "RLM reached max iterations (30)" |
| 6 | 11 | 2 | fast | 8 | ~62 | No (timeout)* | "RLM reached max iterations (30)" |
| 7 | 13 | 2 | fast | 3 | ~88 | **YES** | Returned scorecard JSON (GAME_OVER) |

*Note: Child 6 was given maxIterations=8 but the engine gave it 30. It consumed 62 actions.

**Children spawned:** 7 (one failed due to API error, so 6 actual)
**Children that returned:** 1 (Child 7, but only because the game reached GAME_OVER and the child returned the scorecard, not `__level_result`)
**Children that returned `__level_result`:** 0
**Children that returned useful knowledge:** 0

### The "Max 2 Attempts Per Level" Rule

**Grossly violated.**

- Level 1: At least 3 child delegations (iterations 1, 3, 7) plus failed API attempt
- Level 2: At least 3 child delegations (iterations 9, 11, 13)
- No level was ever skipped

The orchestrator did not follow the escalation protocol at all. After 2 failed delegations on Level 1, it should have skipped to Level 2. Instead, it analyzed the grid itself (iterations 4-6), then delegated Level 1 a third time with hints derived from its grid analysis (iteration 7). This pattern repeated for Level 2.

### Did the Orchestrator Analyze the Grid?

**Yes, extensively.** Three full iterations (4, 5, 6) were spent on grid analysis:

- **Iteration 4:** Computed color frequency counts, bounding boxes for all colored regions
- **Iteration 5:** Printed hex dump of entire grid at 2-row stride (32 rows of output)
- **Iteration 6:** Printed hex dump of rows 50-63 at full resolution (14 rows of output)

This analysis was used to construct the `hint` field in the iteration 7 delegation, which included specific row/column coordinates and structural descriptions. This directly violates: "You MUST NOT analyze, print, or inspect the grid from the orchestrator."

### Action Economy

| Phase | Iterations | Actions | Actions/Iteration |
|-------|-----------|---------|-------------------|
| Initialization | 0 | 0 | 0 |
| Child 1 (Level 1) | 1 | ~58 | ~1.9/child-iter |
| Child 2 (Level 1) | 3 | ~77 | ~2.6/child-iter |
| Grid analysis | 4-6 | 0 | 0 |
| Child 3 (Level 1) | 7 | ~53 | ~1.8/child-iter |
| State check | 8 | 0 | 0 |
| Child 4 (Level 2) | 9 | ~28 | ~0.9/child-iter |
| State check | 10 | 0 | 0 |
| Child 5 (Level 2) | 11 | ~62 | ~2.1/child-iter |
| State check | 12 | 0 | 0 |
| Child 6 (Level 2, GAME_OVER) | 13 | ~88 | ~29/child-iter* |
| State check | 14 | 0 | 0 |
| Return scorecard | 15 | 0 | 0 |

*Child 6 only had 3 maxIterations requested but received 30, and triggered GAME_OVER at 380 total actions.

**Orchestrator direct actions:** 0 (maintained from v1.3.0)
**Child actions on Level 1:** 148 + ~40 post-completion = ~188 (58 + 77 + 53 on Level 1 itself)
**Child actions on Level 2:** ~178 (28 + 62 + 88, until GAME_OVER)
**Total wasted actions:** At least 232 (all of Level 2) + ~119 excess on Level 1 (148 - 29 baseline)

---

## 5. Progression Table

| Metric | v1.0.0 (run-016) | v1.1.0 (run-017) | v1.2.0 (run-018) | v1.3.0 (run-019) | v1.4.0 (run-020) |
|--------|:-:|:-:|:-:|:-:|:-:|
| Score | 0% | 0% | 0% | 0% | **2.8%** |
| Levels completed | 0/7 | 0/7 | 0/7 | 0/7 | **1/7** |
| Total actions | 45 | ~80 | 138 | 154 | **380** |
| Actions by orchestrator | ~10 | ~45 | ~43 | 0 | **0** |
| Actions by children | ~35 | ~35 | ~95 | 154 | **380** |
| Final state | NOT_FINISHED | NOT_FINISHED | GAME_OVER | GAME_OVER | **GAME_OVER** |
| Children spawned | 1 | 2 | 3 | 2 | **6** |
| Children returned | 0/1 | 0/2 | 0/3 | 0/2 | **1/6*** |
| Children returned `__level_result` | 0 | 0 | 0 | 0 | **0** |
| Knowledge transferred | 0 | 0 | 0 | 0 | **0** |
| Orchestrator called `arc3.step()` | Yes | Yes | Yes | **No** | **No** |
| Orchestrator analyzed grid | N/A | Yes | Yes | No | **Yes** |
| Task status | Failed | Failed | Failed | Completed | **Completed** |
| Outer iterations used | 15 | 30 | 30 | 6 | **16** |
| Wall time | -- | 17 min | 20 min | 18 min | **41 min** |
| Cost | $0.45 | $4.42 | $4.49 | $3.87 | **$9.13** |
| `arc3.start()` calls | 2 | 2 | 1 | 1 | **1** |
| Escalation protocol followed | N/A | N/A | N/A | Partial | **Violated** |
| Max 2 attempts/level | N/A | N/A | N/A | Yes (by GAME_OVER) | **Violated** |

*Child 7 "returned" the scorecard JSON because the game reached GAME_OVER, not because it returned `__level_result`.

### Structural Progress Metrics

| Metric | v1.0.0 | v1.1.0 | v1.2.0 | v1.3.0 | v1.4.0 | Trend |
|--------|--------|--------|--------|--------|--------|-------|
| Orchestrator respected `arc3.step()` ban | 0 iters | 2 iters | 7 iters | 30 iters | **30 iters** | Stable (fixed) |
| Task status = Completed | No | No | No | Yes | **Yes** | Stable (fixed) |
| `arc3.start()` called exactly once | No | No | Yes | Yes | **Yes** | Stable (fixed) |
| Children returned `__level_result` | 0/1 | 0/2 | 0/3 | 0/2 | **0/6** | **No progress** |
| Knowledge transferred to orchestrator | 0 | 0 | 0 | 0 | **0** | **No progress** |
| A level was completed | No | No | No | No | **Yes** | **NEW** |
| Score > 0 | No | No | No | No | **Yes** | **NEW** |

---

## 6. Root Cause Analysis

### Why did children STILL time out despite persistent `__guard()`?

The v1.4.0 player plugin introduced a fundamentally different approach: instead of asking children to paste a guard at the top of every code block, the guard function is defined once in iteration 0's setup code and persists in the sandbox. The child only needs to write `if (__guard()) return(__guard.msg);` as the first line of each subsequent block.

**Why it failed:** The persistent function is available, but children still must choose to call it. Evidence:

1. **Child 1 (iter 1):** Used ~58 actions. The `__guard()` function's action budget check (>25) should have fired after 25 actions. Since it did not return, the child either (a) did not call `__guard()` at the start of code blocks, or (b) called `arc3.step()` directly instead of `step()`, bypassing the `__actionsThisLevel` counter.

2. **Child 6 (iter 11, maxIterations=8):** Used ~62 actions in what the orchestrator requested as 8 iterations but the engine gave 30. If `__guard()` was being called, the iteration counter would have triggered at iteration 12. The fact that 62 actions were consumed suggests many iterations ran without the guard.

3. **Possible bypass of `step()` wrapper:** If children called `arc3.step()` directly instead of `step()`, the action counter `__actionsThisLevel` would not increment, and `__guard()`'s action budget check would never fire. The iteration counter check (`__iterCount >= 12`) would still work if called -- but 30 iterations were consumed, meaning even the iteration check was not called consistently.

**Root cause:** The persistent function architecture reduces the compliance burden (one line vs four lines) but does not eliminate it. The model still has to (a) know the function exists, (b) remember to call it, and (c) call it in every code block without exception. Evidence across 6 children suggests this compliance rate is very low -- perhaps ~0-20% of code blocks include the guard call.

**The deeper issue:** `maxIterations` in the `rlm()` call is not honored by the engine. Every child gets the parent's 30 iterations regardless of the requested cap. This means prompt-based iteration guards are the ONLY mechanism to limit child runtime, and they have failed in 100% of cases across 14 children in 5 runs.

### Why did Level 1 eventually complete?

Level 1 was completed during Child 3's run (iteration 7, using `model: "orchestrator"`). The key evidence:

- Before Child 3: `levels_completed = 0`, `arc3.actionCount = 135`
- After Child 3: `levels_completed = 1`, `arc3.actionCount = 202`

Child 3 used approximately 53 actions on Level 1 (but the total Level 1 action count was 148, including actions from Children 1 and 2 that did not complete it). The child received a detailed hint from the orchestrator about the grid structure, including specific row/column coordinates of colored regions and a hypothesis about Sokoban-like mechanics.

**What mechanism caused completion?** Without child traces, two hypotheses:

1. **Brute force:** 148 total actions on a level with 29-action baseline means the agent moved roughly 5x more than necessary. In a maze game with only 4 directional actions, random walking will eventually reach the goal. The maze is finite, and with enough moves, the character will stumble onto the correct path, interact with the right toggles by accident, and reach the goal. 148 actions is plausible for random-walk completion of a small maze.

2. **Partially guided play:** Child 3 received specific grid coordinates from the orchestrator's analysis. If it used these to navigate toward notable features (the boxes at specific row/col positions), it may have reached the goal semi-intentionally. The hint text mentioned "pattern toggles" and "goal" concepts, which could have guided the child toward correct interactions.

The more likely explanation is a combination: the child explored semi-randomly with some guidance from the hints, and the small Level 1 maze was simple enough that 148 actions sufficed for accidental completion. The 19.6% score (5.1x baseline) is consistent with brute-force completion rather than strategic play.

### Why did GAME_OVER occur at 380 actions?

The ARC-3 game has a fuel system and lives:
- Each movement action depletes the fuel bar by one unit
- When fuel runs out, the character loses a life
- The character has 3 lives
- Losing all 3 lives triggers GAME_OVER

The 380-action GAME_OVER is consistent with the fuel/lives system. After completing Level 1 at 148 actions, the agent had already depleted significant fuel. On Level 2, 232 additional actions were taken without completing the level, eventually exhausting all fuel and all 3 lives.

The lack of fuel refill discovery is the key factor. The canonical rules describe fuel refill icons (yellow box with dark center) that completely restore the fuel bar. No run in the series has ever discovered or used fuel refills. If the agent had discovered refueling, the action budget per life would be dramatically higher, allowing more exploration time on each level.

**Action budget estimate per life:** If GAME_OVER occurred at 380 actions with 3 lives and no refueling, each life provides roughly 127 actions of fuel. This is consistent with a full fuel bar lasting approximately 127 steps. Some fuel was consumed on Level 1 (148 actions) but the level completion may have reset or partially restored fuel.

---

## 7. Recommendations for v1.5.0

### R1 (P0): Enforce child iteration cap at the harness level

**Problem:** The `maxIterations` parameter in `rlm()` is not honored. Children always get the parent's 30 iterations. This has been the #1 root cause of child timeout across all 5 runs (14/14 children exceeded their requested iteration cap).

**Fix:** This is a harness/engine change, not a plugin change, but it is the single highest-impact intervention possible. If children were actually capped at 15 or 25 iterations, they would be forced to return or timeout quickly, conserving actions and enabling more delegation cycles within the parent's 30-iteration budget.

If the harness cannot be changed, every other recommendation is a workaround for this fundamental limitation.

### R2 (P0): Make `__guard()` fire automatically via the `step()` wrapper, not via manual calls

**Problem:** The `__guard()` function exists in the sandbox but children do not call it. The compliance rate across 6 children is effectively 0%.

**Fix:** Instead of requiring children to call `__guard()` at the top of every code block, make the `step()` wrapper itself enforce the budget and return a sentinel value:

```javascript
async function step(action) {
  __actionsThisLevel++;
  if (__actionsThisLevel > 25) {
    __level_result = { knowledge: __k, actions: __actionsThisLevel, completed: false, reason: 'budget' };
    return { state: 'BUDGET_EXCEEDED', frame: [arc3.observe().frame[0]], levels_completed: 0, available_actions: [] };
  }
  const result = await arc3.step(action);
  if (result.state === 'GAME_OVER' || result.levels_completed > __startLevel) {
    __level_result = { knowledge: __k, actions: __actionsThisLevel,
      completed: result.levels_completed > __startLevel, reason: result.state };
    // Set a global flag the child can check
    __done = true;
  }
  return result;
}
```

This way, even if children call `step()` 100 times, the 26th call returns a fake "budget exceeded" result and sets `__level_result`. The child may not return cleanly, but at least the knowledge is captured and the action count is capped.

**Additionally:** Override `arc3.step` itself in the setup block:

```javascript
const __originalStep = arc3.step.bind(arc3);
arc3.step = async function(action) {
  __actionsThisLevel++;
  if (__actionsThisLevel > 25) { /* same budget enforcement */ }
  return __originalStep(action);
};
```

This ensures even children who call `arc3.step()` directly (bypassing `step()`) still have their actions counted and capped.

### R3 (P1): Strictly enforce the 2-attempt-per-level escalation protocol

**Problem:** The orchestrator spent 3+ attempts on Level 1 and 3+ on Level 2, with grid analysis in between. It never skipped a level. The escalation protocol was completely ignored.

**Fix:** Make the orchestrator's iteration plan deterministic by encoding it as a state machine rather than guidelines:

```javascript
// In iteration 0 setup:
__levelAttempts = {};  // { levelNum: attemptCount }

// In delegation block:
const level = obs.levels_completed + 1;
__levelAttempts[level] = (__levelAttempts[level] || 0) + 1;
if (__levelAttempts[level] > 2) {
  console.log(`Skipping level ${level} (2 attempts exhausted). Moving to level ${level + 1}.`);
  // Force-advance by delegating next level
  // ...
}
```

The key insight: the "skip" logic needs to be in the code template, not the English instructions. The orchestrator follows code templates more reliably than prose rules.

### R4 (P1): Remove the ability for the orchestrator to analyze the grid

**Problem:** Despite clear instructions, the orchestrator analyzed the grid in 3 of 16 iterations. The v1.3.0 declarative framing ("you do not have access to arc3.step()") worked for `arc3.step()` but the equivalent for grid analysis ("you MUST NOT analyze the grid") was normative and failed.

**Fix:** Apply the same declarative framing that worked for `arc3.step()`:

```markdown
**You CANNOT interpret the grid data.** The `arc3.observe().frame` contains raw pixel indices that require specialized vision algorithms (findComponents, diffGrids, colorFreqs) which are only available in the child's sandbox. You do not have these functions. If you try to analyze pixel data, your analysis will be wrong because you lack the perceptual toolkit.
```

Frame it as a capability limitation (you lack the tools) rather than a behavioral prohibition (you must not do this).

### R5 (P2): Reduce child action budget to 20 and make the `__discover()` function use `step()` wrapper

**Problem:** The `__discover()` function in the v1.4.0 player plugin calls `step(action)` which correctly tracks actions, but children doing additional exploration after discovery use many more actions. The 25-action budget is too generous given that children do not return results.

**Fix:** Lower the budget to 20 (enough for 4 discovery actions + ~16 gameplay actions) and ensure the `__discover()` function counts against this budget (which it already does through `step()`). The lower budget means each child's impact on the total action economy is smaller, allowing more delegation attempts before GAME_OVER.

With 20 actions per child and ~380 total actions before GAME_OVER, the orchestrator could attempt ~19 child delegations instead of ~6. Even with the current 0% return rate, more attempts increase the probability of accidental level completion (as demonstrated by Level 1).

---

## 8. What Improved vs v1.3.0

### 1. First non-zero score in the plugin series (MAJOR)

v1.4.0 achieved 2.8% -- the first non-zero score across v1.0.0 through v1.4.0. While modest (and far below the no-plugin baseline of 14.3%), this demonstrates that the delegation architecture CAN produce game progress. Level 1 was completed, breaking the 0-level barrier.

### 2. A child completed a level (MAJOR)

For the first time, a child agent caused a level to advance. Child 3 (using `model: "orchestrator"`) completed Level 1 during its run. This happened through extended play rather than strategic play, but it proves that children can interact meaningfully with the game.

### 3. More children spawned (MODERATE)

6 children were spawned (up from 2 in v1.3.0). The orchestrator used more of its iteration budget for delegation, though it also wasted iterations on grid analysis. More children means more chances for accidental progress.

### 4. Orchestrator maintained `arc3.step()` ban (MAINTAINED)

The `arc3.step()` prohibition held for the second consecutive run. This is now a solved problem at the prompt level.

### 5. Cost increased significantly ($9.13 vs $3.87) (REGRESSION)

Cost more than doubled, driven by more children (each costing ~$1.50 in tokens) and more outer iterations (16 vs 6). The cost per level completed is $9.13 -- not economically viable, but at least the denominator is now non-zero.

---

## 9. What Still Fails

### Failure 1: Zero children returned `__level_result` (CRITICAL -- STILL #1 BLOCKER)

Despite persistent `__guard()`, `step()`, and `__discover()` functions, zero out of 6 children returned `__level_result` to the orchestrator. The knowledge transfer pipeline remains completely broken. Cross-run total: **0 out of 14 children across 5 runs have returned `__level_result`.**

The persistent function architecture was the right idea but insufficient. The functions exist in the sandbox, but children must still (a) call `__guard()` in every code block and (b) call `return()` when the guard fires. Evidence suggests children do neither consistently.

### Failure 2: Orchestrator violated multiple protocol rules (SEVERE)

v1.4.0 saw more orchestrator violations than v1.3.0:
- Grid analysis in 3 iterations (v1.3.0: 0)
- Exceeded 2-attempt-per-level cap (v1.3.0: compliant)
- Inlined grid hints in prompts (v1.3.0: did not)
- Model parameter experimentation (v1.3.0: did not)

The orchestrator's discipline regressed. The v1.3.0 orchestrator was a cleaner manager; the v1.4.0 orchestrator was more "creative" but less compliant.

### Failure 3: Massive action waste (SEVERE)

380 total actions -- the highest in the series (up from 154 in v1.3.0). Only 148 were productive (Level 1). 232 were spent on Level 2 without completion. The action economy is catastrophic: 61% of all actions produced zero score.

### Failure 4: No knowledge accumulation across levels (PERSISTENT)

With 0 children returning `__level_result`, the `__knowledge` object remained empty for the entire run. Level 2 children received zero knowledge from the Level 1 experience. Each child started from scratch. This is the fundamental promise of the orchestrator architecture -- cross-level learning -- and it has never worked.

---

## 10. Appendix

### A. Iteration Trace

| Iter | Code Blocks | Game Actions | Cumulative Actions | Key Event |
|------|------------|-------------|-------------------|-----------|
| 0 | 1 | 0 | 0 | `arc3.start()` executed. Correctly emitted single block. |
| 1 | 1 | ~58 | 58 | Delegated Level 1 (model: intelligent, maxIter: 25). Child timed out. |
| 2 | 1 | 0 | 58 | State check. Level still 0, 58 actions consumed. |
| 3 | 1 | ~77 | 135 | Delegated Level 1 retry (model: intelligent, maxIter: 25). Child timed out. |
| 4 | 1 | 0 | 135 | **VIOLATION:** Orchestrator analyzed grid -- colorCounts, colorBounds. |
| 5 | 1 | 0 | 135 | **VIOLATION:** Printed hex grid dump (every 2nd row). |
| 6 | 1 | 0 | 135 | **VIOLATION:** Printed detailed grid dump (rows 50-63). |
| 7 | 1 | ~14 + API err | 149 | Delegated Level 1 with hints (model: orchestrator, maxIter: 25). Child advanced Level 1 to complete (148 actions on L1). Then timed out. API 401 error on "intelligent" model retry. |
| 8 | 1 | ~53 | 202 | Delegated Level 1 again (model: orchestrator, maxIter: 25). Child timed out. Post: levels_completed=1, 202 actions. **Note: orchestrator said "level 2" but this child ran post-Level-1-completion.** |
| 9 | 1 | ~28 | 230 | Delegated Level 2 (model: fast, maxIter: 20). Child timed out. |
| 10 | 1 | 0 | 230 | State check. Level 2, 230 actions. |
| 11 | 1 | ~62 | 292 | Delegated Level 2 minimal (model: fast, maxIter: 8). Child timed out after 62 actions. |
| 12 | 1 | 0 | 292 | State check. Level 2, 292 actions. |
| 13 | 1 | ~88 | 380 | Delegated Level 2 micro (model: fast, maxIter: 3). Child returned scorecard JSON. GAME_OVER at 380 actions. |
| 14 | 1 | 0 | 380 | State check. Confirmed GAME_OVER. |
| 15 | 1 | 0 | 380 | Returned final scorecard. Task completed. |

### B. Action Attribution by Level

| Level | Child | Actions by This Child | Cumulative on Level | Child Returned? |
|-------|-------|----------------------|---------------------|-----------------|
| 1 | Child 1 | ~58 | 58 | No |
| 1 | Child 2 | ~77 | 135 | No |
| 1 | Child 3 | ~13 | 148 | No (but completed level) |
| (post-L1) | Child 3 cont'd | ~1 | -- | No |
| 2 | Child 4 (post-L1 overlap) | ~53 | 53 | No |
| 2 | Child 5 | ~28 | 81 | No |
| 2 | Child 6 | ~62 | 143 | No |
| 2 | Child 7 | ~88 | 232* | Yes (GAME_OVER scorecard) |

*Level 2 actions total to 232 as reported in scorecard.

### C. Cost Efficiency

| Run | Cost | Score | Cost per % | Children | Cost per Child | Levels | Cost per Level |
|-----|------|-------|-----------|----------|----------------|--------|----------------|
| v1.0.0 | $0.45 | 0% | N/A | 1 | $0.45 | 0 | N/A |
| v1.1.0 | $4.42 | 0% | N/A | 2 | $2.21 | 0 | N/A |
| v1.2.0 | $4.49 | 0% | N/A | 3 | $1.50 | 0 | N/A |
| v1.3.0 | $3.87 | 0% | N/A | 2 | $1.94 | 0 | N/A |
| **v1.4.0** | **$9.13** | **2.8%** | **$3.26/%** | **6** | **$1.52** | **1** | **$9.13** |
| run-015 (no plugin) | -- | 14.3% | -- | 0 | N/A | 1 | -- |

### D. Key Question for v1.5.0: Is the Delegation Architecture Viable?

The evidence after 5 runs is mixed:

**Arguments FOR continuing with delegation:**
- v1.4.0 is the first non-zero score, showing the architecture can produce progress
- Orchestrator discipline problems (arc3.step() calls, double starts) are solved
- The persistent function architecture is the right pattern -- it just needs stronger enforcement
- Level 1 was completed through a child, not orchestrator direct play

**Arguments AGAINST (or for paradigm shift):**
- 0/14 children have returned `__level_result` across 5 runs
- Knowledge transfer has never worked -- the core promise of the architecture
- The no-plugin baseline (run-015, 14.3%) outperforms all 5 plugin runs
- Cost is escalating ($0.45 to $9.13) without proportional score gains
- The one level completed was likely through brute force, not learned strategy

**Assessment:** The delegation architecture is architecturally sound but implementation-blocked by the child return problem. The harness-level `maxIterations` not being honored is the root cause. If this single harness fix is made, the entire architecture could work: children would be forced to return within budget, knowledge would flow back, and later children would benefit from earlier discoveries.

Without the harness fix, the plugin-only path has diminishing returns. The persistent function approach (v1.4.0) was the strongest prompt-level intervention attempted, and it still achieved 0% child return rate for `__level_result`. Further prompt engineering is unlikely to solve a problem that is fundamentally about engine-level iteration control.

**Recommended path for v1.5.0:** Implement R1 (harness-level child cap) and R2 (auto-enforcement via step wrapper override). If the harness cannot be changed, implement R2 alone and accept that progress will come from accidental level completion (brute force) rather than learned strategy. In that case, optimize for maximum delegation attempts (lower action budget per child, faster timeout) to maximize the probability of brute-force completion across all 7 levels.
