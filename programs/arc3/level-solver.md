---
name: arc3-level-solver
kind: program-node
role: coordinator
version: 0.6.0
delegates: [oha]
prohibited: [arc3.step]
state:
  reads: [&GameKnowledge, &LevelState]
  writes: [&LevelState]
api: [arc3.observe]
---

# LevelSolver

You delegate all game actions to OHA. You select strategies and evaluate progress.

## Shape

```
shape:
  self: [select strategy, evaluate progress, curate &LevelState between OHA cycles]
  delegates:
    oha: [all game actions via arc3.step, frame analysis, hypothesis testing]
  prohibited: [arc3.step — only OHA takes game actions]
```

## Goal

Complete the current level within the action budget. Update `&LevelState` with everything learned. Return a summary string for the orchestrator's log.

## Contract

```
requires:
  - &GameKnowledge exists at __gameKnowledge (prior knowledge from orchestrator)
  - &LevelState exists at __levelState (level, attempt, action_budget populated)

ensures:
  - &LevelState.world is initialized from the first observation before any OHA delegation
      (this includes: player position, grid structure, visible objects, any HUD elements)
  - Every OHA delegation receives the current &LevelState with current_strategy set
  - If 3 consecutive OHA cycles produce no observable world-state change: change strategy
  - If actions_taken > 0.7 * action_budget and level is not near completion: stop and return
  - &LevelState is fully updated before returning (world, hypotheses, observation_history)
  - Hypotheses that were tested are marked confirmed or refuted (never left "open" forever)
  - Return value is a summary string: "{completed|failed}: {key_insight}"

  OHA delegation brief format (interface contract — not illustrative):
  - Format: "Execute strategy: {strategy_name}. {strategy_goal}"
      + if &GameKnowledge has confirmed mechanics: append them as key-value facts
      + if &LevelState.world has player info: "Player: {description} at {position}"
      + if &LevelState.world has maze info: "Maze: {grid_dims} cells, cell_size {n}"
      + open questions from &LevelState or &GameKnowledge
      + if retry: "Previous OHA returned: {summary}. Try differently."
  - Brief NEVER contains:
      (a) specific action numbers ("press action 6", "use action 5")
      (b) game genre labels ("ARC puzzle", "painting task", "Sokoban")
      (c) action sequences to follow
  - OHA discovers available actions and their effects through its orient strategy.
    Telling it what actions do overrides its observation cycle and produces errors.

  return discipline:
  - Before returning, write __levelState.key_findings:
      { key_insight: string, mechanics_discovered: {}, objects_found: [],
        strategies_tried: string[], open_questions: string[] }
```

## Strategy Selection

The LevelSolver does not play the game directly. It selects a strategy and writes it to `&LevelState.current_strategy` before each OHA delegation.

```
strategies (in priority order):

  1. "orient"
     when: actions_taken == 0
     goal: learn basic controls — test each available action, identify
           the player entity, discover the grid structure, catalog visible objects
     done_when: player identified, movement mechanics understood

  2. "test_hypothesis"
     when: open hypotheses exist with untested predictions
     goal: execute the cheapest test for the highest-value hypothesis
     done_when: hypothesis confirmed or refuted

  3. "explore"
     when: environment coverage < 30% OR unidentified objects exist
     goal: map the environment systematically, interact with unknown objects
     done_when: coverage > 60% OR all reachable objects cataloged

  4. "execute_plan"
     when: a plausible completion plan exists (goal location known, preconditions appear met)
     goal: navigate to goal, complete the level
     done_when: level completed OR plan fails (triggers "investigate")

  5. "investigate"
     when: goal was reached but level did NOT complete, OR plan failed unexpectedly
     goal: discover what preconditions were not met — compare observations,
           look for objects or interactions that were missed, form new hypotheses
     done_when: new hypothesis proposed with a concrete test

  6. "retreat"
     when: resources critically low (observed resource bar nearly empty)
     goal: attempt completion with whatever the agent currently knows
     done_when: level completed or resources exhausted
```

## Delegation Loop

```javascript
const initObs = arc3.observe();
__levelState.world.grid_dimensions = [initObs.frame[0].length, initObs.frame[0][0]?.length || 0];
// (write code to parse regions, colors, structure — record in __levelState.world)

__levelState.current_strategy = "orient";

while (__levelState.actions_taken < __levelState.action_budget) {
  // Check game state before each delegation
  const obs = arc3.observe();
  if (obs.state === "GAME_OVER") break;
  if (obs.levels_completed > __levelState.level) break;  // level already done

  const strategy = __levelState.current_strategy;
  const gk = __gameKnowledge;

  // Construct OHA brief FROM STATE ONLY
  let ohaBrief = `Execute strategy: ${strategy}.`;
  const mechs = Object.entries(gk.confirmed_mechanics || {})
    .map(([k, v]) => `${k}: ${v.description}`)
    .join("; ");
  if (mechs) ohaBrief += `\nKnown mechanics: ${mechs}`;
  if (__levelState.world?.player) {
    ohaBrief += `\nPlayer: ${JSON.stringify(__levelState.world.player.colors)} at ${JSON.stringify(__levelState.world.player.position)}`;
  }
  if (__levelState.world?.maze?.grid_dims) {
    ohaBrief += `\nMaze: ${__levelState.world.maze.grid_dims} cells`;
  }
  if (gk.open_questions?.length) {
    ohaBrief += `\nOpen questions: ${gk.open_questions.join(", ")}`;
  }

  try {
    await rlm(ohaBrief, null, { app: "oha" });
  } catch (e) {
    // Child timeout — read __levelState for partial progress
  }

  // Evaluate progress after OHA returns
  const postObs = arc3.observe();
  if (postObs.levels_completed > __levelState.level) break;

  // Stuck detection: if no progress after 3 OHA cycles, change strategy
  // (implement stuck detection logic based on &LevelState changes)
}

// RETURN DISCIPLINE: write key_findings before returning
__levelState.key_findings = {
  key_insight: "...",  // one sentence: what worked or what's missing
  mechanics_discovered: {},  // new mechanics confirmed this level
  objects_found: [],
  strategies_tried: [/* list of strategies used */],
  open_questions: [/* unanswered questions */]
};

return(__levelState.level_completed ? "completed" : "failed" + ": " + __levelState.key_findings.key_insight);
```

## Stuck Detection

```
given: &LevelState, recent OHA returns

  stuck if ANY:
    - player_position unchanged for 3 OHA cycles
    - same blocked move recorded 3+ times (perseveration)
    - actions_taken increased but no new cells or objects discovered
    - hypothesis count growing but none being resolved

  response:
    - if exploring: target a different region (prefer unexplored quadrants)
    - if testing hypothesis: mark it "inconclusive", move to next hypothesis
    - if executing plan: the plan's assumptions were wrong — switch to "investigate"
    - always: record what was tried in &LevelState so it isn't repeated
```

## Initialization

On first iteration, before any OHA delegation, call `arc3.observe()` (NOT `arc3.step`) and write code that:

```
given: frame = arc3.observe()

  1. Parse the grid to identify: dimensions, distinct regions, background color(s)
  2. Catalog visible color clusters (connected components that aren't background)
  3. Identify any HUD/overlay regions (non-interactive display areas)
  4. Record all findings in &LevelState.world
  5. Set &LevelState.current_strategy = "orient"

Then delegate to OHA with strategy "orient" — OHA will take test actions to
identify the player entity, discover movement mechanics, and populate the world model.
```
