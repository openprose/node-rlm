# Delegation Deep Dive: Would More Budget Have Made Child RLMs Viable?

## Overview

This analysis examines the 3 delegation instances across runs 026 and 027 to determine whether child RLM delegation is fundamentally viable for ARC-AGI-2 tasks, or whether it is the wrong abstraction entirely. All 3 children hit their 7-iteration cap without returning. The question is: **if we doubled or tripled the child budget, would they have succeeded?**

**Critical limitation:** The node-rlm eval harness does not persist child agent traces in the results JSON. When a child hits max iterations, `rlm()` throws an `RlmMaxIterationsError` and only the error message propagates to the parent. The child's 7 iterations of reasoning, code, output, and errors are discarded. This means we cannot directly observe what the child did during its iterations. Instead, we must analyze: (a) what the parent passed to the child, (b) what the parent knew at delegation time, (c) what the parent did in recovery after delegation failed, and (d) how long the equivalent implementation took the parent.

**Recommendation for future evals:** Instrument the eval harness to capture child traces. Without this data, we are forced into counterfactual reasoning rather than direct observation.

---

## Delegation Instance 1: Run-026, `arc-195c6913`, Iteration 13

### Task Description

30x30 grids with two background regions separated by a staircase boundary. A template pattern of 2x2 colored blocks defines a repeating color sequence. Marker cells sit on the boundary edge. The transformation traces a path from each marker along the staircase boundary through the bg1 region, tiling the repeating pattern, and placing an endpoint color at each convex corner of the bg2 region.

### Parent State at Delegation Time

The parent had its conceptual breakthrough at iteration 12 (trace index 11). It had:
- Correctly identified bg1, bg2, template pattern sequence, endpoint color, and marker positions
- Manually traced the complete path for Train 0: position 0-12 on row 15, then endpoint color 4 at (15,13), then up col 12, endpoint at (3,12), then across row 4, etc.
- Verified the continuous position counting: "Pos 0-12: row 15, cols 0-12 (13 cells), then 4 at (15,13); Pos 13-23: col 12, rows 14-4 (11 cells), then 4 at (3,12)..."
- Explicitly verified actual cell values matched the pattern [2,2,8] repeating

The parent's understanding was correct and complete for Train 0. It had not yet verified the path tracing algorithm on Trains 1 and 2 (which have different staircase geometries).

### What Was Delegated

```javascript
const solution = await rlm("Implement the ARC solution", JSON.stringify({
  analysis: `
The transformation rule:
1. Two background colors (bg1=most common, bg2=second most common)...
2. A template pattern block (2-3 pairs of 2x2 colored blocks)...
3. An endpoint 2x2 block of a different color...
...
Path tracing algorithm:
- Start at marker position...
- Determine initial direction: go along the boundary (RIGHT if marker is on left edge, UP if on bottom, etc.)
- Follow the bg1 region: at each step, continue in the current direction as long as the next cell is bg1.
- When the path can't continue (next cell is bg2 or out of bounds), it has reached a staircase step.
- Place the endpoint color at the bg2 corner cell.
- Turn 90 degrees (always turning toward the boundary) and continue.
...`,
  taskData: context
}), {
  systemPrompt: `You are solving an ARC-AGI puzzle. You have access to the task data in context...
CRITICAL STEPS:
1. Parse the task data
2. For each grid, identify: bg1, bg2, template pattern, endpoint color, marker positions
3. Erase template and endpoint blocks (replace with bg2)
4. For each marker, trace a path along the staircase boundary through bg1, tiling the pattern
5. Place endpoint color at convex corners of bg2 along the path
6. Test against ALL training examples
7. Apply to test inputs and return the array of output grids
Return the final answer as JSON string: array of output grids.
Process directly using code. Do not delegate further.`,
  model: "intelligent"
});
```

### Analysis of the Delegation

**Context passing:** The parent passed the task data as `JSON.stringify({analysis: ..., taskData: context})`. This means the child received the analysis text AND the full ARC task data as a JSON-stringified string in its `context` variable. The child would need to `JSON.parse(context)` to get both the analysis and the taskData, then `JSON.parse(taskData)` to get the actual ARC grids. This is double-serialized and wasteful.

**Violation of shared-context-delegation pattern:** The parent did NOT use `__ctx.shared.data` (which already contains the root task data) or sandbox variables. Instead it inlined the full analysis text + task data into the 2nd argument. The `shared-context-delegation` driver explicitly warns against this: "Never inline large data in the `rlm()` query." The child could have read `__ctx.shared.data` directly for the task grids, and the parent could have written the analysis to a sandbox variable like `__task_impl = { analysis: "...", rules: [...] }`.

