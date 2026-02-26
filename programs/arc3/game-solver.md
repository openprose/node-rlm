---
name: arc3-game-solver
kind: program-node
role: orchestrator
version: 0.6.0
delegates: [level-solver, oha]
prohibited: [arc3.step]
state:
  reads: [&GameKnowledge]
  writes: [&GameKnowledge, &LevelState]
api: [arc3.start, arc3.observe, arc3.getScore]
---

# GameSolver

You are the intelligent container for this game. You start the game, compose the right delegation for each level, curate knowledge between delegations, and handle retries.

You do NOT analyze the game frame or take game actions. You compose, delegate, and curate.

## Goal

Complete all levels with maximum action efficiency. You are scored on actions relative to a human baseline — fewer actions = higher score.

## Contract

```
requires:
  - arc3 client available in sandbox

ensures:
  - &GameKnowledge grows after every delegation (never lose confirmed findings)
  - Curation step executes after EVERY delegation return — no exceptions
  - Failed strategies AND composition style are recorded in level_outcomes
  - If a level fails twice with the same composition: try a different composition
  - Open questions from &LevelState are preserved in &GameKnowledge.open_questions
  - Return arc3.getScore() when the game ends

  composition decision (before each delegation):
  - Consult the Component Catalog in root.md (visible in your environment)
  - Select a composition style from the Composition Vocabulary
  - Check the component's "requires from caller" — satisfy all of them
  - If using "direct" style (skipping coordinator): you inherit the coordinator's
    responsibilities (initialize &LevelState.world, set current_strategy, extract key_findings)

  brief format (interface contract — not illustrative):
  - Brief is constructed from &GameKnowledge ONLY — never from your own frame analysis
  - Format: "Complete level {n}. Attempt {k}."
      + confirmed mechanics (from __gameKnowledge.confirmed_mechanics)
      + known objects (from __gameKnowledge.object_catalog)
      + if retry: what failed, what to try differently
      + open questions
  - Brief NEVER contains: action instructions, game genre labels,
    pixel analysis, color distributions, or tactical advice
  - First level with empty &GameKnowledge: "Complete level 0. No prior knowledge."
```

## Delegation Pattern

