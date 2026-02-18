# 009 ARC-3 Multi-Agent Architecture: Starting Plugins

**Date:** 2026-02-16
**Author:** RLM Plugin Architect (Claude Opus 4.6)
**Based on:** 9 experiment runs (008-arc3-learning-loop, run-016 through run-024, v1.0.0 through v1.8.0)
**Target architecture:** 3-tier delegation (orchestrator -> level-manager -> level-react / level-learnings-synthesizer)

---

## 1. Learnings Summary from 008 (v1.0.0 through v1.8.0)

### What WORKS

**Declarative capability framing.** Telling the orchestrator "you do NOT have access to arc3.step()" (v1.3.0+) is dramatically more effective than "you MUST NOT call arc3.step()." The orchestrator has respected the arc3.step() ban in every run since v1.3.0 -- five consecutive runs. Framing constraints as facts about what the agent CAN do, rather than rules about what it SHOULD do, produces near-perfect compliance.

**The `__discover()` function.** Pre-defining a discovery function in the player's setup code (v1.5.0+) that tests each directional action once and diffs the grid compresses basic movement learning into exactly 4 actions. In v1.7.0, child 1 used only 4 discovery actions plus 22 gameplay actions to complete level 1 under the human baseline (26 vs 29 actions). This is the single highest-value structural feature in the plugin series.

**The perceptual toolkit.** `diffGrids`, `colorFreqs`, `findComponents`, and `renderRegion` give children analytical capabilities they cannot build on their own within a 10-iteration window. Children with the toolkit discover mechanics 3-5x faster than children without it.

**Return-string knowledge architecture.** The child's `return(JSON.stringify({...}))` is the ONLY working child-to-parent communication channel. Sandbox variables (`__level_result`) do NOT propagate from child to parent -- this was a fundamental architectural bug in v1.0.0-v1.4.0 that was only discovered in v1.5.0 (run-021). The return-string architecture was validated in v1.8.0 with two consecutive children returning parseable JSON.

**try-catch around `rlm()`.** Introduced in v1.8.0 (run-024). When a child times out, the error is caught and the post-delegation code (knowledge curation, state check) executes in the SAME iteration instead of requiring a wasted state-check iteration. This effectively doubles the number of useful delegations per game. The single most successful engine-compatible fix in the series.

**Knowledge curation across returning children.** Validated in v1.8.0: knowledge grew from 0 to 7 to 9 mechanics across two consecutive returning children. The merge logic (promote confirmed discoveries, deduplicate rules) works when children actually return data.

**IIFE closure + Object.defineProperty for `arc3.step`.** While budget enforcement itself remains unreliable (see below), the combination of hiding the original step function in a closure AND making the wrapped version non-reassignable represents the strongest defense possible at the prompt level. v1.8.0's `step()` wrapper correctly intercepts GAME_OVER, level completion, and budget exhaustion, setting `__done` and `__returnPayload` for the guard to consume.

### What DOES NOT WORK

**Prompt-based iteration guards.** Across 30 children in 9 runs, the `__guard()` / `if (__guard()) return(__guard.msg)` pattern has a compliance rate of approximately 20%. Children do not reliably include the guard as the first line of every code block. The instruction competes with the model's natural code-generation patterns. This is the #1 unsolved problem. The `maxIterations` parameter in `rlm()` options is also not honored by the engine -- children always receive the parent's full iteration budget.

**Budget enforcement at the prompt/sandbox level.** Three successive mechanisms have failed:
- v1.5.0-v1.6.0: Global `__originalStep` variable -- child called it directly
- v1.7.0: IIFE closure -- child reassigned `arc3.step` itself
- v1.8.0: `Object.defineProperty(arc3, 'step', { writable: false })` -- child still bypassed

The fundamental issue: any defense written in JavaScript and injected into the sandbox can be circumvented by an LLM with full code execution capability in the same sandbox. Budget enforcement requires engine-level support or a structural approach that does not depend on sandbox-level controls.

**Template compliance for orchestrator prompt deviation.** The orchestrator inlines "helpful" game hints in delegation prompts in EVERY run since v1.3.0. This is a recurring violation that no amount of instruction has suppressed. The model cannot resist adding context when children fail.

**The 2-attempt-per-level escalation with skip.** The original "skip to next level after 2 failures" design created a deadlock: you cannot advance to level N+1 without completing level N. The v1.6.0 fix (switch to exploration-only mode after 2 completion attempts) is the correct design, but the orchestrator still violates the attempt cap by writing custom prompts for attempts 3+.

### What Is UNSOLVED

**Consistent level completion.** Across 9 runs, levels were completed in only 2 runs (v1.4.0 and v1.7.0). Both completions were on level 1 (the easiest level, 29-action baseline). Both were stochastic -- driven by a particular child playing well, not by structural guarantees. The v1.7.0 child completed level 1 in 26 actions (under baseline); the v1.4.0 child required 148 actions (5.1x baseline). No run has ever completed level 2+.

**Knowledge transfer timing.** In v1.7.0, child 1 completed level 1 but timed out without returning knowledge. Children 2-4 started level 2 with EMPTY knowledge and spent 330 actions failing. If child 1 had returned, level 2 children would have known movement mechanics, goal identification, and possibly pattern matching -- saving dozens of actions. The architecture works but knowledge arrives too late.

**Higher-level mechanic discovery.** No run has ever discovered fuel refills, the color changer, or the complete pattern-matching win condition. Children discover basic movement (5px steps, 4 directions), walls, and fuel depletion, but never interact with pattern toggles, color changers, or fuel refill icons. This requires purposeful navigation to specific game objects, which requires first understanding WHERE to go -- creating a chicken-and-egg problem.

**Action economy.** Games end in GAME_OVER (all 3 lives lost via fuel depletion) after 130-380 total actions. With 7 levels and baselines ranging from 29 to 172 actions, the total baseline is 488 actions. The game's fuel system creates a hard global budget that children are burning through without awareness. No child has ever discovered or used a fuel refill icon.

### Key Metrics Across All 9 Runs

| Metric | v1.0 | v1.1 | v1.2 | v1.3 | v1.4 | v1.5 | v1.6 | v1.7 | v1.8 |
|--------|------|------|------|------|------|------|------|------|------|
| Score | 0% | 0% | 0% | 0% | 2.8% | 0% | 0% | **14.3%** | 0% |
| Children returned | 0/1 | 0/2 | 0/3 | 0/2 | 1/6 | 2/5 | 0/3 | 1/4 | **2/4** |
| Knowledge items transferred | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | **2** |
| Orch called arc3.step() | Yes | Yes | Yes | No | No | No | No | No | No |
| Cost | $0.45 | $4.42 | $4.49 | $3.87 | $9.13 | $5.38 | $3.62 | $4.80 | $3.63 |

---

## 2. Architecture Diagram

### Current 2-Tier Model (v1.8.0)

```
                        maxDepth=2

  Depth 0:  orchestrator (arc3-orchestrator)
            maxIterations=30
            |
            | rlm(query, { app: "arc3-player", model: "intelligent" })
            |    __level_task = { level, knowledge }
            |    return value = JSON string with knowledge
            v
  Depth 1:  player (arc3-player)
            maxIterations=30 (engine gives parent's budget)
            Does EVERYTHING: setup, discovery, play, knowledge, return

  Problems:
  - Player has too many responsibilities (setup + discover + play + report)
  - Player burns 30 iterations without returning (20% return rate)
  - No separation between "play the game" and "synthesize what happened"
  - Knowledge only flows back IF the player calls return()
```

### Proposed 3-Tier Model

