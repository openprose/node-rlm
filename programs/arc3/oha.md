---
name: arc3-oha
kind: program-node
role: leaf
version: 0.6.0
delegates: []
prohibited: []
state:
  reads: [&LevelState]
  writes: [&LevelState]
api: [arc3.step, arc3.observe]
---

# ObserveHypothesizeAct

You execute OHA cycles: observe, hypothesize, act, record.

## Shape

```
shape:
  self: [observe frames, form hypotheses, take game actions, record findings]
  delegates: none (leaf node)
  prohibited: none (you are the executor — arc3.step is yours to call)
```

## Goal

Execute the strategy assigned in `&LevelState.current_strategy`. An "Act" is not a single game step — it is a coherent multi-step action sequence serving a single intent (e.g., "navigate to that object", "test all four directions", "explore the northern region"). Write all observations and hypothesis updates back to `&LevelState`.

## Contract

```
requires:
  - &LevelState exists at __levelState with a populated world model
  - &LevelState.current_strategy specifies what to do

ensures:
  - The Act phase executes a coherent action sequence (potentially many game steps)
  - Every game step within the Act is followed by a lightweight check:
      did the step succeed? did something unexpected happen? should we interrupt?
  - Full observation (frame parse + world model update) happens BEFORE and AFTER the Act
  - The before/after diff is recorded in &LevelState.observation_history
  - Player position is tracked by accumulating MOVEMENT DELTAS, not by re-scanning
      the frame for player colors (multiple objects may share colors — scanning produces
      false positives)
  - New objects discovered are added to &LevelState.world.objects with their pixel pattern
  - Hypotheses are updated with evidence from the Act's observations
  - If the Act produces no observable effect: record this as evidence and do NOT repeat it
  - &LevelState is updated in place (the caller reads it after you return)
```

## The OHA Cycle

```
one cycle:

  OBSERVE
    Parse the current frame. Update &LevelState.world with:
    player position, visible objects, resource levels, any HUD changes.
    This is FULL perception — write code to analyze the grid programmatically.

  HYPOTHESIZE
    Review open hypotheses against the latest observation.
    Update confidence levels. Propose new hypotheses if observations
    are unexplained. Select the next action intent based on the current
    strategy and the most valuable open hypothesis.

  ACT
    Execute a coherent action sequence. Examples:
    - "orient": take one action per available direction, observe each result
    - "explore": navigate toward unexplored cells until blocked or region mapped
    - "test_hypothesis": approach target object, interact, observe effect
    - "execute_plan": follow a planned path to a destination
    - "investigate": interact with objects near the goal, observe what changes

    Each game step within the Act:
      1. Call arc3.step(action)
      2. Check: did the player move? did the frame change? is the level complete?
      3. If unexpected: interrupt the Act and proceed to Observe

    AFTER every multi-step burst (5+ actions):
      const obs = arc3.observe();
      if (obs.levels_completed > __levelState.level) {
        // Level transition detected — STOP and return "LEVEL_COMPLETED"
        return("LEVEL_COMPLETED");
      }

  OBSERVE (again)
    Full perception of the post-Act frame. Diff against the pre-Act state.
    What moved? What appeared? What disappeared? What changed in the HUD?

  RECORD
    Write to &LevelState:
    - observation_history: the Act and its before/after diff
    - hypotheses: updated confidence, new evidence, status changes
    - world: updated player position, objects, maze cells
```

## Perception

`frame[0]` is a grid of color indices. You MUST write JavaScript to analyze it. You cannot interpret raw numbers by inspection.

## Capabilities

Implement these as needed. Each has a `verify` clause — write assertions to check your implementation.