**Quality of instructions:** Excellent. The analysis is detailed, correct, and includes a step-by-step algorithm. The systemPrompt adds clear implementation steps. However, the turn direction logic is described as "turn 90 degrees (always turning toward the boundary)" -- this is underspecified and is precisely the detail that caused the parent itself to fail on Train 1 and 2.

**Was the result awaited?** Yes, `await rlm(...)`.

**Parallel delegation?** No. Single child, sequential.

### What the Child Would Have Needed

The parent itself, after the delegation failed, took 6 more iterations (traces 13-18) to implement the solution. Here is what it accomplished:

| Iteration | What happened | Result |
|-----------|--------------|--------|
| 14 (trace 13) | Implemented `solve()` function | Train 0: 1 diff, Train 1: 52 diffs, Train 2: 93 diffs |
| 15 (trace 14) | Debugged single diff on Train 0, analyzed Train 1 failures | Identified turn logic as root cause |
| 16 (trace 15) | Implemented `solve2()` with boundary-following | Same results (1, 52, 93 diffs) |
| 17 (trace 16) | Attempted turn direction fix | Worse (4, 71, 93 diffs) |
| 18 (trace 17) | Implemented `solve3()` with wall-following | Much worse (82, 131, 93 diffs) |
| 19 (trace 18) | Returned `solve2` results as best attempt | Score: 0 |

The parent needed 6 iterations and still could not get the turn logic right. The child, starting from scratch without the parent's accumulated variables (parsed grids, color frequency data, boundary points, path traces), would need:

1. **Parse the double-serialized context** (1 iteration)
2. **Extract structural elements** -- bg colors, template pattern, endpoint, markers (1-2 iterations)
3. **Implement path tracing with turn logic** (2-3 iterations)
4. **Test on training data and debug** (2-4 iterations)
5. **Apply to test and return** (1 iteration)

**Minimum estimate: 8-12 iterations. Realistic estimate: 12-15 iterations.**

### Would 15-20 iterations have helped?

**Probably not for a correct answer.** The parent itself failed to generalize the turn logic across all 3 training examples despite having accumulated context. The underspecified turn direction ("turn 90 degrees toward the boundary") is the core algorithmic challenge. A child starting fresh would face the same problem, potentially earlier (since it would need to discover the boundary geometry from scratch for each training example).

The child might have achieved the same partial result as the parent (1 diff on Train 0, failing on Trains 1 and 2) with ~12-15 iterations. But this would not have been a correct answer -- the parent already achieved this and scored 0.

**Verdict: More budget would not have made this delegation succeed.** The problem is not budget but algorithmic difficulty. The turn logic generalization was beyond what either parent or child could solve.

---

## Delegation Instance 2: Run-026, `arc-cbebaa4b`, Iteration 11

### Task Description

Puzzle piece assembly. Colored shapes with color "2" connectors must be assembled by matching ports with the same spacing pattern. Shape 4 (a filled rectangle) is the center anchor. Other shapes connect via BFS with overlapping 2-connectors.

### Parent State at Delegation Time

The parent had its conceptual breakthrough at iteration 5 (trace 5): shapes connect via shared 2-positions. By iteration 10 (trace 9), it had:
- Identified all shapes by color with their bounding boxes
- Extracted 2-connector positions for each shape
- Verified the connection mechanism on both training examples
- Determined that shape 4 is the center anchor
- Understood port matching requires same count + same spacing + opposite directions

The parent had a complete algorithmic understanding. It was delegating pure implementation.

### What Was Delegated

```javascript
const result = await rlm(
  "Solve this ARC puzzle by implementing the assembly algorithm",
  context,
  {
    systemPrompt: `You are solving an ARC-AGI puzzle. The task involves assembling shapes like puzzle pieces.

KEY INSIGHT (already discovered):
1. Each shape is a connected component of a single non-zero, non-2 color...
2. Color 2 cells are "connectors"...
3. One shape (color 4, a filled rectangle) is the CENTER piece
4. Other shapes connect to the center piece via matching connector ports
5. Two ports match when they have the same number of 2-cells with the same relative spacing pattern
6. When shapes connect, their 2-connector cells OVERLAP...
7. Shapes maintain their original orientation (no rotation/reflection)
8. The output is a fresh grid with all shapes assembled together

ASSEMBLY RULES:
- Shape 4 stays in place...
- Each shape's port connects to another shape's port when the 2-cells have matching spacing
- The shapes form a tree with shape 4 at the root...