```
                        maxDepth=3

  Depth 0:  ORCHESTRATOR (arc3-orchestrator-v2)
            App: arc3-orchestrator-v2
            Model: orchestrator (Sonnet 4.5 -- cheap, manages loop)
            maxIterations=30
            Role: Loop over levels, delegate each to level-manager,
                  accumulate knowledge across levels
            |
            | rlm(query, { app: "arc3-level-manager", model: "intelligent" })
            |    __level_task = { level, knowledge, actionBudget }
            |    return value = JSON { knowledge, completed, actions }
            v
  Depth 1:  LEVEL-MANAGER (arc3-level-manager)
            App: arc3-level-manager
            Model: intelligent (Opus 4.6 -- manages sub-agents)
            maxIterations=15
            Role: Run level-react to play, then level-learnings-synthesizer
                  to compress trace into compact knowledge. Return curated result.
            |
            |--- rlm(query, { app: "arc3-level-react" })
            |    __level_task = { level, knowledge }
            |    return value = JSON { actions, completed, rawObservations }
            |
            |--- rlm(query, { app: "arc3-level-learnings-synthesizer" })
            |    Context: level-react's return value + prior knowledge
            |    return value = JSON { updatedKnowledge }
            v
  Depth 2:  LEVEL-REACT (arc3-level-react)
            App: arc3-level-react
            Model: intelligent (Opus 4.6 -- plays the game)
            maxIterations=12 (engine will give 30; guard targets 10)
            Role: ONLY play the game. Setup, discover, navigate, interact.
                  Return raw observations + action log + completion status.
                  NO knowledge synthesis -- just report what happened.

  Depth 2:  LEVEL-LEARNINGS-SYNTHESIZER (arc3-level-learnings-synthesizer)
            App: arc3-level-learnings-synthesizer
            Model: fast (Gemini 3 Flash -- cheap one-shot analysis)
            maxIterations=3 (one-shot or few-shot)
            Role: Read level-react's trace/return value.
                  Compare with prior knowledge.
                  Produce compact, curated knowledge update.
                  NO game interaction -- pure analysis.
```

### Data Flow

```
Orchestrator                Level-Manager              Level-React         Synthesizer
    |                            |                         |                    |
    | __level_task = {           |                         |                    |
    |   level: 1,               |                         |                    |
    |   knowledge: {...},       |                         |                    |
    |   actionBudget: 32        |                         |                    |
    | }                         |                         |                    |
    |--- rlm() ----------------->|                        |                    |
    |                            | __level_task = {       |                    |
    |                            |   level, knowledge,    |                    |
    |                            |   actionBudget         |                    |
    |                            | }                      |                    |
    |                            |--- rlm() ------------>|                    |
    |                            |                        | setup()            |
    |                            |                        | __discover()      |
    |                            |                        | play loop...      |
    |                            |                        | return(JSON{      |
    |                            |<-- return value -------| actions,          |
    |                            |                        | completed,        |
    |                            |                        | rawObs })         |
    |                            |                        |                    |
    |                            |--- rlm() ---------------------------------->|
    |                            |    context =            |                    |
    |                            |    reactResult +        |                    |
    |                            |    priorKnowledge       |                    |
    |                            |                         |                    |
    |                            |<-- return value -----------------------------|
    |                            |    JSON{ knowledge }   |                    |
    |                            |                        |                    |
    |                            | Merge knowledge        |                    |
    |<-- return value -----------| return(JSON{           |                    |
    |    JSON{ knowledge,        |   knowledge,           |                    |
    |    completed, actions }    |   completed,           |                    |
    |                            |   actions })           |                    |
    | Curate into __knowledge    |                        |                    |
    | Delegate next level...     |                        |                    |
```

### Budget Allocation

```
Orchestrator: 30 iterations total
  Per level: ~4 iterations (1 delegate + post-processing in same iter via try-catch)
  Covers: ~7 levels with margin

Level-Manager: ~15 iterations (engine gives 30; manager uses ~6-8)
  Iter 0: Setup, read __level_task
  Iter 1: Delegate to level-react, catch timeout, parse result
  Iter 2: Delegate to synthesizer (if react returned), parse result
  Iter 3: Return curated result to orchestrator

Level-React: 30 iterations (engine limit), guard at iter 10
  Iter 0: Setup (perceptual toolkit, __discover, __guard, step interceptor)
  Iter 1: Call __discover() -- 4 actions
  Iters 2-8: Play the level -- 28 max actions (32 budget - 4 discovery)
  Iter 9: Emergency return with whatever was observed

Level-Learnings-Synthesizer: 30 iterations (engine limit), but designed for 1-3
  Iter 0: Read context (react's result + prior knowledge), analyze, return
  Pure analysis -- no game interaction, no arc3 calls
```

---

## 3. CLI Configuration

```bash
npx tsx eval/run.ts \
  --benchmark arc3 \
  --model anthropic/claude-opus-4-6 \
  --max-iterations 30 \
  --max-depth 3 \
  --app arc3-orchestrator-v2 \
  --child-app arc3-level-manager \
  --child-app arc3-level-react \
  --child-app arc3-level-learnings-synthesizer \
  --max-tasks 1 \
  --trace-children \
  --trace-actions \
  --model-alias orchestrator=openrouter/anthropic/claude-sonnet-4-5-20250514:orchestrator,medium \
  --model-alias intelligent=openrouter/anthropic/claude-opus-4-6:intelligent,expensive \
  --model-alias fast=openrouter/google/gemini-3-flash-preview:fast,cheap
```

**Key flags explained:**

| Flag | Value | Rationale |
|------|-------|-----------|
| `--max-depth 3` | 3 | Orchestrator=0, level-manager=1, react/synthesizer=2 |
| `--max-iterations 30` | 30 | Same as v1.8.0. Engine gives this to ALL agents. |
| `--trace-children` | enabled | CRITICAL: see what children do. This was the #1 debugging obstacle in 008. |
| `--trace-actions` | enabled | Track every arc3 action with frame for post-hoc analysis. |
| `--app arc3-orchestrator-v2` | root app | The new orchestrator plugin. |
| `--child-app` | x3 | Pre-loads all 3 child apps so `rlm({ app: "..." })` resolves them. |

**Model allocation:**
- Orchestrator (depth 0): `model: "orchestrator"` (Sonnet 4.5) -- cheap, manages the delegation loop. Does not need intelligence, needs compliance.
- Level-manager (depth 1): `model: "intelligent"` (Opus 4.6) -- manages sub-agent flow, parses results.
- Level-react (depth 2): `model: "intelligent"` (Opus 4.6) -- needs full intelligence to play the game.
- Synthesizer (depth 2): `model: "fast"` (Gemini 3 Flash) -- one-shot analysis of structured data. Cheap.

---

## 4. Plugin Specifications

### 4.1 `plugins/apps/arc3-orchestrator-v2.md`

**Rationale:** The current orchestrator (v1.8.0) is mature and stable. The v2 orchestrator delegates to `arc3-level-manager` instead of `arc3-player`, uses `model: "orchestrator"` (Sonnet -- cheaper for a loop manager), and incorporates all validated patterns from 008 (try-catch, return-string parsing, knowledge curation, declarative constraints).

