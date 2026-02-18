---
name: arc3-solver
kind: program
version: 0.1.0
description: Solve ARC-3 interactive grid games through observation, hypothesis, and action
nodes: [game-solver, level-solver, oha]
---

# ARC-3 Solver

A 3-tier RLM program for playing interactive grid games with unknown rules.

## Shared State

### GameKnowledge

Persists across levels. The orchestrator curates this between delegations.

```
GameKnowledge {
  confirmed_mechanics: {
    [name]: {
      description: string
      confidence: 0..1
      evidence: string[]
      first_seen: level
    }
  }

  object_catalog: {
    [type]: {
      visual: {
        colors: number[]
        size: [h, w]
        pattern: number[][]     -- pixel pattern at native resolution
        is_multicolor: boolean
      }
      behavior: string           -- what it does when interacted with
      locations_seen: [r, c][]   -- where it's been found
    }
  }

  level_outcomes: {
    [level]: {
      completed: boolean
      actions_used: number
      key_insight: string        -- "what made this level solvable?" or "why did it fail?"
      strategies_tried: string[] -- to avoid repetition
    }
  }

  open_questions: string[]       -- things to investigate next
  refuted_beliefs: string[]      -- things we used to believe that turned out wrong
}
```

### LevelState

Exists for the duration of one level attempt. Created fresh by LevelSolver.

```
LevelState {
  level: number
  attempt: number
  actions_taken: number
  action_budget: number

  world: {
    grid_dimensions: [rows, cols]
    background_colors: number[]

    player: {
      position: [r, c]
      size: [h, w]
      pattern: number[][]        -- the player's current pixel pattern
      colors: number[]
    }

    objects: {
      [id]: {
        type: string             -- from object_catalog, or "unknown"
        position: [r, c]
        size: [h, w]
        pattern: number[][]
        interacted: boolean
      }
    }

    maze: {
      cells: { [r_c]: "floor" | "wall" | "unknown" }
      blocked_moves: { [r_c]: direction[] }  -- walls we've bumped into
    }

    hud: {
      goal_pattern: number[][]       -- the target pattern (bottom-left box)
      gatekeeper_pattern: number[][] -- the pattern on the goal gate (bottom-right box)
      fuel_remaining: number         -- estimated from fuel bar pixels
      fuel_max: number
    }
  }

  hypotheses: {
    [id]: {
      claim: string
      evidence_for: string[]
      evidence_against: string[]
      confidence: 0..1
      status: "open" | "confirmed" | "refuted"
      tests_remaining: string[]  -- specific actions that would test this
    }
  }

  observation_history: {
    action: number
    before: { player_pos, objects_snapshot }
    after: { player_pos, objects_snapshot }
    diff: string                 -- human-readable description of what changed
    hypothesis_updates: string[]
  }[]
}
```

## Composition

```
GameSolver
  for each level:
    delegates -> LevelSolver(GameKnowledge, level, budget)
    receives <- { LevelState.hypotheses, LevelState.world, outcome }
    curates GameKnowledge from results

LevelSolver
  loop until complete or budget exhausted:
    delegates -> ObserveHypothesizeAct(LevelState)
    receives <- updated LevelState
    evaluates progress, adjusts strategy if stuck

ObserveHypothesizeAct
  one atomic step:
    reads LevelState
    observes, hypothesizes, acts, observes again
    writes updated LevelState
```
