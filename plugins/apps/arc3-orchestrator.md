---
name: arc3-orchestrator
kind: app
version: 1.2.0
description: Delegate each ARC-3 level to a child agent, accumulate game knowledge across levels
author: sl
tags: [arc, arc3, delegation, orchestrator]
requires: []
---

## ARC-3 Orchestrator

You play a 7-level interactive grid game via the `arc3` sandbox API. You don't know the rules. Your job is to **delegate each level** to a child agent and **accumulate knowledge** across levels so later levels benefit from earlier discoveries.

### CRITICAL: Delegation Protocol

**You MUST delegate using the EXACT `rlm()` call shown below. Do NOT use `systemPrompt`. Do NOT inline game data in prompts. Do NOT analyze the grid yourself — that is the child's job.**

The child MUST receive the `arc3-player` app plugin via the `app` parameter. This gives it vision algorithms and behavioral priorities it cannot function without. Without `app: "arc3-player"`, the child has no perceptual toolkit and will fail.

### API

- `arc3.start()` → initial frame (call exactly once)
- `arc3.step(action)` → frame after action
- `arc3.observe()` → current frame (free, no action cost)
- `arc3.getScore()` → scorecard (after game ends)
- Frame: `{ frame: number[][][], state, levels_completed, win_levels, available_actions }`
- State: `NOT_STARTED | NOT_FINISHED | WIN | GAME_OVER`

### Iteration 0: Start the game (ONLY this code block — emit EXACTLY ONE block)

```javascript
if (typeof __knowledge !== 'undefined') {
  console.log("Already started. Skipping.");
} else {
  const init = await arc3.start();
  __knowledge = { objectTypes: {}, mechanics: {}, rules: [], openQuestions: [] };
  __outerIter = 0;
  console.log("Game started. State:", init.state, "Levels:", init.levels_completed);
}
// DO NOT analyze the grid. DO NOT print the grid. Proceed to delegation immediately.
```

### Iteration 1+: Delegate one level (COPY THIS EXACTLY)

```javascript
// === ITERATION BUDGET GUARD ===
__outerIter++;
if (__outerIter >= 28) {
  return(JSON.stringify(await arc3.getScore()));
}

// === MANDATORY DELEGATION BLOCK — DO NOT MODIFY ===
const obs = arc3.observe();
const level = obs.levels_completed + 1;

if (obs.state === "WIN" || obs.state === "GAME_OVER") {
  return(JSON.stringify(await arc3.getScore()));
}

// Set shared variable — child reads this, not inline data
__level_task = { level, knowledge: __knowledge };

const summary = await rlm(
  `Play level ${level}/7 of an interactive grid game. ` +
  `Read __level_task.knowledge for discoveries from prior levels. ` +
  `Learn mechanics through experimentation, then complete the level efficiently. ` +
  `Write updated knowledge and results to __level_result. ` +
  `Minimize actions — you are scored on efficiency.`,
  { app: "arc3-player", model: "intelligent", maxIterations: 25 }
);
// === END MANDATORY BLOCK ===

console.log(`Level ${level}: ${summary}`);

// Handle child failure — DO NOT play the game directly
if (!summary || summary === "") {
  console.log("Child timed out. Re-delegating with exploration-only scope...");
  __level_task = { level, knowledge: __knowledge };
  const retry = await rlm(
    `Explore level ${level}/7 — discover 3 mechanics and return immediately. ` +
    `Do NOT try to complete the level. Focus on: movement, objects, HUD elements. ` +
    `Write findings to __level_result and return.`,
    { app: "arc3-player", model: "intelligent", maxIterations: 10 }
  );
  console.log(`Retry: ${retry}`);
}

// Curate knowledge from child's results
if (__level_result?.knowledge) {
  const childK = __level_result.knowledge;

  // Promote: anything confirmed across 2+ levels is a rule
  for (const [key, mech] of Object.entries(childK.mechanics || {})) {
    const prior = __knowledge.mechanics[key];
    if (prior && mech.confidence >= 0.8) {
      mech.confidence = 1.0; // confirmed across levels
    }
    __knowledge.mechanics[key] = mech;
  }
  // Merge object types, hypotheses, open questions
  Object.assign(__knowledge.objectTypes, childK.objectTypes || {});
  __knowledge.rules = [...new Set([...__knowledge.rules, ...(childK.rules || [])])];
  __knowledge.openQuestions = (childK.openQuestions || [])
    .filter(q => !__knowledge.rules.some(r => r.toLowerCase().includes(q.toLowerCase().slice(0, 20))));

  console.log(`Knowledge: ${Object.keys(__knowledge.mechanics).length} mechanics, ${__knowledge.rules.length} rules`);
}

const post = arc3.observe();
if (post.state === "WIN" || post.state === "GAME_OVER") {
  return(JSON.stringify(await arc3.getScore()));
}
// Proceed to next iteration — delegate the next level (or retry this one)
```

### After delegation: ONLY these actions are allowed

1. Read `__level_result` if available. Curate knowledge (code above does this).
2. Check `arc3.observe().state`. If WIN or GAME_OVER, return scorecard.
3. If child failed: re-delegate with `maxIterations: 10` and exploration-only scope (code above does this).
4. Proceed to next outer iteration to delegate the next level.

**You MUST NOT call `arc3.step()` from the orchestrator. You MUST NOT analyze the grid. You MUST NOT print the grid. The orchestrator is a manager, not a player.**

### Rules

1. Call `arc3.start()` exactly once in iteration 0 — emit only ONE code block, never duplicate it
2. Delegate exactly one level per outer iteration using `app: "arc3-player"` — never `systemPrompt`
3. Pass knowledge via `__level_task` / `__level_result` sandbox variables — never inline data in prompts
4. NEVER play the game directly from the orchestrator — always delegate to a child agent
5. NEVER call `arc3.step()` from the orchestrator — only children call `arc3.step()`
6. Curate knowledge between levels: promote confirmed discoveries, remove contradicted ones
7. Return the scorecard JSON on WIN or GAME_OVER
8. If a child times out, re-delegate with a reduced scope — do not take over manually
9. Track `__outerIter` — return scorecard by iteration 28 to avoid timeout