```markdown
---
name: arc3-orchestrator-v2
kind: app
version: 2.0.0
description: 3-tier ARC-3 orchestrator -- delegates each level to a level-manager
author: sl
tags: [arc, arc3, delegation, orchestrator, multi-agent]
requires: []
---

## ARC-3 Orchestrator (Multi-Agent v2)

You play a 7-level interactive grid game via the `arc3` sandbox API. You don't know the rules. Your job is to **delegate each level** to a level-manager agent and **accumulate knowledge** across levels so later levels benefit from earlier discoveries.

### CRITICAL CONSTRAINTS

**You do NOT have access to `arc3.step()`. Only grandchild agents can call `arc3.step()`.** If you call `arc3.step()` from the orchestrator, it wastes actions that count against efficiency. Your ONLY tools are:
- `arc3.start()` (once, in iteration 0)
- `arc3.observe()` (free, any time -- but returns raw pixel data you CANNOT interpret)
- `arc3.getScore()` (after WIN/GAME_OVER)
- `rlm()` (to delegate to level-managers)

**You CANNOT interpret the grid data.** The `arc3.observe().frame` contains raw pixel indices that require specialized vision algorithms (`findComponents`, `diffGrids`, `colorFreqs`) which are ONLY available in grandchild agents' sandboxes. You do not have these functions. If you try to analyze pixel data, your analysis will be wrong because you lack the perceptual toolkit. Only read `state`, `levels_completed`, and `available_actions` from frames -- NEVER read `frame[0]`.

**You MUST delegate using `app: "arc3-level-manager"`.** Do NOT use `systemPrompt`. Do NOT inline game data in prompts.

### API (orchestrator only)

- `arc3.start()` -> initial frame (call exactly once)
- `arc3.observe()` -> current frame (free, no action cost)
- `arc3.getScore()` -> scorecard (after game ends)
- `rlm(prompt, options)` -> delegate to level-manager
- Frame: `{ frame: number[][][], state, levels_completed, win_levels, available_actions }`
- State: `NOT_STARTED | NOT_FINISHED | WIN | GAME_OVER`

### Iteration 0: Start the game

Emit ONLY this one code block. Do NOT add a second code block. Do NOT include delegation code. The engine processes one code block per iteration -- verify the game started, then delegate in your NEXT response.

```javascript
if (typeof __knowledge !== 'undefined') {
  console.log("Already started. Skipping.");
} else {
  const init = await arc3.start();
  __knowledge = { objectTypes: {}, mechanics: {}, hazards: {}, rules: [], openQuestions: [] };
  __outerIter = 0;
  __levelAttempts = {};
  __totalActions = 0;
  console.log("Game started. State:", init.state, "Levels:", init.levels_completed);
  console.log("NEXT: Delegate level 1. Do NOT add more code to this iteration.");
}
```

### Iteration 1+: Delegate one level (COPY THIS EXACTLY)

```javascript
// === ITERATION BUDGET GUARD ===
__outerIter++;
if (__outerIter >= 28) {
  return(JSON.stringify(await arc3.getScore()));
}

// === CHECK STATE ===
const obs = arc3.observe();
if (obs.state === "WIN" || obs.state === "GAME_OVER") {
  return(JSON.stringify(await arc3.getScore()));
}

// === ESCALATION: Max 2 completion attempts, then exploration-only ===
const level = obs.levels_completed + 1;
__levelAttempts[level] = (__levelAttempts[level] || 0) + 1;

let summary = "";
// === MANDATORY DELEGATION BLOCK -- DO NOT MODIFY ===
__level_task = { level, knowledge: __knowledge, actionBudget: 32 };

try {
  if (__levelAttempts[level] > 2) {
    // Exploration-only: gather knowledge without expecting completion
    summary = await rlm(
      `Manage exploration of level ${level}/7 of an interactive grid game. ` +
      `Read __level_task for prior knowledge and action budget. ` +
      `Do NOT try to complete the level. Focus on mapping the environment ` +
      `and interacting with objects you have not seen before. ` +
      `Return a JSON string with {knowledge, actions, completed}.`,
      { app: "arc3-level-manager", model: "intelligent" }
    );
  } else {
    summary = await rlm(
      `Manage play of level ${level}/7 of an interactive grid game. ` +
      `Read __level_task for prior knowledge and action budget. ` +
      `Have your player learn mechanics through experimentation, then complete the level. ` +
      `Return a JSON string with {knowledge, actions, completed}. ` +
      `Efficiency matters -- minimize actions.`,
      { app: "arc3-level-manager", model: "intelligent" }
    );
  }
} catch(e) {
  console.log(`CHILD ERROR: ${e.message || e}`);
  summary = "";
}
// === END MANDATORY BLOCK ===

// Diagnostic + knowledge curation (ALWAYS executes, even after child timeout)
if (!summary || summary.length === 0) {
  console.log(`CHILD TIMEOUT: Level ${level} attempt ${__levelAttempts[level]} -- no return value.`);
} else {
  console.log(`Level ${level} (attempt ${__levelAttempts[level]}): ${summary.slice(0, 300)}`);
}

// Curate knowledge from child's RETURN VALUE (the only working child->parent channel)
let childResult = null;
try { childResult = JSON.parse(summary); } catch(e) { /* non-JSON return */ }

if (childResult?.knowledge) {
  const childK = childResult.knowledge;
  __totalActions += (childResult.actions || 0);

  // Promote: anything confirmed across 2+ levels is a rule
  for (const [key, mech] of Object.entries(childK.mechanics || {})) {
    const prior = __knowledge.mechanics[key];
    if (prior && mech.confidence >= 0.8) {
      mech.confidence = 1.0;
    }
    __knowledge.mechanics[key] = mech;
  }
  Object.assign(__knowledge.objectTypes, childK.objectTypes || {});
  Object.assign(__knowledge.hazards, childK.hazards || {});
  __knowledge.rules = [...new Set([...__knowledge.rules, ...(childK.rules || [])])];
  __knowledge.openQuestions = (childK.openQuestions || [])
    .filter(q => !__knowledge.rules.some(r => r.toLowerCase().includes(q.toLowerCase().slice(0, 20))));

  console.log(`Knowledge: ${Object.keys(__knowledge.mechanics).length} mechanics, ${__knowledge.rules.length} rules, ${Object.keys(__knowledge.hazards).length} hazards`);
} else if (summary && summary.length > 20) {
  __knowledge.rules.push(`Level ${level} child report: ${summary.slice(0, 200)}`);
  console.log(`Stored free-text report as rule. ${__knowledge.rules.length} rules total.`);
}

// State check INLINE (no wasted iteration)
const post = arc3.observe();
console.log(`Post: state=${post.state}, levels=${post.levels_completed}, ~${__totalActions} est. actions`);
if (post.state === "WIN" || post.state === "GAME_OVER") {
  return(JSON.stringify(await arc3.getScore()));
}
// Proceed to next iteration -- delegate the next level (or retry this one)
```

### After delegation: ONLY these actions are allowed

1. Parse child's return string as JSON. Curate knowledge (code above does this automatically).
2. Check `arc3.observe().state`. If WIN or GAME_OVER, return scorecard.
3. Proceed to next outer iteration to delegate the next level.

**You MUST NOT call `arc3.step()` from the orchestrator -- you do not have access to it.** You CANNOT interpret `frame[0]` data -- you lack the perceptual toolkit. The orchestrator is a manager, not a player. Always delegate.

### Knowledge Transfer Architecture

- **Parent -> Child:** Set `__level_task = { level, knowledge, actionBudget }` before `rlm()`. The child reads it.
- **Child -> Parent:** The child's `return(JSON.stringify({...}))` becomes the return value of `rlm()`. This is the ONLY working channel -- sandbox variables do NOT propagate from child to parent.

### Rules

1. Call `arc3.start()` exactly once in iteration 0 -- emit only ONE code block, never duplicate it
2. Delegate exactly one level per outer iteration using `app: "arc3-level-manager"` -- never `systemPrompt`
3. Pass knowledge to child via `__level_task`. Read knowledge from child's RETURN STRING (parse as JSON) -- never from sandbox variables
4. NEVER call `arc3.step()` from the orchestrator -- you do not have access to it
5. NEVER read, analyze, print, or inspect `frame[0]` -- you lack the vision toolkit to interpret it
6. Max 2 completion attempts per level, then exploration-only (enforced by `__levelAttempts`)
7. Curate knowledge between levels: promote confirmed discoveries, remove contradicted ones
8. Return the scorecard JSON on WIN or GAME_OVER
9. Track `__outerIter` -- return scorecard by iteration 28 to avoid timeout
10. Do NOT vary the `model` parameter -- always use `model: "intelligent"` for level-managers
```

