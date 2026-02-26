---
name: arc3-solver
kind: program
version: 0.6.0
description: Solve ARC-3 interactive grid games through observation, hypothesis, and action
nodes: [game-solver, level-solver, oha]
---

# ARC-3 Solver

## Components

### game-solver

```
role: orchestrator
app: "game-solver"
api: [arc3.start, arc3.observe, arc3.getScore]
prohibited: [arc3.step]

good at:
  - managing the game lifecycle across all 7 levels
  - curating knowledge between level attempts
  - adjusting composition based on accumulated knowledge

bad at:
  - frame analysis (too far from the pixel level)
  - taking game actions (prohibited — delegate to children)

requires from caller:
  - arc3 client available in sandbox

produces for caller:
  - arc3.getScore() result

state:
  writes: &GameKnowledge (init + curation after every delegation)
  writes: &LevelState (fresh per level attempt)
```

### level-solver

```
role: coordinator
app: "level-solver"
api: [arc3.observe]
prohibited: [arc3.step]

good at:
  - maintaining strategic perspective across many action cycles
  - detecting when stuck and changing strategy
  - initializing &LevelState.world from first observation
  - writing structured key_findings before returning

bad at:
  - taking game actions (loses strategic view under tactical load)
  - frame analysis detail (delegates this to OHA)

requires from caller:
  - &GameKnowledge exists at __gameKnowledge (may be empty for first level)
  - &LevelState exists at __levelState with level, attempt, action_budget set

produces for caller:
  - &LevelState.world: initialized from first observation
  - &LevelState.key_findings: { key_insight, mechanics_discovered, strategies_tried, open_questions }
  - &LevelState.hypotheses: updated with confirmed/refuted status
  - return string: "{completed|failed}: {key_insight}"

does NOT produce:
  - game actions (prohibited)
  - raw frame data (delegates observation to OHA)

state:
  reads: &GameKnowledge
  reads/writes: &LevelState
```

### oha

```
role: leaf
app: "oha"
api: [arc3.step, arc3.observe]
prohibited: []

good at:
  - coherent multi-step action sequences
  - frame parsing and world model updates
  - hypothesis testing through experimentation
  - writing analysis code (diffFrames, findComponents, shortestPath)

bad at:
  - strategic planning across multiple attempts (sees only one cycle)
  - knowledge curation (writes findings to state but does not curate)

requires from caller:
  - &LevelState exists with current_strategy set
  - &LevelState.world has at least grid_dimensions populated

produces for caller:
  - &LevelState.world: updated with observations (player, objects, maze, hud)
  - &LevelState.hypotheses: updated with evidence
  - &LevelState.observation_history: appended with action records

does NOT produce:
  - &LevelState.key_findings (this is a coordinator responsibility)
  - curated knowledge (caller must extract insights from raw state)

state:
  reads/writes: &LevelState
```

## Composition Vocabulary

```
styles:

  direct
    Delegate straight to a leaf component (e.g., OHA).
    when: task is well-understood, mechanics are confirmed, budget is thin
    tradeoff: no strategic oversight between action cycles — faster but riskier
    caller must: satisfy the leaf's "requires from caller" directly
                 (e.g., initialize &LevelState.world yourself before delegating to OHA)

  coordinated
    Interpose a coordinator (e.g., level-solver) between yourself and the leaf.
    when: discovery is needed, multiple strategy cycles expected, stuck-detection matters
    tradeoff: overhead of an intermediary — slower but gains strategic perspective
    caller must: satisfy the coordinator's "requires from caller"
                 (coordinator handles the leaf's requirements)

  exploratory
    Delegate with minimal brief. Let the child discover.
    when: no prior knowledge, first encounter with a level or game element
    tradeoff: child may waste actions orienting, but avoids contaminating it
              with wrong assumptions
    combine with: direct or coordinated (orthogonal choice)

  targeted
    Delegate with rich brief constructed from confirmed &-state.
    when: retrying with accumulated knowledge, mechanics confirmed
    tradeoff: child benefits from prior knowledge but may over-rely on it
    combine with: direct or coordinated (orthogonal choice)
```

## Composition Principles

