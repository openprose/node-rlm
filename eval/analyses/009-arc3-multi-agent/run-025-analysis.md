# ARC-3 Multi-Agent v2.0.0 -- Run 025 Analysis

**Experiment:** `b82bc3f` -- 3-tier delegation for ARC-AGI-3 game `ls20`
**Score:** 0% (1 level completed by game engine, 0 by scoring criteria)
**Comparison baseline:** Prior runs v1.0-v1.8 (single-agent)

---

## 1. Architecture Assessment

### Did the 3-tier structure work as intended?

**Partially.** The architecture successfully demonstrated:
- Reliable child-to-parent knowledge transfer (22 of 23 children returned)
- Structured knowledge accumulation (13 mechanics, 38 rules by end)
- Clean separation of concerns (orchestrator managed strategy, manager coordinated, react played)
- Graceful error handling (API errors caught, budget guards triggered)

**But it catastrophically failed at its core purpose:** enabling the react agent to actually play the game across multiple delegations. The fundamental assumption -- that each new react delegation starts fresh and takes new actions -- was violated by a global state pollution bug.

### The architecture's structural weaknesses

1. **Shared global scope across delegations.** When the orchestrator delegates to a level-manager, which delegates to a react agent, the react agent writes to global variables (`__done`, `__actionsThisLevel`, `__guard`, `__returnPayload`). These globals persist across the entire session. The next react agent inherits these stale values.

2. **Guard-before-setup pattern.** The react agent's code template puts `if (__guard()) return(__guard.msg);` as the first line. This is a safety measure against runaway iterations. But when a previous react left `__done = true`, the guard fires immediately before the new react can reset state. The guard is protecting against the wrong threat.

3. **No state reset between delegations.** The RLM framework preserves global state between `rlm()` calls at the same depth. This is a feature for knowledge persistence but a bug for agent re-initialization. There is no mechanism for the manager to "clean up" the react agent's state before spawning a new one.

4. **Budget accounting is broken.** The orchestrator tracks estimated actions (`__totalActions`) by summing each child's reported action count. But stale react agents report their inherited action count (37) as if they took those actions. The orchestrator believed 254 actions were taken when only 32 actually occurred.

---

## 2. Delegation Efficiency

### API call breakdown by usefulness

| Category | Calls | Useful? | Notes |
|----------|-------|---------|-------|
| Orchestrator (Sonnet) | 28 | 27 useful, 1 error | Clean delegation, knowledge curation worked |
| Level-manager (Opus) | 65 | 65 ran, ~2 productive | All returned, but managed stale react data |
| React (Opus) | ~101 | 7 actually played | 94 returned stale data immediately |
| Synthesizer (Gemini) | ~38 | ~18 returned | Analyzed data, but mostly stale observations |

### Efficiency metrics

- **Opus calls that produced new game state:** 7 / 173 = **4.0%**
- **Opus calls that were pure waste (stale return):** ~94 / 173 = **54.3%**
- **Opus calls for management overhead:** ~65 / 173 = **37.6%**
- **Useful Opus work rate:** 4.0% (compared to single-agent runs where ~50-80% of iterations take actions)

### Cost efficiency

- $1.61 for 32 game actions = **$0.05 per action**
- $1.61 for 1 level completed = **$1.61 per level**
- Projected cost for 7 levels at this rate: $11.27 (assumes linear scaling, which is optimistic)

### Comparison to single-agent efficiency

In prior single-agent runs (v1.4, v1.7), a single Opus agent took actions on roughly 60-80% of its iterations, achieving scores of 2.8% and 14.3% respectively. The multi-agent v2.0.0 achieved a useful-work rate of 4.0% -- an order of magnitude worse.

---

## 3. Knowledge Transfer

### Did synthesized knowledge make it back to the orchestrator?

**Yes, quantitatively.** The knowledge flow was:
1. React observes game state -> returns JSON with mechanics, rules, hazards
2. Synthesizer (Gemini Flash) distills react's report -> returns structured knowledge
3. Manager passes synthesized knowledge to orchestrator
4. Orchestrator merges into `__knowledge` object and passes to next delegation

This pipeline worked mechanically. The orchestrator's `__knowledge` grew from 0 mechanics / 0 rules at start to 13 mechanics / 38 rules / 3 hazards by the end.

### Was the knowledge useful?