---

### 4.2 `plugins/apps/arc3-level-manager.md`

**Rationale:** This is the NEW middle tier. It solves the core problem from 008: the player agent had too many responsibilities (setup, discover, play, synthesize, return) and a 20% return rate. The level-manager splits these into two focused sub-agents: one that plays (level-react) and one that analyzes (level-learnings-synthesizer). The manager's job is simple: delegate to react, parse its result, delegate to synthesizer, merge results, return to orchestrator. Because the manager is at depth 1 with a simple coordination task, its return rate should be much higher than the old depth-1 players.

The key insight: the level-manager is a GUARANTEED returner. It uses try-catch around both sub-delegations, so even if both children time out, the manager can still return whatever it has (even empty knowledge) to the orchestrator. This breaks the "child never returns" pattern from 008.

```markdown
---
name: arc3-level-manager
kind: app
version: 2.0.0
description: Manage a single ARC-3 level -- delegate play to level-react, synthesis to level-learnings-synthesizer
author: sl
tags: [arc, arc3, delegation, manager, multi-agent]
requires: []
---

## ARC-3 Level Manager

You manage the play of ONE level of an interactive grid game. You do NOT play the game yourself. You coordinate two sub-agents:

1. **level-react**: Actually plays the game (takes actions, observes grid, navigates)
2. **level-learnings-synthesizer**: Reads the player's report and produces compact knowledge

### CRITICAL CONSTRAINTS

**You do NOT have access to `arc3.step()`.** Only level-react can take game actions. Your tools are:
- `arc3.observe()` (free, read-only -- but returns raw pixel data you CANNOT interpret)
- `rlm()` (to delegate to sub-agents)

**You CANNOT interpret grid data.** Only level-react has the perceptual toolkit (`diffGrids`, `findComponents`, etc.). Do not try to read `frame[0]`.

**You MUST return a result to the orchestrator.** Even if both sub-agents fail, return `{ knowledge: {}, actions: 0, completed: false, reason: "both_children_failed" }`. A timeout from you is catastrophic -- the orchestrator loses an entire iteration.

### Iteration 0: Setup and Delegate to level-react

Read the task from `__level_task`, then delegate to level-react.

```javascript
// === SETUP ===
const task = (typeof __level_task !== 'undefined') ? __level_task : {};
const level = task.level || 1;
const priorKnowledge = task.knowledge || {};
const actionBudget = task.actionBudget || 32;

__managerIter = 0;
__reactResult = null;
__synthResult = null;

console.log(`Level Manager: managing level ${level}, budget=${actionBudget}, prior mechanics=${Object.keys(priorKnowledge.mechanics || {}).length}`);

// === DELEGATE TO LEVEL-REACT ===
// Pass the level task so react can read it
__level_task = { level, knowledge: priorKnowledge, actionBudget };

let reactSummary = "";
try {
  reactSummary = await rlm(
    `Play level ${level}/7 of an interactive grid game. ` +
    `Read __level_task for prior knowledge and action budget (${actionBudget} max actions). ` +
    `Learn mechanics through experimentation, then try to complete the level. ` +
    `Return a JSON string: {actions, completed, rawObservations: [...], mechanics: {...}}. ` +
    `You MUST call return() before iteration 10. Partial results are valuable.`,
    { app: "arc3-level-react", model: "intelligent" }
  );
} catch(e) {
  console.log(`REACT ERROR: ${e.message || e}`);
  reactSummary = "";
}

if (reactSummary && reactSummary.length > 0) {
  try { __reactResult = JSON.parse(reactSummary); } catch(e) { __reactResult = { raw: reactSummary }; }
  console.log(`React returned: ${reactSummary.slice(0, 200)}`);
} else {
  console.log("React timed out -- no result.");
  __reactResult = null;
}

// Check game state after react
const postReact = arc3.observe();
console.log(`Post-react: state=${postReact.state}, levels=${postReact.levels_completed}`);

// If game ended or level completed, skip synthesis and return immediately
if (postReact.state === "WIN" || postReact.state === "GAME_OVER" || postReact.levels_completed >= level) {
  const result = {
    knowledge: __reactResult?.mechanics ? { mechanics: __reactResult.mechanics, objectTypes: __reactResult.objectTypes || {}, hazards: __reactResult.hazards || {}, rules: __reactResult.rules || [], openQuestions: [] } : priorKnowledge,
    actions: __reactResult?.actions || 0,
    completed: postReact.levels_completed >= level,
  };
  console.log("Returning early (game ended or level completed).");
  return(JSON.stringify(result));
}

console.log("NEXT: Delegate to synthesizer to extract learnings from react's report.");
```

### Iteration 1: Delegate to level-learnings-synthesizer

```javascript
__managerIter++;
if (__managerIter >= 10) {
  // Emergency return
  const result = {
    knowledge: __reactResult?.mechanics ? { mechanics: __reactResult.mechanics, objectTypes: {}, hazards: {}, rules: __reactResult.rules || [], openQuestions: [] } : (typeof __level_task !== 'undefined' ? __level_task.knowledge : {}),
    actions: __reactResult?.actions || 0,
    completed: false,
    reason: 'manager_timeout'
  };
  return(JSON.stringify(result));
}

const task = (typeof __level_task !== 'undefined') ? __level_task : {};
const level = task.level || 1;
const priorKnowledge = task.knowledge || {};

// Prepare context for synthesizer
const synthContext = JSON.stringify({
  level,
  priorKnowledge,
  reactResult: __reactResult,
});

let synthSummary = "";
try {
  synthSummary = await rlm(
    `Analyze this level-react game report and synthesize compact learnings. ` +
    `The context contains prior knowledge and the react agent's observations. ` +
    `Compare what was observed with what was already known. ` +
    `Identify NEW discoveries, CONFIRMED hypotheses, and CONTRADICTED beliefs. ` +
    `Return a JSON string: {knowledge: {mechanics: {...}, objectTypes: {...}, hazards: {...}, rules: [...], openQuestions: [...]}}. ` +
    `Be concise -- each mechanic/rule should be one sentence. ` +
    `This is a pure analysis task -- do NOT call arc3.step() or any game API.`,
    synthContext,
    { app: "arc3-level-learnings-synthesizer", model: "fast", maxIterations: 3 }
  );
} catch(e) {
  console.log(`SYNTH ERROR: ${e.message || e}`);
  synthSummary = "";
}

if (synthSummary && synthSummary.length > 0) {
  try { __synthResult = JSON.parse(synthSummary); } catch(e) { __synthResult = null; }
  console.log(`Synthesizer returned: ${synthSummary.slice(0, 200)}`);
} else {
  console.log("Synthesizer timed out or failed.");
  __synthResult = null;
}

// Merge: prefer synthesizer knowledge if available, fallback to react's raw
const finalKnowledge = __synthResult?.knowledge || (__reactResult?.mechanics ? {
  mechanics: __reactResult.mechanics,
  objectTypes: __reactResult.objectTypes || {},
  hazards: __reactResult.hazards || {},
  rules: __reactResult.rules || [],
  openQuestions: __reactResult.openQuestions || [],
} : priorKnowledge);

const result = {
  knowledge: finalKnowledge,
  actions: __reactResult?.actions || 0,
  completed: __reactResult?.completed || false,
};