```
principles:

  1. CURATION IS THE RETURN ON COMPOSITION
     A flat architecture (one agent does everything) is simpler.
     A composed architecture only pays off if knowledge flows upward.
     If you delegate without curating the return, you paid the cost of
     composition without getting the benefit. Better to not delegate at all.

     After EVERY delegation:
       - Read &LevelState (or whatever the child wrote)
       - Promote confirmed findings to &GameKnowledge
       - Record what was tried and what failed
       - Preserve open questions

  2. COLLAPSE IS THE DEFAULT FAILURE MODE
     Without deliberate effort, agents absorb their children's work.
     A coordinator that "just takes a few actions to test" will take a hundred.
     Delegation is a commitment to abstraction separation.
     Partial delegation (taking some actions, delegating others) is worse than
     no delegation — it combines the overhead of composition with the blindness
     of direct action.

     Observable symptom: if you called arc3.step() and your role says
     prohibited: [arc3.step], you have collapsed.

  3. BUDGET PROPORTIONALITY
     The depth of your composed subtree should match the remaining budgets.

     if action_budget > 30 AND depth headroom >= 2:
       coordinated composition is justified
     if action_budget < 15 OR depth headroom == 1:
       direct composition — coordinator overhead is not justified
     if this is a retry AND prior composition failed structurally:
       try a different composition style

  4. SATISFY REQUIRES BEFORE DELEGATING
     Before calling rlm() with a component, check its "requires from caller".
     If you skip a coordinator (direct style), you inherit its responsibilities:
       - OHA requires &LevelState.world populated → you must call arc3.observe()
         and parse the frame yourself
       - OHA requires current_strategy set → you must set it
       - OHA does NOT produce key_findings → you must extract them yourself

  5. BRIEFS ARE INTERFACES
     When you delegate, pass the child facts from &-state — not your own analysis.
     Your analysis is at the wrong level of abstraction for the child.
     The child has its own program. The brief gives it context; the program
     gives it methodology.

     A brief contains:
       - The goal (what to achieve)
       - Confirmed knowledge (from &-state, with confidence levels)
       - Open questions (what the child should investigate)
       - If retry: what failed and what to try differently

     A brief NEVER contains:
       - Action-level instructions ("press action 6", "click on cells")
       - Game genre interpretation ("ARC puzzle", "Sokoban", "painting task")
       - Pixel analysis or color distributions
       - Tactical advice that overrides the child's strategy selection
```

## Shared State

State prefixed with `&` lives in the sandbox as a `__camelCase` variable (e.g., `&GameKnowledge` → `__gameKnowledge`). All agents read and write it directly — no serialization into prompts or return values.

Schemas are templates. Fields are populated through observation — their existence is not guaranteed until the agent discovers the corresponding game element.

### &GameKnowledge

Persists across levels. The orchestrator curates this after every delegation.

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
        pattern: number[][]
        is_multicolor: boolean
      }
      behavior: string
      locations_seen: [r, c][]
    }
  }

  level_outcomes: {
    [level]: {
      completed: boolean
      actions_used: number
      key_insight: string
      strategies_tried: string[]
      composition_used: string         -- "coordinated" | "direct" | etc.
      structural_issues: string[]      -- "coordinator played directly", "OHA timed out"
      maze_snapshot: { cells, grid_dims }
      known_objects: { [id]: { type, position, interacted } }
    }
  }

  open_questions: string[]
  refuted_beliefs: string[]
}
```

### &LevelState

Exists for the duration of one level attempt. Created fresh per attempt.

```
LevelState {
  level: number
  attempt: number
  actions_taken: number
  action_budget: number
  current_strategy: string

  world: {
    grid_dimensions: [rows, cols]
    background_colors: number[]

    player: {
      position: [r, c]
      size: [h, w]
      pattern: number[][]
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
      cell_size: number          -- pixels per cell (discovered, typically 5)
      grid_origin: [r, c]       -- pixel coords of cell (0,0)
      grid_dims: [rows, cols]   -- number of cells
      cells: { [r_c]: "floor" | "wall" | "unknown" }
      blocked_moves: { [r_c]: direction[] }
    }

    hud: {
      regions: {
        [name]: {
          position: [r, c, h, w]
          pattern: number[][]
          interpretation: string -- what the agent believes this shows
        }
      }
      resource_level: number     -- estimated from observation (0..1)
      resource_max: number
    }
  }

  hypotheses: {
    [id]: {
      claim: string
      evidence_for: string[]
      evidence_against: string[]
      confidence: 0..1
      status: "open" | "confirmed" | "refuted"
      tests_remaining: string[]
    }
  }

  observation_history: {
    action: number | string      -- action code or description
    before: { player_pos, world_snapshot }
    after: { player_pos, world_snapshot }
    diff: string
    hypothesis_updates: string[]
  }[]

  key_findings: {
    key_insight: string
    mechanics_discovered: {}
    objects_found: []
    strategies_tried: string[]
    open_questions: string[]
  }
}
```