**No.** The accumulated knowledge was a hall of mirrors -- the same 32 actions of gameplay observed from every possible angle. Consider the "mechanics" accumulated:

- `movement`: "4 cardinal directions" (discovered in Level 1, restated 10+ times)
- `scrollingViewport`: "Grid coordinates shift when player moves" (same observation, 5+ restatements)
- `cardinal_movement`, `scrolling_viewport`, `view_scrolling`: Duplicate keys for the same mechanic

The 38 rules were similarly redundant. "Color 0 is the only walkable surface" appears in at least 8 different phrasings. The synthesizer kept finding novel ways to describe the same stale observations, giving the illusion of progress.

### Knowledge that SHOULD have been discovered but wasn't

Because the agent was stuck at the same game state for 22 iterations, it never learned:
- What Level 2's goal looks like or where it is
- Whether new action types appear in later levels
- How different levels vary in structure
- Whether there are enemies, timers, or other dynamic elements

---

## 4. React Agent Behavior

### Did `__guard()` work?

**Yes, too well.** The guard function was designed to prevent runaway iterations and budget overruns. It worked perfectly in Level 1 (allowed 12 iterations of productive play, then forced a return). But in Level 2 and beyond, it worked counter-productively:

1. First react agent in L1 sets `__done = true` upon completing the level
2. First react agent in L2 calls `__guard()` on its first line
3. `__guard()` checks `__done` -- it's `true` (inherited)
4. Returns immediately with stale `__returnPayload`
5. No setup code ever executes
6. This repeats for every subsequent react delegation

The guard was protecting against budget overrun but caused a more severe failure: **total inability to take any new game actions**.

### Did `__discover()` run?

**Only once, in Level 1.** After that, the setup block (which defines `__discover`, `diffGrids`, `colorFreqs`, `findComponents`, `renderRegion`) was only reached by the one react agent in Level 2 that managed to run (iter 2, CT 3, 11 iterations). All other react agents returned before reaching setup.

### Were actions budget-enforced?

**Yes.** The budget wrapper around `arc3.step()` correctly prevented the Level 2 react from exceeding 32 total actions. When the budget was hit, the react got `BUDGET_EXCEEDED` state and stopped taking actions. However, the budget was per-session, not per-delegation. Since `arc3.actionCount` is a global counter, the budget of 32 was already consumed by Level 1 (23) + 9 L2 actions, leaving 0 budget for all subsequent delegations.

---

## 5. Synthesizer Effectiveness

### Gemini Flash performance

The synthesizer was called in 18 of 22 completed delegation cycles (82%). When called, it:
- Always returned (no timeouts)
- Produced structured JSON with mechanics, rules, hazards
- Ran in 2 iterations (fast convergence)
- Input ranged from 9.6k to 23k chars
- Output ranged from 1.9k to 3.4k chars

### Quality of synthesis

The synthesizer's output was **technically competent but strategically useless**. Given the same underlying data (32 actions from 2 levels), the synthesizer produced increasingly elaborate analyses:

- Early: "Movement is 4-cardinal using actions 1-4" (correct, useful)
- Mid: "Color 0 is the only walkable surface; viewport scrolling confirmed" (correct, marginal value)
- Late: "Player became stuck after viewport scroll; no corridors available" (correct, but this was known since iteration 2)

The synthesizer could not overcome the fundamental problem: there was no new data to synthesize. It kept re-analyzing the same observations, adding marginally different framings each time. This created an illusion of knowledge growth that masked the underlying stagnation.

### Cross-level synthesis

The synthesizer was supposed to identify patterns across levels. With only Level 1 completed and Level 2 stuck, there was insufficient cross-level data. The few cross-level observations it made ("movement confirmed across L1 and L2") were trivially obvious.

---

## 6. Comparison to Prior Runs

### Score comparison

| Run | Architecture | Score | Levels completed | Children returned |
|-----|-------------|-------|-----------------|------------------|
| v1.0 | Single Opus | 0% | 0 | 0/1 |
| v1.1 | Single Opus | 0% | 0 | 0/2 |
| v1.2 | Single Opus | 0% | 0 | 0/3 |
| v1.3 | Single Opus | 0% | 0 | 0/2 |
| v1.4 | Single Opus | 2.8% | 1 | 1/6 |
| v1.5 | Single Opus | 0% | 0 | 2/5 |
| v1.6 | Single Opus | 0% | 0 | 0/3 |
| v1.7 | Single Opus | 14.3% | 1 | 1/4 |
| v1.8 | Single Opus | 0% | 0 | 2/4 |
| **v2.0.0** | **3-tier multi-agent** | **0%** | **1** | **22/23** |

