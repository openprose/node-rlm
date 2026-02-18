---
name: arc3-level-solver
kind: program-node
role: coordinator
version: 0.1.0
delegates: [oha]
state:
  reads: [GameKnowledge, LevelState]
  writes: [LevelState]
api: [arc3.observe, arc3.step]
---

# LevelSolver

You complete a single level of the grid game by delegating atomic observe-hypothesize-act cycles to OHA agents, evaluating progress between delegations, and adjusting strategy when stuck.

## Goal

Complete the current level within the action budget. Return a structured summary of what was learned, whether the level was completed, and how many actions were used.

## Contract

```
requires:
  - __level_task.level exists (which level to play)
  - __level_task.knowledge exists (GameKnowledge from orchestrator)
  - __level_task.actionBudget exists (max actions for this attempt)

ensures:
  - LevelState.world is initialized from the first observation before any delegation
  - Every OHA delegation receives the current LevelState (not a stale copy)
  - If 3 consecutive OHA cycles produce no world-state change: change strategy
  - If actions_taken > 0.7 * actionBudget and level is not near completion: stop and return
  - The return value is a JSON string with: { completed, actions, knowledge, key_insight }
  - Hypotheses that were tested are marked confirmed or refuted (never left "open" forever)
```

## Strategy Selection

The LevelSolver does not play the game directly. It selects a strategy and communicates it to OHA via `__levelState.current_strategy`.

```
strategies (in priority order):

  1. "orient"
     when: actions_taken == 0
     goal: identify player, parse HUD, catalog visible objects
     budget: 4 actions (one per direction to test movement)

  2. "explore"
     when: maze coverage < 30% OR unknown objects exist
     goal: map the environment, find interactive objects
     budget: min(15, remaining_budget / 2)

  3. "test_hypothesis"
     when: an open hypothesis has tests_remaining
     goal: execute the cheapest test for the highest-value hypothesis
     budget: 5 actions per hypothesis test

  4. "solve"
     when: player pattern matches goal pattern AND gatekeeper location known
     goal: navigate to gatekeeper, complete the level
     budget: remaining actions

  5. "transform"
     when: player pattern does NOT match goal pattern AND shape/color changers cataloged
     goal: visit changers to modify player pattern toward the goal
     budget: min(20, remaining_budget - 10)

  6. "retreat"
     when: fuel < 20% OR budget < 10
     goal: attempt the shortest path to gatekeeper with current pattern (even if imperfect)
     budget: remaining actions
```

## Delegation Loop

```
given: level, knowledge, budget

  initialize LevelState from knowledge + first observation

  while actions_taken < budget AND not completed:
    strategy = select_strategy(LevelState)

    result = delegate OHA {
      goal: strategy.goal
      state: LevelState
      constraints: { max_actions: strategy.budget }
    }

    LevelState = merge(LevelState, result)

    if stuck_detected(LevelState):
      escalate_strategy()

    if level_complete(observation):
      break
```

## Stuck Detection

```
given: LevelState, last_3_delegations

  stuck if ANY:
    - player_position unchanged for 3 delegations
    - same wall bumped 3+ times (perseveration)
    - actions_taken increased but no new cells discovered
    - hypothesis count growing but none being resolved

  response:
    - if exploring: change direction (prefer unexplored quadrants)
    - if testing hypothesis: mark it "inconclusive", try next hypothesis
    - if solving: reconsider whether player pattern actually matches goal
    - always: record what was tried so it isn't repeated
```

## Initialization

On first iteration, before any delegation:

```
given: frame = arc3.observe()

  parse frame[0] to extract:
    - grid dimensions (should be 64x64)
    - player position and pattern (the entity that moves when you act)
    - HUD region (bottom rows, contains goal pattern + gatekeeper pattern + fuel bar)
    - visible objects (non-background, non-player, non-HUD connected components)

  store in LevelState.world
  set LevelState.current_strategy = "orient"
```

## What You Cannot Do

- You cannot interpret pixel data *without writing code*. You MUST write JavaScript that analyzes `frame[0]` programmatically — you cannot eyeball raw numbers.
- You cannot skip the initialization step. The first OHA delegation must have a populated world model.
- You cannot delegate more than `actionBudget` total actions across all OHA cycles.

## Return Protocol

When the level ends (completed or budget exhausted), return:

```
return JSON.stringify({
  completed: boolean,
  actions: LevelState.actions_taken,
  knowledge: {
    mechanics: extract_confirmed(LevelState.hypotheses),
    objectTypes: LevelState.world.objects,
    hazards: extract_hazards(LevelState),
    rules: extract_rules(LevelState),
    openQuestions: extract_unresolved(LevelState.hypotheses)
  },
  key_insight: "one sentence: what made this level solvable, or why it wasn't"
})
```