ALGORITHM:
1. Extract all shapes with their bounding boxes and 2-connector positions
2. Group 2-connectors into "ports" by which side of the shape they're on
3. Start with shape 4 placed at center
4. For each unplaced shape, find a port that matches a port of an already-placed shape
5. Position the unplaced shape so its matching port's 2-cells overlap
6. Draw all shapes and their connectors on a fresh output grid

...Verify your solution against BOTH training examples before returning.`
  }
);
```

### Analysis of the Delegation

**Context passing:** The parent passed `context` directly as the 2nd argument. This is the raw ARC task JSON. The child receives it as-is in its `context` variable. This is correct -- the child can `JSON.parse(context)` to get the task. However, the parent still did not use `__ctx.shared.data`, which would have been equivalent and is the recommended pattern.

**Quality of instructions:** Outstanding. 8 key insights, 4 assembly rules, 6-step algorithm, port direction semantics, verification requirement, output format specification. This is among the best-structured delegation prompts one could write for this task.

**Was the result awaited?** Yes, `await rlm(...)`.

**Parallel delegation?** No. Single child, sequential.

### What the Child Would Have Needed

The parent, after the delegation failed, took 7 iterations (traces 11-17) to implement and perfect the solution:

| Iteration | What happened | Result |
|-----------|--------------|--------|
| 12 (trace 11) | Extracted shapes, ports, classified by side | Shape extraction working |
| 13 (trace 12) | Analyzed port spacing patterns for matching | Port signatures computed |
| 14 (trace 13) | Implemented BFS assembly with port matching | Training FAIL -- wrong shapes matched |
| 15 (trace 14) | Diagnosed: matching threshold too loose | Identified shapes 1 and 5 misplaced |
| 16 (trace 15) | Implemented greedy best-match BFS | Training PASS on both examples |
| 17 (trace 16) | Verified both training examples | "Train 0: PASS, Train 1: PASS" |
| 18 (trace 17) | Applied to test, returned answer | Score: 1 (perfect) |

The parent needed exactly 7 iterations to go from "start implementing" to "correct answer returned." This is precisely the child's budget. But the parent had critical advantages:

1. **Accumulated variables:** The parent had already parsed the task data, extracted shapes, and analyzed port positions in earlier iterations. Variables like `task`, shape bounding boxes, and 2-connector coordinates were already in the sandbox.
2. **Debugging context:** When the matching failed (trace 13), the parent could compare its prediction against the expected output it had already printed in earlier iterations.
3. **Incremental refinement:** The parent could refer back to its earlier port spacing analysis (trace 12) to refine the matching logic.

A child starting from scratch would need:
1. **Parse task data** (1 iteration)
2. **Extract shapes and 2-connectors** (1-2 iterations)
3. **Classify ports by side, compute spacings** (1 iteration)
4. **Implement BFS assembly** (1-2 iterations)
5. **Debug and fix matching** (1-2 iterations)
6. **Validate on training** (1 iteration)
7. **Apply to test and return** (1 iteration)

**Minimum estimate: 8-10 iterations. Realistic estimate: 10-14 iterations.**

### Would 15 iterations have helped?

**Yes, very likely.** This task has a clean, decomposable algorithm. The parent's instructions were excellent. The matching bug that the parent hit (threshold too loose) is discoverable through training validation feedback. With 15 iterations, the child would have:
- Iterations 1-3: Parse data, extract shapes and ports
- Iterations 4-6: Implement BFS assembly, test on training
- Iterations 7-9: Debug matching, refine to greedy best-match
- Iterations 10-12: Validate on training
- Iterations 13-15: Apply to test, return

**Verdict: 15 iterations would likely have been sufficient.** The task is well-structured, the instructions are clear, and the algorithm is correct. The child just needed more runway.

However, this raises the question: **was delegation the right choice?** The parent achieved a perfect score by implementing the solution itself in 7 iterations. The delegation cost 1 iteration (the failed call) plus the child's compute cost (7 iterations of a separate agent). If the child had succeeded with 15 iterations, the total cost would have been 11 parent iterations + 15 child iterations = 26 iteration-equivalents. The parent's direct approach cost 18 iterations total (10 exploration + 1 wasted delegation + 7 implementation). Direct implementation was more efficient.

---

## Delegation Instance 3: Run-027, `arc-4e34c42c`, Iteration 11

### Task Description

Object assembly by edge overlap. Extract non-background connected components (objects) from a grid, identify large objects (filtering out small standalone "label" objects), and stitch them together horizontally where their edges have matching values. The overlap width equals the maximum number of matching edge columns.