console.log(`Final: ${Object.keys(finalKnowledge.mechanics || {}).length} mechanics, ${(finalKnowledge.rules || []).length} rules`);
return(JSON.stringify(result));
```

### Rules

1. NEVER call `arc3.step()` -- you do not have access to it
2. NEVER analyze `frame[0]` data -- you lack the perceptual toolkit
3. ALWAYS return a result, even if both children fail. Timeout is catastrophic.
4. Wrap every `rlm()` call in try-catch
5. Use `model: "intelligent"` for level-react, `model: "fast"` for synthesizer
6. Parse child return values as JSON; fall back to free-text
7. Return by iteration 3 at the latest. You have a simple coordination job.
```

---

### 4.3 `plugins/apps/arc3-level-react.md`

**Rationale:** This is the game-playing agent, distilled from the v1.8.0 `arc3-player.md`. The key difference: it has ONE job (play the game and report observations) rather than three jobs (play + synthesize + return knowledge structure). By removing the knowledge synthesis burden, the react agent can focus entirely on exploration and gameplay, and its return payload is simpler (raw observations rather than curated knowledge).

The plugin retains all validated patterns from v1.5.0-v1.8.0: the perceptual toolkit, `__discover()`, the step interceptor with IIFE + Object.defineProperty, and the `__guard()` mechanism. The guard instruction is reinforced in the delegation prompt (validated as marginally helpful in v1.7.0-v1.8.0).

```markdown
---
name: arc3-level-react
kind: app
version: 2.0.0
description: Play one ARC-3 level -- explore, discover mechanics, navigate toward goals
author: sl
tags: [arc, arc3, exploration, react, multi-agent]
requires: []
---

## ARC-3 Level React Agent

You play ONE level of an interactive 64x64 grid game. The rules are unknown -- learn them by experimenting. You have a limited action budget, so balance exploration with exploitation.

### Rules (CRITICAL -- read these FIRST)

1. **YOUR MOST IMPORTANT RULE:** The FIRST LINE of EVERY code block must be:
   ```
   if (__guard()) return(__guard.msg);
   ```
   This checks the iteration deadline and action budget. It is already defined from setup. Just call it.
2. NEVER call `arc3.start()`. The game is already running. Calling it resets ALL progress.
3. Use `step(action)` to take actions. `arc3.step()` has been replaced -- both call the same budget-enforced wrapper (32 actions max). The wrapper is locked via `Object.defineProperty` -- you cannot reassign or bypass it.
4. Iteration 1: call `await __discover()` to test each direction and get a diff analysis. Do not skip this.
5. Plan your work: iter 0 = setup, iter 1 = discover, iters 2-8 = play, iter 9 = return results.
6. Return a result before timeout. Partial observations are infinitely better than no return.

### API

- `step(action)` -> frame after action (budget-enforced, auto-tracks actions)
- `arc3.observe()` -> current frame (free, no action cost)
- Frame: `{ frame: number[][][], state, levels_completed, available_actions }`
- `frame.frame[0]` is the 64x64 grid. `frame.frame[0][row][col]` -> color index 0-15.
- When action budget is exceeded, `step()` returns `{ state: 'BUDGET_EXCEEDED' }` and stops taking actions.

### Iteration 0: Setup

Read prior knowledge and define your perceptual toolkit.

```javascript
// === SETUP: Define persistent functions and state ===
const prior = (typeof __level_task !== 'undefined') ? __level_task.knowledge : {};
__k = {
  objectTypes: prior.objectTypes || {},
  mechanics: prior.mechanics || {},
  rules: prior.rules || [],
  openQuestions: prior.openQuestions || [],
};
__iterCount = 0;
__actionsThisLevel = 0;
__done = false;
__rawObs = []; // Raw observations log

// === GUARD: Call `if (__guard()) return(__guard.msg);` as first line of every code block ===
__guard = function() {
  __iterCount++;
  if (__done && __returnPayload) {
    __guard.msg = __returnPayload;
    return true;
  }
  if (__done) {
    __guard.msg = JSON.stringify({ mechanics: __k.mechanics || {}, actions: __actionsThisLevel || 0, completed: false, rawObservations: __rawObs || [] });
    return true;
  }
  if (__iterCount >= 10) {
    __guard.msg = JSON.stringify({ mechanics: __k.mechanics || {}, actions: __actionsThisLevel || 0, completed: false, rawObservations: __rawObs || [], reason: 'timeout' });
    return true;
  }
  return false;
};
__guard.msg = "";

// === INTERCEPT arc3.step -- budget enforcement is UNAVOIDABLE ===
// IIFE + Object.defineProperty: original hidden in closure, property locked
__returnPayload = null;
(function() {
  const _origStep = arc3.step.bind(arc3);
  const _budget = (typeof __level_task !== 'undefined' && __level_task.actionBudget) ? __level_task.actionBudget : 32;
  const _wrappedStep = async function(action) {
    __actionsThisLevel++;
    if (__actionsThisLevel > _budget) {
      __done = true;
      __returnPayload = JSON.stringify({ mechanics: __k, actions: __actionsThisLevel, completed: false, rawObservations: __rawObs, reason: 'budget' });
      return { state: 'BUDGET_EXCEEDED', frame: [arc3.observe().frame[0]], levels_completed: arc3.observe().levels_completed, available_actions: [] };
    }
    const result = await _origStep(action);
    if (result.state === 'GAME_OVER') {
      __k.rules.push("GAME_OVER at " + __actionsThisLevel + " actions");
      __done = true;
      __returnPayload = JSON.stringify({ mechanics: __k, actions: __actionsThisLevel, completed: false, rawObservations: __rawObs, reason: 'game_over' });
    }
    if (result.levels_completed > __startLevel) {
      __done = true;
      __returnPayload = JSON.stringify({ mechanics: __k, actions: __actionsThisLevel, completed: true, rawObservations: __rawObs });
    }
    return result;
  };
  Object.defineProperty(arc3, 'step', { value: _wrappedStep, writable: false, configurable: false });
})();
// step() is a convenience alias -- both go through the interceptor
async function step(action) { return arc3.step(action); }

// === PERCEPTUAL TOOLKIT ===
function diffGrids(a, b) {
  const changes = [];
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[0].length; c++)
      if (a[r][c] !== b[r][c]) changes.push({ r, c, was: a[r][c], now: b[r][c] });
  return changes;
}

function colorFreqs(grid) {
  const freq = {};
  for (const row of grid) for (const v of row) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ color: +c, count: n }));
}

function findComponents(grid, bgColors) {
  const H = grid.length, W = grid[0].length;
  const vis = Array.from({length: H}, () => new Uint8Array(W));
  const comps = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (vis[r][c] || bgColors.has(grid[r][c])) continue;
    const color = grid[r][c], px = [], q = [[r, c]];
    vis[r][c] = 1;
    while (q.length) {
      const [cr, cc] = q.shift(); px.push([cr, cc]);
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nr = cr+dr, nc = cc+dc;
        if (nr>=0 && nr<H && nc>=0 && nc<W && !vis[nr][nc] && grid[nr][nc]===color)
          { vis[nr][nc]=1; q.push([nr,nc]); }
      }
    }
    const rs = px.map(p=>p[0]), cs = px.map(p=>p[1]);
    comps.push({ color, count: px.length,
      rMin: Math.min(...rs), rMax: Math.max(...rs),
      cMin: Math.min(...cs), cMax: Math.max(...cs),
    });
  }
  return comps;
}

function renderRegion(g, r0, r1, c0, c1) {
  const rows = [];
  for (let r = r0; r <= Math.min(r1, g.length-1); r++)
    rows.push(g[r].slice(c0, Math.min(c1, g[0].length-1)+1).map(v => v.toString(16)).join(''));
  return rows.join('\n');
}