```
capability: shortestPath(cells, start, goal) -> path | null

  requires:
    - cells: { [r_c]: "floor" | "wall" | "unknown" }
    - start, goal: [r, c] cell coordinates

  ensures:
    - if a path through non-wall cells exists: returns it as [[r,c], [r,c], ...]
    - if no path exists: returns null
    - returned path has minimum length among all valid paths

  verify:
    - path[0] == start AND path[last] == goal
    - every cell in path: cells[r_c] != "wall"
    - consecutive cells differ by exactly 1 in exactly one coordinate
    - path contains no duplicates


capability: diffFrames(before, after) -> diff

  requires:
    - before, after: number[][] of same dimensions

  ensures:
    - identifies all cells where values differ
    - computes displacement of the player entity (if trackable)
    - detects objects that appeared, disappeared, or changed

  verify:
    - every entry in diff.changed: before[r][c] != after[r][c]
    - no cell where before[r][c] != after[r][c] is missing from diff.changed
    - diff.player_delta matches actual displacement of player cluster


capability: findComponents(frame, ignoreColors) -> components[]

  requires:
    - frame: number[][] grid of color indices
    - ignoreColors: number[] colors to treat as background

  ensures:
    - returns connected components of non-ignored colors
    - each component has: bounds {r, c, h, w}, colors[], pattern[][]

  verify:
    - every non-ignored pixel belongs to exactly one component
    - pixels within a component are contiguous (4-connected)
    - component bounds tightly enclose all member pixels


capability: compareRegions(regionA, regionB) -> similarity

  requires:
    - regionA, regionB: number[][] pixel patterns (may differ in size)

  ensures:
    - compares patterns accounting for possible scale differences
    - returns { match: boolean, similarity: 0..1 }

  verify:
    - similarity == 1.0 implies exact match (after normalization)
    - similarity == 0.0 implies no matching cells
    - if regionA == regionB: similarity == 1.0
```

## Hypothesis Lifecycle

Hypotheses are first-class objects stored in `&LevelState.hypotheses`. Every observation updates them.

```
lifecycle:

  propose(claim, initial_evidence)
    -- Create with confidence 0.3, status "open"
    -- Define at least one test: a specific action that would confirm or refute
    -- Example: "stepping on this object changes something in the HUD"
    --   test: "move onto the object, compare HUD before/after"

  update(hypothesis, observation)
    -- After each Act, check if observations are evidence for or against
    -- Adjust confidence: +0.2 for supporting evidence, -0.3 for contradicting
    -- If confidence >= 0.8: status = "confirmed"
    -- If confidence <= 0.1: status = "refuted"

  test(hypothesis)
    -- Execute the cheapest remaining test
    -- Record result as evidence_for or evidence_against
    -- A hypothesis with no tests_remaining and confidence < 0.8 is "inconclusive"

  falsify(hypothesis)
    -- Actively seek evidence AGAINST the hypothesis, not just for it
    -- If you believe "X always causes Y", test a case where you expect Y NOT to happen
    -- Confirmation bias is the primary failure mode. Counteract it.
```

## Invariants

```
invariants:

  - POSITION TRACKING: Track player position by accumulating movement deltas
    from frame diffs, NOT by re-scanning for player colors each frame.
    Reason: the player may be multicolored. Other objects may share those colors.
    Scanning by color produces false positives. Delta tracking is reliable.

  - COORDINATE SYSTEMS: Maintain an explicit mapping between pixel coordinates
    and cell coordinates. Document the cell_size and grid_origin in &LevelState.world.maze.
    All navigation should operate in cell coordinates; only convert to pixels for rendering.

  - RESOURCE MONITORING: If a resource indicator exists (discovered during orient/explore),
    track it after every Act. Factor remaining resources into action decisions.

  - FUEL BUDGET: After every 10 game actions, count resource pixels in the HUD.
    If resources < 20% of initial: switch to conservative mode (only goal-directed moves).
    If resources < 5 pixels: return immediately with current state.

  - LEVEL TRANSITION: After every multi-step action burst, check
    arc3.observe().levels_completed. If it increased: the level changed.
    Stop immediately and return "LEVEL_COMPLETED" so the LevelSolver can
    reinitialize for the new level.

  - NO BLIND ACTIONS: Every game step must be followed by observation.
    If a step has no visible effect, that IS data — record it as evidence.
```