### Parent State at Delegation Time

The parent had its breakthrough at iteration 9 (trace 9): "find max overlap where edges match, stitch together." By iteration 10, it had:
- Identified background color, extracted all objects
- Classified objects as "large" (for assembly) vs "small standalone" (labels to ignore)
- Verified overlap values: Train 0 has 1-column overlap, Train 1 has 3-column and 1-column overlaps
- Examined both test inputs and their object structure
- Formulated the general algorithm

### What Was Delegated

```javascript
const result = await rlm("Solve this ARC-AGI task", context, {
  model: "intelligent",
  systemPrompt: `You are solving an ARC-AGI task. Analyze the training examples to find the transformation rule, then apply it to both test inputs.

Here's what I've discovered so far about the pattern:

1. The background color fills most of the grid. Non-background cells form several distinct objects.
2. There are two types of objects:
   - "Large compound objects" that have arms/extensions with patterns at their endpoints
   - "Small standalone objects" (typically 3x3) that appear separately in the grid
3. The small standalone objects also appear as sub-patterns within the larger objects' endpoints. They seem to serve as "labels" indicating which edges should connect.
4. The transformation ASSEMBLES all the large objects together by finding matching edges and overlapping them. The overlap size equals the maximum number of matching edge columns (or rows).
5. The output is always a single horizontal (or appropriately oriented) strip showing all objects stitched together.

Key verification from training examples:
- Train 0: A vertical object (5x3) connects to a horizontal object (5x10) with 1-column overlap. Output is 5x12.
- Train 1: Three objects chain together: A(3x13) + B(5x6) + C(5x7) with overlaps of 3 and 1 columns respectively. Output is 5x22.

The matching rule for overlap: Starting from the touching edges, count how many columns/rows have identical values when the objects are aligned (centering on the middle row/column). The maximum matching overlap determines the join.

There are 2 test inputs. Return an array of 2 output grids as JSON.

IMPORTANT: Return ONLY the raw JSON array of two grids. No explanation, no markdown.`
});
```

### Analysis of the Delegation

**Context passing:** The parent passed `context` directly (the raw ARC task JSON). The child would receive this via its `context` variable and could also access `__ctx.shared.data`. This is reasonable, though the parent did not leverage sandbox variables for its pre-computed analysis.

**Quality of instructions:** Good but incomplete. The instructions describe the pattern at a high level and include specific training example dimensions and overlap values. However:
- The instructions say "analyze the training examples to find the transformation rule" -- but the parent already found it. Why ask the child to re-discover it?
- The overlap rule is described verbally ("starting from the touching edges, count how many columns/rows have identical values when aligned") but no pseudocode is provided.
- No guidance on object extraction (connected component analysis, flood fill).
- No guidance on how to determine assembly order.
- The Train 1 description says "A(3x13)" but Train 1 Object A is actually 3 rows tall -- the child would need to independently figure out vertical centering/padding.

**Was the result awaited?** Yes, `await rlm(...)`.

**Parallel delegation?** No. Single child, sequential.

### What the Child Would Have Needed

The parent, after the delegation failed, took 9 iterations (traces 12-19 plus the timeout) but was plagued by wasted iterations:

| Iteration | What happened | Result |
|-----------|--------------|--------|
| 12 (trace 12) | Tried to call `findObjects()` | TypeError: findObjects is not a function |
| 13 (trace 13) | Tried `findObjects()` again | Same error |
| 14 (trace 14) | Implemented `findObjs()` successfully | Extracted 3 objects (Train 0), 4 objects (Train 1) |
| 15 (trace 15) | Classified large vs small objects | Printed patch contents |
| 16 (trace 16) | Implemented edge overlap detection | Train 0: overlap 1, Train 1: overlaps verified |
| 17 (trace 17) | Debugged overlap calculation with padding | Found mismatches requiring vertical centering |
| 18 (trace 18) | Fixed overlap direction and verified values | "Train 0: Obj1->Obj0: 1, Train 1: Obj2->Obj3: 3, Obj3->Obj0: 1" |
| 19 (trace 19) | Implemented `assembleHorizontal()`, validated perfectly | Perfect match on both training examples -- **but no return()** |
| 20 (timeout) | Hit iteration limit | Score: 0 |

Of the 9 iterations, 2 were wasted on scoping errors and 1 was the failed delegation. The actual implementation took 6 clean iterations (14-19). If we subtract the scoping errors, the parent needed 6 iterations from "start coding" to "perfect training validation."