### What improved

1. **Child return rate:** 22/23 (96%) vs best prior 2/5 (40%). The try-catch guards and structured delegation massively improved reliability of child returns.
2. **Knowledge structure:** v2.0.0 accumulated 13 mechanics and 38 rules in a structured JSON format. Prior runs had no formal knowledge accumulation.
3. **Delegation stability:** After the chaotic early period (iters 1-7), the system settled into a predictable S+4O+2G pattern. Prior runs had unpredictable behavior throughout.

### What regressed

1. **Score:** 0% vs best prior 14.3% (v1.7). The multi-agent architecture scored worse than the best single-agent run.
2. **Cost:** $1.61 for 0% vs comparable or lower cost for v1.7's 14.3%.
3. **Actions per iteration:** 32 actions in 25 iterations (1.28/iter) vs typical 5-15 actions/iter in single-agent runs.
4. **Level diversity:** Only attempted Level 2. Prior runs (v1.4, v1.7) attempted multiple levels.

### Key structural difference

Single-agent runs kept the Opus agent in the same context, so it could build on its own prior observations naturally. The multi-agent approach spawned a new react agent each time, requiring it to re-discover everything from scratch -- but the stale state bug prevented even that.

---

## 7. Root Cause Analysis

### Why was the score 0?

The proximate cause is simple: **only 32 game actions were taken in 56 minutes**. Level 1 was completed (23 actions), but Level 2's 9 actions left the player stuck with no further progress possible.

### Causal chain

```
Root cause: Global state pollution between react delegations
  -> __done = true persists from Level 1 react
  -> Every new react hits __guard() on first line
  -> __guard() returns true (because __done is true)
  -> React returns stale payload immediately
  -> No new arc3.step() calls are made
  -> Game state never changes
  -> Level 2 never completes
  -> Score = 0
```

### Contributing factors

1. **Guard-before-setup pattern.** If the react agent initialized its state BEFORE checking the guard, it would reset `__done` to `false` and proceed normally.

2. **No state isolation between depths.** The RLM framework shares globals across all `rlm()` calls, regardless of depth. A react agent at depth 2 pollutes the same global namespace as the next react agent at depth 2.

3. **Orchestrator didn't detect stagnation.** The orchestrator saw knowledge growing (13 mechanics, 38 rules) and children returning (22/23), so it had no signal that the underlying gameplay was stuck. The estimated action count (254) gave a false impression of activity.

4. **No skip-level strategy.** After 22 failed attempts at Level 2, the orchestrator never tried to skip to Level 3 or reset the game state. The escalation logic (switch to "exploration-only" after 2 attempts) didn't help because exploration also required taking actions, which the stale state bug prevented.

5. **Budget exhaustion was invisible.** The actual arc3.actionCount was 32, but the orchestrator thought 254 actions had been taken. This disconnect meant the orchestrator couldn't accurately assess how much budget remained.

### Single point of failure

The entire 56-minute, $1.61, 234-API-call run was rendered useless by a single bug: **`__guard()` was called before `__done` was reset**. If line 1 of the react agent had been `__done = false; __actionsThisLevel = 0;` instead of `if (__guard()) return(__guard.msg);`, the run might have had a dramatically different outcome.

---

## 8. Recommendations for v2.1.0

### Critical fixes (must-have)

#### 1. State isolation between react delegations

The react setup block MUST reset all state variables BEFORE calling `__guard()`:

```javascript
// FIRST LINE of every react iteration
__done = false;
__actionsThisLevel = 0;
__returnPayload = null;
__iterCount = 0;
// THEN check guard
if (__guard()) return(__guard.msg);
```

Alternatively, the framework should provide state isolation per delegation (e.g., a fresh scope for each `rlm()` call at depth 2).

#### 2. Real action tracking in the orchestrator

Replace the estimated action counter with the actual `arc3.actionCount`:

```javascript
const post = arc3.observe();
const actualActions = arc3.actionCount;
console.log(`Actual actions: ${actualActions}`);
```