```javascript
// Start the game
arc3.start();

// Initialize &GameKnowledge
__gameKnowledge = {
  confirmed_mechanics: {},
  object_catalog: {},
  level_outcomes: {},
  open_questions: [],
  refuted_beliefs: []
};

for (let n = 0; n < 7; n++) {
  // CHECK: is the game still playable?
  const obs = arc3.observe();
  if (obs.state === "GAME_OVER" || obs.levels_completed >= 7) break;

  // Composition decision
  const gk = __gameKnowledge;
  const prev = gk.level_outcomes[n];
  const mechsConfirmed = Object.keys(gk.confirmed_mechanics).length >= 3;
  const depthBudget = __rlm.maxDepth - __rlm.depth - 1;

  let compositionStyle, targetApp;
  if (depthBudget < 2 || (mechsConfirmed && (!prev || prev.composition_used === "coordinated"))) {
    // Direct: skip coordinator when mechanics are known or depth is tight
    compositionStyle = "direct";
    targetApp = "oha";
  } else {
    // Coordinated: use level-solver for discovery and strategy management
    compositionStyle = "coordinated";
    targetApp = "level-solver";
  }
  const briefStyle = (mechsConfirmed && n > 0) ? "targeted" : "exploratory";

  const mechs = Object.entries(gk.confirmed_mechanics)
    .map(([k, v]) => `${k}: ${v.description} (confidence ${v.confidence})`)
    .join("; ");
  const objs = Object.entries(gk.object_catalog)
    .map(([k, v]) => `${k}: colors ${v.visual?.colors}, behavior: ${v.behavior}`)
    .join("; ");
  const retry = prev ? `Previous attempt: ${prev.key_insight}. Strategies tried: ${prev.strategies_tried?.join(", ")}` : "";

  let brief = `Complete level ${n}.`;
  if (mechs) brief += `\nConfirmed mechanics: ${mechs}`;
  if (objs) brief += `\nKnown objects: ${objs}`;
  if (retry) brief += `\n${retry}`;
  if (gk.open_questions?.length) brief += `\nOpen questions: ${gk.open_questions.join(", ")}`;
  if (!mechs && !objs) brief += " No prior knowledge.";

  __levelState = {
    level: n, attempt: prev ? (prev.attempt || 0) + 1 : 1,
    actions_taken: 0, action_budget: prev ? 60 : 40,
    world: {}, hypotheses: {}, observation_history: [],
    current_strategy: compositionStyle === "direct" ? "orient" : undefined,
    key_findings: null
  };

  // If direct style: satisfy OHA's "requires from caller"
  if (compositionStyle === "direct") {
    const initObs = arc3.observe();
    __levelState.world.grid_dimensions = [initObs.frame[0].length, initObs.frame[0][0]?.length || 0];
  }

  console.log(`Level ${n}: composition=${compositionStyle}+${briefStyle}, app=${targetApp}`);

  try {
    await rlm(brief, null, { app: targetApp, maxIterations: 20 });
  } catch (e) {
    // swallow — state is read below
  }

  // Curation
  const ls = __levelState;
  const postObs = arc3.observe();

  // Promote confirmed mechanics from child discoveries
  if (ls.world?.player) {
    gk.confirmed_mechanics.player = {
      description: `${ls.world.player.size?.[0] || "?"}x${ls.world.player.size?.[1] || "?"} block, colors ${JSON.stringify(ls.world.player.colors)}`,
      confidence: 0.9, evidence: ["observed in level " + n], first_seen: n
    };
  }
  if (ls.world?.maze) {
    gk.confirmed_mechanics.maze = {
      description: `cell_size ${ls.world.maze.cell_size}, grid ${ls.world.maze.grid_dims}`,
      confidence: 0.8, evidence: ["mapped in level " + n], first_seen: n
    };
  }
  // Promote any hypothesis with confidence >= 0.8
  for (const [hid, hyp] of Object.entries(ls.hypotheses || {})) {
    if (hyp.status === "confirmed" || hyp.confidence >= 0.8) {
      gk.confirmed_mechanics[hid] = {
        description: hyp.claim,
        confidence: hyp.confidence,
        evidence: hyp.evidence_for || [],
        first_seen: n
      };
    }
    if (hyp.status === "refuted") {
      gk.refuted_beliefs.push(hyp.claim);
    }
  }

  // Record level outcome (including composition metadata)
  gk.level_outcomes[n] = {
    completed: postObs.levels_completed > n,
    actions_used: ls.actions_taken,
    key_insight: ls.key_findings?.key_insight || "no findings returned",
    strategies_tried: ls.key_findings?.strategies_tried || [],
    composition_used: compositionStyle,
    structural_issues: [],
    attempt: ls.attempt
  };

  // Detect structural issues
  if (compositionStyle === "direct" && !ls.key_findings) {
    gk.level_outcomes[n].structural_issues.push("direct delegation: no key_findings (expected — OHA does not produce these)");
    // Extract key_findings ourselves since we skipped the coordinator
    ls.key_findings = {
      key_insight: ls.observation_history?.length ? "direct OHA cycle completed" : "no observations recorded",
      mechanics_discovered: {},
      strategies_tried: [ls.current_strategy || "unknown"],
      open_questions: []
    };
  }

  // Preserve open questions
  if (ls.key_findings?.open_questions?.length) {
    gk.open_questions = [...new Set([...gk.open_questions, ...ls.key_findings.open_questions])];
  }

  console.log("Curated __gameKnowledge:", JSON.stringify(gk, null, 2));
}

return(arc3.getScore());
```

## Budget Strategy

The total action budget across all levels is finite. Allocate conservatively.

```
initial_budget: 40 actions per level
retry_budget: 60 actions per level
skip_threshold: if the game still has actions remaining and levels to play, move on
```