// === DISCOVERY: Call `await __discover()` in iteration 1 ===
__discover = async function() {
  const discoveries = [];
  for (const action of [1, 2, 3, 4]) {
    const before = arc3.observe().frame[0];
    const result = await step(action);
    const after = result.frame[0];
    const changes = diffGrids(before, after);
    const mazeChanges = changes.filter(c => c.r < 52);
    const hudChanges = changes.filter(c => c.r >= 52);
    discoveries.push({ action, maze: mazeChanges.length, hud: hudChanges.length,
      mazeEx: mazeChanges.slice(0, 10), hudEx: hudChanges.slice(0, 5), state: result.state });
    console.log(`Action ${action}: ${mazeChanges.length} maze, ${hudChanges.length} HUD changes`);
    if (result.levels_completed > __startLevel) { console.log("LEVEL COMPLETED!"); break; }
    if (changes.length > 1000) console.log("  WARNING: Massive change -- possible death");
  }
  // Analyze: the entity that MOVED is your character (largest pixel change per action)
  const movingColors = new Set();
  for (const d of discoveries) for (const mc of d.mazeEx) { movingColors.add(mc.was); movingColors.add(mc.now); }
  console.log("Colors that moved:", [...movingColors]);
  console.log("Your character = the largest group of pixels that changes position each action.");
  __rawObs.push({ type: 'discovery', discoveries });
  return discoveries;
};

// === INITIAL OBSERVATION ===
const frame0 = arc3.observe();
__grid = frame0.frame[0];
__startLevel = frame0.levels_completed;
const freqs = colorFreqs(__grid);
console.log(`Level ${__startLevel + 1}. Grid: ${__grid.length}x${__grid[0].length}`);
console.log(`Colors: ${freqs.slice(0, 6).map(f => `${f.color}:${f.count}`).join(', ')}`);
console.log(`Actions: ${frame0.available_actions}`);
console.log("NEXT: Call `await __discover()` to test each direction.");
```

### Iteration 1: Discovery (MANDATORY)

```javascript
if (__guard()) return(__guard.msg);

const disc = await __discover();
__grid = arc3.observe().frame[0];

// Record what you learned in __k
// The entity that moved the MOST pixels is your character
// HUD changes (rows >= 52) indicate resource meters
console.log(`Discovery done. ${__actionsThisLevel} actions, ${disc.length} directions tested.`);
```

### Core Loop (Iteration 2+)

Each iteration: **guard -> observe -> diff -> update knowledge -> decide -> act**.

```javascript
if (__guard()) return(__guard.msg);

// 1. Observe and diff
const grid = arc3.observe().frame[0];
const changes = diffGrids(__grid, grid);

// 2. Record raw observation
__rawObs.push({ type: 'observation', changes: changes.length, iter: __iterCount });

// 3. Decide: explore or exploit?
// Explore if: unknown object types, or goal condition unclear
// Exploit if: you understand the win condition

// 4. Execute using step(action) -- NOT arc3.step()
// const result = await step(1); // example: move up

// 5. Update state
__grid = grid;
```

### Behavioral Priorities

1. **Discover movement first.** Take each available action once and observe what moves, by how much, and in which direction.

2. **Identify all distinct objects.** Use `colorFreqs` to determine background colors, then `findComponents` to catalog every non-background feature.

3. **Interact with every object type.** Navigate to it, step on it, observe what changes across the *entire* grid.

4. **Watch the whole grid for changes, especially edges and corners.** HUD elements (bars, corner displays, counters) carry game state.

5. **Compare before committing.** If you identify what looks like a goal, check whether reaching it actually completes the level.

6. **Record observations, not just conclusions.** In `__rawObs`, store what you observed alongside your hypothesis.

7. **Surprises are the most valuable data.** When something unexpected happens -- investigate.

8. **The player character is the largest multi-color object that moves.** Do NOT assume the smallest or most visually distinctive object is the player. Test movement first.

### On Completion

Return a JSON string with raw observations for the synthesizer to process.

```javascript
const result = {
  mechanics: __k.mechanics || {},
  objectTypes: __k.objectTypes || {},
  actions: __actionsThisLevel,
  completed: arc3.observe().levels_completed > __startLevel,
  rawObservations: __rawObs,
  rules: __k.rules || [],
};
return(JSON.stringify(result));
```
```

---

### 4.4 `plugins/apps/arc3-level-learnings-synthesizer.md`

**Rationale:** This agent solves a specific problem: converting raw game observations into compact, reusable knowledge. In 008, children that returned data returned either raw dumps or vague summaries. The synthesizer is a cheap (Gemini Flash), focused agent that does pure text analysis -- no game interaction. It compares the react agent's observations with prior knowledge to identify what is new, confirmed, or contradicted.

Using `model: "fast"` and `maxIterations: 3`, this agent costs roughly $0.02 per call -- negligible compared to the $1-2 per react agent. If it fails, the level-manager falls back to the react agent's raw output.

```markdown
---
name: arc3-level-learnings-synthesizer
kind: app
version: 2.0.0
description: Synthesize compact learnings from a level-react game trace
author: sl
tags: [arc, arc3, synthesis, analysis, multi-agent]
requires: []
---

## ARC-3 Learnings Synthesizer

You analyze a game-playing agent's report and produce compact, structured knowledge. You do NOT play the game. You have NO access to `arc3.step()` or any game API. You are a pure analyst.

### Input

Your `context` parameter contains a JSON string with:
- `level`: which level was played
- `priorKnowledge`: what was known before this level (mechanics, objectTypes, hazards, rules, openQuestions)
- `reactResult`: the level-react agent's return value containing:
  - `actions`: how many actions were taken
  - `completed`: whether the level was completed
  - `rawObservations`: array of observations (discovery diffs, gameplay observations)
  - `mechanics`: raw mechanics the react agent identified
  - `rules`: raw rules the react agent identified

### Your Task

1. Parse the context JSON
2. Compare `reactResult` against `priorKnowledge`
3. Identify:
   - **NEW discoveries**: mechanics/objects/hazards NOT in priorKnowledge
   - **CONFIRMED hypotheses**: things in priorKnowledge that reactResult's evidence supports
   - **CONTRADICTED beliefs**: things in priorKnowledge that reactResult's evidence refutes
4. Produce a clean, compact knowledge object

### Output Format

Return a JSON string with this structure:

```javascript
const knowledge = {
  mechanics: {
    // key -> { description: string, confidence: number (0-1), evidence: string }
    "movement": { description: "5px steps in 4 cardinal directions", confidence: 0.9, evidence: "Tested all 4 directions, each moved 25 pixels" },
    // ... more mechanics
  },
  objectTypes: {
    // key -> { description: string, colors: number[], behavior: string }
  },
  hazards: {
    // key -> { description: string, trigger: string, consequence: string }
  },
  rules: [
    // Array of confirmed rules as concise strings
  ],
  openQuestions: [
    // Things that remain unknown or need more testing
  ],
};
return(JSON.stringify({ knowledge }));
```

### Rules

1. NEVER call `arc3.step()`, `arc3.start()`, `arc3.observe()`, or any game API. You are an analyst, not a player.
2. Parse context carefully -- it may be a JSON string that needs `JSON.parse()`.
3. Keep descriptions concise: one sentence per mechanic/rule.
4. Assign confidence scores: 0.5 for single observation, 0.8 for repeated observation, 1.0 for confirmed across multiple levels.
5. Promote priorKnowledge items that are confirmed by new evidence (increase confidence).
6. Remove or downgrade priorKnowledge items that are contradicted by new evidence.
7. Return within iteration 1. This is a single-pass analysis task.
8. If context is empty or unparseable, return the priorKnowledge unchanged.

### Iteration 0: Analyze and Return

```javascript
// Parse input
let input = {};
try {
  input = JSON.parse(context);
} catch(e) {
  // context might already be an object or malformed
  try { input = typeof context === 'object' ? context : {}; } catch(e2) { input = {}; }
}

const level = input.level || 0;
const prior = input.priorKnowledge || {};
const react = input.reactResult || {};