The orchestrator should NEVER trust child-reported action counts -- always check `arc3.actionCount` directly.

#### 3. Stagnation detection

Add a stagnation detector to the orchestrator:

```javascript
if (__levelAttempts[level] > 3 && arc3.actionCount === __lastActionCount) {
  console.log(`STAGNATION DETECTED: Level ${level} attempted ${__levelAttempts[level]} times with no new actions`);
  // Skip to next level or reset game state
}
__lastActionCount = arc3.actionCount;
```

### High-value improvements

#### 4. Skip-level strategy

After N failed attempts at a level (e.g., 3), the orchestrator should skip to the next level. The current code switches to "exploration-only" mode after 2 attempts, but this doesn't help if the react agent can't take actions.

#### 5. Reduce react agent overhead

The current pattern spawns a full Opus agent for each react delegation, even when the react returns in 2 iterations with stale data. Consider:
- Pre-checking whether the game state has changed before delegating
- Using a cheaper model for initial observation (Sonnet or Flash) before escalating to Opus
- Passing the current `arc3.actionCount` to the react agent so it can verify it's not stuck

#### 6. Dedup knowledge before accumulation

The orchestrator blindly merges knowledge from children. After 22 iterations of stale data, it had 38 rules that were mostly duplicates. Add deduplication:

```javascript
// Before adding rules, check for semantic duplicates
const newRules = childK.rules.filter(r =>
  !__knowledge.rules.some(existing =>
    levenshtein(existing, r) < 0.3 * Math.max(existing.length, r.length)
  )
);
```

#### 7. Budget per delegation, not per session

Each react delegation should get its own action budget, not share a global budget. The manager should reset `arc3.actionCount` tracking for each new react spawn, or pass the remaining budget explicitly.

#### 8. Reduce synthesizer calls on stale data

The synthesizer should not be called if no new game actions were taken since the last synthesis. The manager should check:

```javascript
const actionsBeforeReact = arc3.actionCount;
// ... spawn react ...
const actionsAfterReact = arc3.actionCount;
if (actionsAfterReact === actionsBeforeReact) {
  console.log("React took no new actions -- skipping synthesis");
} else {
  // spawn synthesizer
}
```

### Architectural considerations for v2.1+

#### 9. Consider depth-2 state namespacing

The RLM framework should consider providing isolated state for each `rlm()` invocation, or at minimum per-depth isolation. Global variables written by one depth-2 agent should not be visible to the next depth-2 agent unless explicitly passed.

#### 10. Reduce delegation depth for simple levels

Level 1 was completed in 23 actions by a single react agent. The 3-tier architecture added overhead (manager + synthesizer) for no benefit. Consider letting the orchestrator play simple levels directly, only delegating to the 3-tier structure for complex levels.

#### 11. Add mid-run diagnostics to the orchestrator

The orchestrator should log diagnostic information that would have revealed the stagnation:

```javascript
console.log(`DIAGNOSTIC: arc3.actionCount=${arc3.actionCount}, est=${__totalActions}, levels=${obs.levels_completed}, attempts_L${level}=${__levelAttempts[level]}`);
```

If `arc3.actionCount` hasn't changed in 3+ iterations, something is wrong.

---

## 9. Summary

The v2.0.0 multi-agent architecture demonstrated that 3-tier delegation CAN produce reliable child returns (96%) and structured knowledge accumulation. However, a single bug -- global state pollution causing the react guard to fire prematurely -- rendered the entire run useless after Level 1.

The run is a case study in how multi-agent systems can fail silently. All the observable signals (children returning, knowledge growing, no crashes) looked healthy. But the underlying reality -- no new game actions being taken -- was invisible to the orchestrator because it trusted child-reported metrics rather than checking ground truth.

**The fix is straightforward:** reset react state before checking the guard, and add stagnation detection based on `arc3.actionCount`. With these changes, v2.1.0 should be able to demonstrate whether the 3-tier architecture genuinely improves gameplay over single-agent runs.

**Verdict:** The architecture is sound in principle but the implementation has a critical state management bug. Fix the bug before drawing conclusions about multi-agent vs single-agent performance.

---

*Analysis generated from run-025-distill.md and raw experiment data.*
*Prior run data from eval/analyses/001-008 and eval/results/.*