A child starting fresh would need:
1. **Parse task data** (1 iteration)
2. **Implement connected component extraction** (1-2 iterations)
3. **Classify objects, extract patches** (1 iteration)
4. **Implement edge overlap matching** (2-3 iterations, including vertical centering)
5. **Implement horizontal assembly** (1-2 iterations)
6. **Validate on training** (1 iteration)
7. **Apply to test and return** (1 iteration)

**Minimum estimate: 9-12 iterations. Realistic estimate: 12-15 iterations.**

### Would 15 iterations have helped?

**Likely yes for training validation, but the test application is uncertain.** The algorithm is well-defined and the parent's instructions, while incomplete, give enough of a roadmap. With 15 iterations, the child would probably have:
- Iterations 1-4: Parse data, extract objects, classify
- Iterations 5-8: Implement overlap matching with centering
- Iterations 9-11: Implement assembly, validate on training
- Iterations 12-14: Debug any issues
- Iteration 15: Apply to test and return

However, there is a critical subtlety: the test inputs may have different object geometries (different numbers of objects, different centering requirements, different assembly chains). The child would need to implement a fully general algorithm, not just hardcode the training examples. This is where 15 iterations might be tight.

**Verdict: 15 iterations would have given the child a reasonable chance.** But the parent itself achieved perfect training validation in 6 clean iterations (plus 3 wasted ones). The delegation was entirely unnecessary -- the parent just needed to not waste 3 iterations on the delegation + scoping errors.

### The Counterfactual: What If The Parent Had Not Delegated?

This is the most damning case. The parent had a working, validated solution at iteration 19 (trace 19). It produced perfect output for both training examples:

```
Train 0 assembled:
6 8 9 8 8 8 8 8 8 8 8 8
6 1 1 1 8 8 2 8 2 3 3 3
6 1 4 1 1 1 2 2 2 3 2 3
6 1 1 1 8 8 2 8 2 3 3 3
6 8 9 8 8 8 8 8 8 8 8 8

Train 0 expected:
6 8 9 8 8 8 8 8 8 8 8 8
6 1 1 1 8 8 2 8 2 3 3 3
6 1 4 1 1 1 2 2 2 3 2 3
6 1 1 1 8 8 2 8 2 3 3 3
6 8 9 8 8 8 8 8 8 8 8 8
```

But it hit the 20-iteration limit without calling `return()`. The final code block validated training examples but did not apply to test inputs.

If the parent had not delegated (saving iteration 11) and not hit the scoping errors (saving iterations 12-13), it would have had 3 extra iterations. With those, it would have applied the working solution to both test inputs and returned, scoring a perfect 1.0.

**The delegation directly contributed to this task's failure.** It consumed 1 iteration that would have given the parent the buffer it needed.

---

## Cross-Cutting Analysis

### Question 1: What Was the Child Doing During Its 7 Iterations?

We cannot directly observe the child's iterations because the eval harness discards child traces. The child's `RlmMaxIterationsError` is the only signal. However, based on the task complexity and the parent's own implementation timelines, we can infer:

**Likely child progression for all 3 tasks:**
- Iterations 1-2: Parse the task data from the `context` string, display training examples
- Iterations 3-4: Begin implementing the algorithm described in the parent's instructions
- Iterations 5-6: Encounter first bugs, attempt debugging
- Iteration 7: Hit max iterations mid-implementation, no `return()` reached

The child almost certainly never completed a working implementation in any of the 3 cases. The minimum viable implementation path for these tasks is 8-12 iterations.

### Question 2: If the Child Had 15 or 20 Iterations, Would It Have Succeeded?

| Task | 15 iterations | 20 iterations | Rationale |
|------|--------------|--------------|-----------|
| arc-195c6913 | Unlikely | Unlikely | Turn direction generalization is the core unsolved problem. Neither parent nor child could crack it. |
| arc-cbebaa4b | Likely | Very likely | Clean decomposable algorithm. Parent's instructions are excellent. 7 iterations for implementation, 3-5 for debugging, 2-3 for test application. |
| arc-4e34c42c | Likely | Very likely | Well-defined overlap matching. Parent got perfect training validation in 6 clean iterations. Child with 15 iterations has ample runway. |

**Summary: 2 of 3 delegations would likely have succeeded with 15 iterations. But neither would have been more efficient than the parent implementing directly.**

### Question 3: Were the Parent's Instructions Good?