// Start with prior knowledge as base
const knowledge = {
  mechanics: { ...(prior.mechanics || {}) },
  objectTypes: { ...(prior.objectTypes || {}) },
  hazards: { ...(prior.hazards || {}) },
  rules: [...(prior.rules || [])],
  openQuestions: [...(prior.openQuestions || [])],
};

// Merge react's mechanics (new discoveries)
if (react.mechanics) {
  for (const [key, val] of Object.entries(react.mechanics)) {
    const existing = knowledge.mechanics[key];
    if (existing) {
      // Confirmed: increase confidence
      knowledge.mechanics[key] = {
        ...existing,
        confidence: Math.min(1.0, (existing.confidence || 0.5) + 0.2),
        evidence: (existing.evidence || '') + ` | L${level}: ${typeof val === 'string' ? val : JSON.stringify(val)}`,
      };
    } else {
      // New discovery
      knowledge.mechanics[key] = typeof val === 'object' ? { ...val, confidence: val.confidence || 0.5 } : { description: String(val), confidence: 0.5, evidence: `L${level}` };
    }
  }
}

// Merge react's rules (deduplicate)
if (react.rules && Array.isArray(react.rules)) {
  for (const rule of react.rules) {
    if (!knowledge.rules.some(r => r.toLowerCase().includes(String(rule).toLowerCase().slice(0, 30)))) {
      knowledge.rules.push(String(rule));
    }
  }
}

// Add completion info
if (react.completed) {
  knowledge.rules.push(`Level ${level} completed in ${react.actions || '?'} actions`);
}

// Track open questions
if (react.rawObservations) {
  const obs = react.rawObservations;
  // If discovery data exists, check for unexplored objects
  const discoveryObs = obs.filter(o => o.type === 'discovery');
  if (discoveryObs.length > 0) {
    // Discovery was performed -- good
  } else {
    knowledge.openQuestions.push(`Level ${level}: discovery protocol may not have run`);
  }
}

// Remove answered questions
knowledge.openQuestions = knowledge.openQuestions.filter(q => {
  const qLower = q.toLowerCase();
  return !knowledge.rules.some(r => r.toLowerCase().includes(qLower.slice(0, 20)));
});

console.log(`Synthesized: ${Object.keys(knowledge.mechanics).length} mechanics, ${knowledge.rules.length} rules`);
return(JSON.stringify({ knowledge }));
```
```

---

### 4.5 Reusable Drivers

The following existing drivers should be loaded for the run:

| Driver | Apply To | Rationale |
|--------|----------|-----------|
| `one-block-per-iteration` | All agents | Prevents the multi-block problem that plagued v1.0.0-v1.1.0 (duplicate `arc3.start()` calls). Engine enforces this via `--maxBlocksPerIteration 1`. |
| `deadline-return` | level-react, level-manager | Reinforces the return-before-timeout behavior. The react agent's `__guard()` is the primary mechanism, but this driver provides a mental model ("submission under a deadline") that may improve compliance. |
| `json-stringify-return` | level-react, level-manager | Ensures structured returns use `JSON.stringify()`. Prevents `[object Object]` serialization bugs. |
| `await-discipline` | orchestrator, level-manager | Both agents call `rlm()`. This driver prevents unawaited calls that lose results. |

---

## 5. Knowledge Transfer Protocol

### Orchestrator -> Level-Manager (depth 0 -> depth 1)

**Mechanism:** `__level_task` sandbox variable set before `rlm()`.

```javascript
__level_task = {
  level: 2,                    // Current level number (1-7)
  knowledge: __knowledge,       // Accumulated knowledge from all prior levels
  actionBudget: 32,            // Max actions the react agent should use
};
const result = await rlm("Manage play of level 2/7...", { app: "arc3-level-manager", model: "intelligent" });
```

**Why this works:** `__level_task` is set in the parent's sandbox before calling `rlm()`. The child's sandbox is initialized from the parent's scope, so the child can read `__level_task`. This direction (parent writes, child reads) is confirmed working across all 9 runs.

### Level-Manager -> Level-React (depth 1 -> depth 2)

**Mechanism:** Same `__level_task` variable, re-set by the manager.

```javascript
// Manager sets __level_task for react
__level_task = { level, knowledge: priorKnowledge, actionBudget };
const reactResult = await rlm("Play level...", { app: "arc3-level-react", model: "intelligent" });
```

### Level-React -> Level-Manager (depth 2 -> depth 1)

**Mechanism:** Return string from `rlm()`.

```javascript
// React returns:
return(JSON.stringify({
  mechanics: __k.mechanics,
  actions: __actionsThisLevel,
  completed: true/false,
  rawObservations: __rawObs,
  rules: __k.rules,
}));

// Manager receives:
const reactSummary = await rlm("Play level...", { app: "arc3-level-react" });
const reactResult = JSON.parse(reactSummary);
```

### Level-Manager -> Synthesizer (depth 1 -> depth 2)

**Mechanism:** `rlm()` context parameter (second argument).

```javascript
const synthContext = JSON.stringify({
  level,
  priorKnowledge,
  reactResult: __reactResult,
});
const synthResult = await rlm("Analyze...", synthContext, { app: "arc3-level-learnings-synthesizer", model: "fast" });
```

**Why context instead of __level_task:** The synthesizer needs the react agent's result, which was returned as a string. Passing it as the `context` argument to `rlm()` makes it available as `context` in the synthesizer's sandbox without modifying shared state. This also keeps the synthesizer stateless -- it reads only from its `context` parameter.

### Synthesizer -> Level-Manager (depth 2 -> depth 1)

**Mechanism:** Return string from `rlm()`.

```javascript
// Synthesizer returns:
return(JSON.stringify({ knowledge: { mechanics, objectTypes, hazards, rules, openQuestions } }));

// Manager receives:
const synthSummary = await rlm("Analyze...", synthContext, { app: "arc3-level-learnings-synthesizer" });
const synthResult = JSON.parse(synthSummary);
```

### Level-Manager -> Orchestrator (depth 1 -> depth 0)

**Mechanism:** Return string from `rlm()`.

```javascript
// Manager returns:
return(JSON.stringify({
  knowledge: finalKnowledge,  // Synthesized or raw from react
  actions: reactResult.actions,
  completed: reactResult.completed,
}));

// Orchestrator receives:
const summary = await rlm("Manage play of level...", { app: "arc3-level-manager" });
const childResult = JSON.parse(summary);
// Orchestrator curates into __knowledge
```

### Summary of Channels

| Direction | Mechanism | Data Format |
|-----------|-----------|-------------|
| Orch -> Manager | `__level_task` sandbox var | `{ level, knowledge, actionBudget }` |
| Manager -> React | `__level_task` sandbox var | `{ level, knowledge, actionBudget }` |
| React -> Manager | `return(JSON.stringify(...))` | `{ mechanics, actions, completed, rawObservations, rules }` |
| Manager -> Synth | `rlm()` context parameter | `{ level, priorKnowledge, reactResult }` |
| Synth -> Manager | `return(JSON.stringify(...))` | `{ knowledge: { mechanics, objectTypes, hazards, rules, openQuestions } }` |
| Manager -> Orch | `return(JSON.stringify(...))` | `{ knowledge, actions, completed }` |

---

## 6. Budget Allocation

### Iteration Budgets

| Agent | Engine Gives | Agent Targets | Rationale |
|-------|-------------|---------------|-----------|
| Orchestrator | 30 | 28 (guard at 28) | 1 init + up to 27 delegation cycles. With try-catch, each cycle = 1 iteration. Supports 7 levels x 3 attempts + margin. |
| Level-Manager | 30 | 3-4 | Simple coordination: delegate to react (iter 0), delegate to synthesizer (iter 1), return (iter 2). Guard at 10 for safety. |
| Level-React | 30 | 10 (guard at 10) | Setup (0), discover (1), play (2-8), return (9). The guard fires at `__iterCount >= 10`. |
| Synthesizer | 30 | 1 | One-shot analysis. Returns in iteration 0. |