| Task | Instruction Quality | Issues |
|------|-------------------|--------|
| arc-195c6913 | Excellent (8/10) | Turn direction underspecified ("turn toward the boundary"). No pseudocode for the path tracer. |
| arc-cbebaa4b | Outstanding (9/10) | Comprehensive 8-point insight list, 6-step algorithm, port direction semantics, verification requirement. Minor: no pseudocode for port spacing comparison. |
| arc-4e34c42c | Good (6/10) | High-level pattern description but asks child to "analyze" rather than just implement. No connected component extraction guidance. No pseudocode for overlap matching. Train 1 dimensions are slightly misleading (3x13 implies 3 rows, but assembly requires 5-row centering). |

**Pattern:** Instructions improve with the parent's depth of understanding. The cbebaa4b instructions are the best because the parent had the clearest algorithmic picture. The 195c6913 instructions are weakened by the underspecified turn logic (which the parent itself hadn't fully solved). The 4e34c42c instructions are the weakest because they mix "discover the pattern" with "implement the solution."

### Question 4: Was There Any Parallel Delegation?

**No.** All 3 delegations were single `await rlm(...)` calls. No parent ever launched multiple children via `Promise.all()`.

**Should they have?** For these tasks, parallel delegation could theoretically have been useful:

- **arc-195c6913:** The parent could have launched 2-3 children, each testing a different turn direction algorithm (wall-following, boundary-side tracking, corner-based turning). This is Pattern 1 (Parallel Hypothesis Verification) from the `targeted-recursion` driver. However, the parent would have needed to provide concrete code for each hypothesis, which it hadn't formulated yet.

- **arc-cbebaa4b:** No clear parallelization opportunity. The algorithm is sequential (BFS assembly from center outward).

- **arc-4e34c42c:** The parent could have launched one child per test input (since the assembly algorithm is independent per input). But this requires a working algorithm first, which is what the delegation was trying to produce.

**Verdict:** Parallel delegation was not obviously applicable to these tasks. The `targeted-recursion` driver's Pattern 1 (parallel hypothesis verification) is the closest fit, but only if the parent had multiple concrete code implementations to test -- not the case in any of these delegations.

### Question 5: Did the Parent Await the Result?

**Yes, in all 3 cases.** All delegations used `await rlm(...)`. The parent blocked on the child's result before proceeding.

After receiving the error (max iterations), each parent handled it differently:

- **arc-195c6913:** Parent said "need to implement myself, deadline approaching" and immediately began coding. The error was caught by the eval harness (the delegation iteration's `error` field shows the max iterations message, and the output is empty).

- **arc-cbebaa4b:** Parent said "let me build the solution myself" and began extracting shapes. Clean recovery.

- **arc-4e34c42c:** Parent said "Let me solve this myself step by step" but then hit 2 consecutive scoping errors before recovering. The delegation failure compounded with implementation errors.

In all cases, the parent correctly detected the failure and pivoted to direct implementation. None attempted to re-delegate or launch a second child.

### Question 6: What Would Ideal Delegation Look Like?

For each task, here is what an ideal delegation would have looked like, given what the parent knew:

#### arc-195c6913 (staircase path tracing)

**The parent should not have delegated at all.** It had a deep understanding of the path geometry and had already traced the complete path for Train 0. Delegating "implementation" meant the child would start from zero context, re-parse everything, and still face the same turn logic challenge.

If delegation were forced, the ideal approach:
```javascript
// Write accumulated state to sandbox
__task_impl = {
  bg1_train0: 0, bg2_train0: 3,
  pattern_train0: [2, 2, 8],
  endpoint_train0: 4,
  markers_train0: [[15, 0]],
  traced_path_train0: [[15,1],[15,2],...,[15,12]], // actual path cells
  corner_positions_train0: [[15,13],[3,12],[4,18],[0,17]], // corners with endpoint color
};

// Delegate ONLY the generalization step
await rlm(
  "I've traced the path for Train 0. Generalize the path-tracing algorithm to work on all training examples. " +
  "Read __task_impl for Train 0 data. The task data is in __ctx.shared.data. " +
  "Write your solution function to __result_impl.",
  undefined, // child reads __ctx.shared.data directly
  { systemPrompt: "..." }
);
```

This gives the child concrete examples (not just verbal descriptions) and eliminates the data parsing overhead.

#### arc-cbebaa4b (puzzle piece assembly)

**Delegation was reasonable but the budget was wrong.** The ideal version:

```javascript
// Pre-compute and share shape data
__task_assembly = {
  shapes: extractedShapes, // [{color, cells, bbox, ports}]
  center_shape_color: 4,
  port_spacings: computedSpacings, // [{shape, side, diffs}]
};

const result = await rlm(
  "Implement BFS puzzle assembly. Shape data pre-computed in __task_assembly. " +
  "Place center shape, then greedily attach shapes with best port overlap. " +
  "Validate on both training examples. Write output grids to __result_assembly.",
  undefined,
  {
    systemPrompt: "You are implementing a shape assembly algorithm. " +
      "Read __task_assembly for pre-extracted shapes and their port spacings. " +
      "Task data available in __ctx.shared.data.",
    model: "intelligent"
  }
);
```

Key differences from actual:
1. Pre-computed shape data shared via sandbox (saves child 2-3 iterations)
2. Uses `__ctx.shared.data` instead of re-sending task data
3. Shorter, more focused prompt (the algorithm, not the discovery process)
4. Results written to sandbox variable (no large string return)

With these optimizations, 7 iterations might have been sufficient.

#### arc-4e34c42c (edge overlap assembly)

**The parent should not have delegated.** It had a working algorithm in mind and was 6 clean iterations from a perfect solution. The delegation cost was too high relative to the remaining budget.

If delegation were forced:
```javascript
__task_overlap = {
  train0_objects: extractedObjects0, // pre-extracted patches
  train1_objects: extractedObjects1,
  train0_overlaps: [{from: 1, to: 0, overlap: 1}],
  train1_overlaps: [{from: 2, to: 3, overlap: 3}, {from: 3, to: 0, overlap: 1}],
};

await rlm(
  "Implement horizontal assembly with edge overlap. Pre-extracted objects and known overlaps in __task_overlap. " +
  "Generalize the overlap-finding algorithm, apply to test inputs, write results to __result_overlap.",
  undefined,
  { systemPrompt: "..." }
);
```

### Question 7: Would the Drivers Have Helped?

#### `targeted-recursion` Driver

This driver defines 3 valid patterns and 4 anti-patterns for delegation:

**Pattern 1 (Parallel Hypothesis Verification):** Not applicable. None of the 3 delegations were testing multiple hypotheses in parallel. All were single-child implementation delegations.

**Pattern 2 (Edge-Case Subproblem):** Not applicable. The parents were delegating the entire implementation, not a specific edge case.

**Pattern 3 (Independent Answer Verification):** Not applicable. No verification delegation was attempted.

**Anti-pattern: Budget Extension.** All 3 delegations match this anti-pattern exactly. The driver explicitly warns: "Children get at most 7 iterations at depth 1 and start without your accumulated context." Every delegation was attempting to extend budget by offloading implementation work to a child -- the classic "budget extension" anti-pattern.

**Anti-pattern: Verbal Analysis.** The arc-4e34c42c delegation partially matches this. Its instructions tell the child to "analyze the training examples to find the transformation rule" -- asking for analytical work that the parent had already completed.

**Would it have prevented the failures?** Yes. The gate check requires both conditions:
1. "The subtask is independent" -- partially true for these tasks
2. "The payoff is parallelism" -- **false for all 3 delegations**. None used `Promise.all()` or continued other work while the child ran.

If the parent had applied the gate check, it would have rejected all 3 delegations because condition 2 fails. The driver also includes the cost-benefit rule: "Each same-model child costs ~3-7 [parent iterations]. Delegate only when parallel children save more parent iterations than they consume." Since none were parallel, the cost-benefit is always negative.

**Impact estimate: The `targeted-recursion` driver would have prevented all 3 delegation failures, saving 3 parent iterations across the 3 tasks.** For arc-4e34c42c specifically, this would have been the difference between scoring 0 (timeout) and potentially scoring 1 (perfect).

#### `shared-context-delegation` Driver

This driver teaches efficient data passing via sandbox variables:
- Parent writes data to `__task_{role}`, child reads it
- Child writes results to `__result_{role}`, parent reads after
- Never inline large data in the `rlm()` query
- `__ctx.shared.data` is always available at every depth

**Would it have improved the delegations?** Yes, modestly:

1. **arc-195c6913:** The parent serialized the analysis + task data into a single JSON string as the 2nd argument. With this driver, it would have written `__task_impl = { analysis, parsedData }` and told the child to read it. This would have saved the child 1 iteration of parsing overhead, but would not have solved the turn logic problem.

2. **arc-cbebaa4b:** The parent passed `context` directly, which is fine. But it could have also shared pre-computed shape data, saving the child 2-3 iterations of extraction work. With the reduced overhead, 7 iterations might have been barely sufficient.

3. **arc-4e34c42c:** The parent passed `context` directly. Sharing pre-extracted objects and overlap values would have saved the child significant startup cost.

**Impact estimate: The `shared-context-delegation` driver would have reduced child startup overhead by 2-3 iterations per delegation, making the 7-iteration budget more viable but still tight for these complex tasks.**

---

## Fundamental Viability Assessment

### Is Delegation the Right Abstraction for ARC?

Based on these 3 instances plus the 37 non-delegation trajectories, delegation has a narrow viability window for ARC tasks:

**When delegation could work:**
- The algorithm is fully specified and correct (all training examples pass)
- The child needs to do mechanical work (apply a known transform to test inputs)
- Pre-computed data is shared via sandbox variables (reducing child overhead)
- The child budget is 12-15+ iterations
- Parallel children test independent hypotheses

**When delegation does not work (current state):**
- The algorithm has unresolved edge cases (turn logic in 195c6913)
- The child must re-derive everything from raw data (no sandbox sharing)
- The child budget is 7 iterations
- Single sequential child (no parallelism benefit)
- The parent already has the context to implement directly

**The core tension:** By the time the parent has enough understanding to write good delegation instructions, it has enough understanding to implement the solution itself. The delegation overhead (data re-parsing, context loss, budget limitations) makes the child strictly less efficient than the parent continuing directly.

### Specific Recommendations

1. **Raise the depth-1 iteration cap from 7 to 15.** The current cap makes child delegation non-viable for any task requiring more than trivial implementation. The `iterationsForDepth` function in `rlm.ts` (line 84) sets `caps = [Infinity, 7, 4, 3]`. Changing the depth-1 cap to 15 would make 2 of 3 observed delegations viable.

2. **Instrument child traces in results JSON.** The fact that child iterations are discarded (line 473 of `rlm.ts`: `return result.answer` without `result.trace`) makes it impossible to diagnose delegation failures. Add a `childTraces` field to the parent trace entry that stores the child's full trace.

3. **Include `targeted-recursion` and `shared-context-delegation` in future ARC eval runs.** These drivers directly address the observed failure modes. The `targeted-recursion` driver's gate check would prevent wasteful single-child implementation delegations. The `shared-context-delegation` driver would reduce child startup overhead.

4. **Add a "delegation discouraged" driver for current budget constraints.** Until the child budget is raised, add a simple driver: "Do not delegate implementation to child RLMs. At 7 iterations, children cannot complete the parse-implement-test-debug-return cycle for ARC tasks. Implement directly."

5. **Experiment with exploration delegation.** None of the 40 trajectories delegated exploration or hypothesis testing. When a parent is stuck in analysis paralysis (as in run-027 arc-195c6913 and arc-446ef5d2), delegating a "fresh perspective" child might break the deadlock. This is untested and worth exploring.

### The Bottom Line

**Delegation is not fundamentally wrong for ARC, but it is currently misconfigured.** The 7-iteration child budget is insufficient, the lack of sandbox variable sharing creates wasteful overhead, and the absence of parallel delegation eliminates the only efficiency advantage delegation could offer. With a 15-iteration budget, sandbox sharing, and the `targeted-recursion` driver's gate check, delegation could become a viable but situational tool -- useful for parallel hypothesis testing and edge-case investigation, but still suboptimal for "write the whole algorithm" requests.

The most impactful change would be the `targeted-recursion` driver, which would have prevented all 3 observed failures by rejecting them at the gate check. The second most impactful change would be raising the child iteration cap to 15, which would have made 2 of 3 delegations viable (though less efficient than direct implementation).

---

## Appendix: Data Sources

- Run-026 results: `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-026-drivers/results/arc_anthropic_claude-opus-4-6_2026-02-13T17-38-47-083Z.json`
- Run-027 results: `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-027-baseline/results/arc_anthropic_claude-opus-4-6_2026-02-13T17-38-49-180Z.json`
- Trajectory annotations:
  - `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-026-drivers/trajectory-analysis/trajectories/arc-195c6913.md`
  - `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-026-drivers/trajectory-analysis/trajectories/arc-cbebaa4b.md`
  - `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-027-baseline/trajectory-analysis/trajectories/arc-4e34c42c.md`
- Driver definitions:
  - `/Users/sl/code/trinity/node-rlm/plugins/drivers/targeted-recursion.md`
  - `/Users/sl/code/trinity/node-rlm/plugins/drivers/shared-context-delegation.md`
- RLM source (iteration budget, child trace handling): `/Users/sl/code/trinity/node-rlm/src/rlm.ts` (lines 84-87, 444-478)
- Child system prompt construction: `/Users/sl/code/trinity/node-rlm/src/system-prompt.ts` (lines 84-99)