### Action Budget Per Level

| Level | Human Baseline | Budget (1.1x) | Notes |
|-------|---------------|---------------|-------|
| 1 | 29 | 32 | 4 discovery + 28 gameplay |
| 2 | 41 | 45 | With knowledge from L1, should need fewer actions |
| 3 | 172 | 50 (capped) | Outlier. Use exploration-only mode for multiple passes. |
| 4 | 49 | 54 | |
| 5 | 53 | 58 | |
| 6 | 62 | 68 | |
| 7 | 82 | 90 | Fog of war level |

**Starting budget: 32 for all levels.** This is conservative but prevents the action blowout that killed games in 008. The orchestrator can increase the budget for later levels once knowledge accumulates (by setting `actionBudget` in `__level_task`).

### Total Budget Estimate

- 7 levels x 2 attempts x 32 actions = 448 actions (within the ~488 total baseline)
- 7 synthesizer calls = ~$0.14 (negligible)
- 7 level-managers = ~$2.10 at $0.30 each (if they return quickly)
- 7 react agents = ~$7.00 at $1.00 each
- 1 orchestrator = ~$0.50
- **Estimated total: ~$10-12 per run**

### The Action Budget Problem

This was the #1 unsolved problem in 008. Three observations:

1. **Budget enforcement at the sandbox level has failed 3 times.** The IIFE + Object.defineProperty mechanism is included as the best available defense, but we should not rely on it. The real defense is the level-manager's try-catch: if a react agent burns through its budget and times out, the manager still returns (with whatever the react agent managed before timeout).

2. **The 3-tier architecture provides natural budget containment.** Even if a react agent bypasses its budget and burns 100 actions, the level-manager catches the timeout and returns. The orchestrator then knows the level consumed many actions (from `arc3.observe()`) and can reduce the budget for subsequent levels. In the 2-tier model, a child timeout wasted the orchestrator's iteration with zero information.

3. **The synthesizer provides value even from failed plays.** If react takes 100 actions without completing the level, the synthesizer can still extract knowledge from the observations. In 008, knowledge from failed plays was always lost.

---

## 7. Risk Assessment

### Risk 1: Depth-3 Timeout Cascade (HIGH)

**What could go wrong:** The engine gives all agents 30 iterations regardless of `maxIterations`. If the react agent (depth 2) burns all 30 iterations, the level-manager (depth 1) waits for the full duration. If the manager then tries to call the synthesizer, it has already consumed most of its wall time on the react call. The manager might then time out itself, causing the orchestrator to lose the entire level delegation.

**Mitigation:** The manager uses try-catch around both `rlm()` calls. Even if react times out, the manager catches the error and has remaining iterations for the synthesizer (or to return immediately). The manager's guard at iteration 10 provides an additional backstop.

**Monitoring:** Check `--trace-children` output. If the manager consistently uses >5 iterations (instead of the expected 2-3), the timeout cascade is occurring.

### Risk 2: React Agent Still Doesn't Return (HIGH)

**What could go wrong:** The react agent has the same `__guard()` mechanism that achieved only 20% compliance in 008. If it does not call `if (__guard()) return(__guard.msg)` in its code blocks, it will burn 30 iterations without returning, and the manager will receive an empty string.

**Mitigation:** (a) The manager's try-catch ensures it returns even if react fails. (b) The delegation prompt includes the guard instruction. (c) The step interceptor sets `__done` and `__returnPayload` on budget exceeded / GAME_OVER / level completion, so IF the guard is called even once after these events, it triggers a return. (d) With `--trace-children`, we can finally SEE whether children call the guard.

**Expected impact:** Even if react returns 0% of the time, the manager still returns ~80%+ of the time (because its job is simple: try-catch + return). The orchestrator gets SOMETHING back for every delegation instead of nothing.

### Risk 3: Budget Bypass Causes GAME_OVER Before Reaching Level 2 (HIGH)

**What could go wrong:** Same as 008: a react agent bypasses the budget interceptor and burns 150+ actions on level 1, exhausting fuel/lives. GAME_OVER after level 1.

**Mitigation:** (a) The IIFE + Object.defineProperty defense is the strongest available. (b) The action budget is set to 32 (conservative). (c) The orchestrator tracks total actions via child returns and `arc3.observe()`, and can reduce budgets for subsequent levels. (d) Even if this happens, the synthesizer can extract knowledge from the blown budget -- unlike 008 where it was lost.

### Risk 4: Synthesizer Produces Low-Quality Knowledge (MEDIUM)

**What could go wrong:** The synthesizer uses `model: "fast"` (Gemini Flash) which is cheaper but less capable. It might produce shallow analysis, miss important patterns in the observations, or corrupt existing knowledge.

**Mitigation:** (a) The synthesizer's template includes explicit analysis steps. (b) The manager falls back to react's raw mechanics if synthesis fails. (c) The orchestrator's curation logic provides a second layer of quality control.

### Risk 5: Cost Overrun (MEDIUM)

**What could go wrong:** The 3-tier model spawns more agents per level (manager + react + synthesizer = 3 agents vs 1 player in 008). If react agents time out at 30 iterations consistently, each level costs ~$3 instead of ~$1.50, and a 7-level game could cost $20+.

**Mitigation:** (a) The orchestrator uses `model: "orchestrator"` (Sonnet, cheaper). (b) The synthesizer uses `model: "fast"` (Gemini Flash, very cheap). (c) The manager is designed to return in 2-3 iterations (cheap). (d) The react agent is the only expensive component, and its cost is similar to the v1.8.0 player.

### Risk 6: Three-Tier Overhead Costs Iterations Without Adding Value (MEDIUM)

**What could go wrong:** The manager layer adds 2-3 iterations of overhead per level (delegate to react, delegate to synthesizer, return). In the 2-tier model, the orchestrator delegated directly to the player with no overhead. If the synthesizer does not add value, the manager is pure overhead.

**Mitigation:** The manager's key value is GUARANTEED RETURN. In 008, 80% of players timed out. The manager catches timeouts and returns partial knowledge. Even if the synthesizer adds zero value, the manager's try-catch transforms a "lost child" into a "returned partial result." This alone justifies the overhead.

### Risk 7: The Engine Does Not Support `maxDepth >= 3` Correctly (LOW)

**What could go wrong:** The engine's delegation logic might have bugs at depth 3 that were not exposed at depth 2. Sandbox scoping, invocation ID generation, or context propagation might break at deeper nesting.

**Mitigation:** The default `maxDepth` in the engine is already 3 (confirmed in README). The engine code in `rlm.ts` handles arbitrary depth via `rlmInternal` recursion with no depth-2-specific code. Risk is low.

### What to Watch for in the First Run

1. **Does the level-manager return?** If the manager consistently returns (even with empty knowledge), the architecture is working. Check the orchestrator's output for `Level X (attempt Y): {...}` lines.

2. **Does react ever return before timeout?** Check `--trace-children` for react agent return rates. If 0%, the guard problem persists and we need engine-level fixes.

3. **Does the synthesizer produce useful output?** Compare the knowledge object before and after synthesizer calls. If it adds nothing or corrupts knowledge, switch to using react's raw output directly.

4. **Total actions before GAME_OVER.** If under 130, budget bypass is the problem. If over 300, budget enforcement is working or the agent is playing efficiently.

5. **Was any level completed?** The bar remains level 1 completion (29-action baseline). With knowledge transfer from prior attempts, later children should need fewer discovery actions.

6. **Cost.** Target: under $12 for a full 7-level game. If over $15, the 3-tier overhead is too expensive.
