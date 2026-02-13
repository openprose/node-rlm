# Deep Analysis: Run-029 Parallel-Decomposition Delegation Failure

**Run ID:** 029
**Model:** Claude Opus 4.6
**Task set:** 20 ARC-AGI-2 tasks (same set as run-026)
**Configuration:** maxIterations=20, maxDepth=2, concurrency=5
**Driver under test:** `parallel-decomposition` (+ 12 other drivers from run-026)
**Comparison baseline:** Run-026 (same 12 drivers, no parallel-decomposition)
**Score:** 9/20 (45%) vs run-026's 13/20 (65%) --- a 20 percentage point regression

---

## 1. Executive Summary

**The parallel-decomposition driver was almost completely ignored.** Of 20 tasks, exactly 1 task (`arc-36a08778`) performed an `rlm()` delegation call, and that task scored 0 (wrong answer). The other 19 tasks proceeded as if the driver did not exist: they parsed tasks directly, explored hypotheses manually, implemented transforms themselves, and never once set up the coordinator protocol (no `taskAnalysis`, no `hypothesisResults`, no `Promise.all`, no `transformA`/`transformB`).

The regression from 65% to 45% was NOT caused by the delegation protocol consuming iterations on coordination overhead. It was caused by **run-to-run variance amplified by the small sample size (n=20)** and **one case where delegation actively hurt** (arc-36a08778). The 4 regressed tasks show varied failure modes unrelated to delegation: a missing `return()` call, incorrect conditional logic, a satellite assignment bug, and an overfitted child solution. None of the 4 regressions involved wasted iterations on delegation setup.

The driver's "When NOT to use parallel decomposition" escape clause --- which says to skip delegation if "the task is simple enough to solve in < 5 iterations" or "Phase 1 analysis reveals an obvious single transformation" --- gave the agent a blanket justification to ignore the protocol entirely. The agent took this permission on every single task.

---

## 2. Driver Compliance Audit

### Scoring Methodology

- **Ignored**: No evidence of driver protocol in reasoning or code. Agent proceeds with standard direct-solve approach.
- **Acknowledged-but-abandoned**: Agent references shared variables or delegation concepts but never executes delegation.
- **Partially-followed**: Agent sets up some Phase 1 artifacts (sharedTask, taskAnalysis) but skips Phase 3 (delegation).
- **Fully-followed**: Agent completes Phases 1-4 as specified.

### Per-Task Audit

| Task ID | Score | Iterations | Compliance | Evidence |
|---------|-------|------------|------------|----------|
| arc-247ef758 | 1 | 8 | **Ignored** | Standard orient/hypothesize/implement flow. No shared variables, no delegation. |
| arc-0934a4d8 | 0 | 20 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-135a2760 | 0 | 20 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-136b0064 | 0 | 20 | **Ignored** | Standard exploration and hypothesis testing. No delegation patterns. |
| arc-2ba387bc | 1 | 19 | **Acknowledged-but-abandoned** | Set `sharedTask = task` in iteration 0 (echoing Phase 1 from the driver) but never used it for delegation. Proceeded with 8 hypotheses tested manually over 15 iterations. |
| arc-195c6913 | 0 | 20 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-5961cc34 | 1 | 16 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-446ef5d2 | 0 | 19 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-6e453dd6 | 0 | 10 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-4e34c42c | 0 | 20 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-7ed72f31 | 0 | 11 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-a251c730 | 1 | 15 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-89565ca0 | 0 | 20 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-8f3a5a89 | 1 | 20 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-78332cb0 | 0 | 18 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-36a08778 | 0 | 14 | **Partially-followed** | Set `sharedTask = task`. Used `await rlm()` delegation at iteration 10. Did NOT use `Promise.all`, `taskAnalysis`, `hypothesisResults`, `transformA`/`transformB`. Single child, not parallel. |
| arc-aa4ec2a5 | 1 | 12 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-db695cfb | 1 | 11 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-b99e7126 | 1 | 13 | **Ignored** | Standard exploration. No delegation patterns. |
| arc-cbebaa4b | 1 | 20 | **Ignored** | Standard exploration. No delegation patterns. |

### Summary

| Compliance Level | Count | Percentage |
|-----------------|-------|------------|
| Ignored | 18 | 90% |
| Acknowledged-but-abandoned | 1 | 5% |
| Partially-followed | 1 | 5% |
| Fully-followed | 0 | 0% |

**Zero tasks followed the full protocol.** The parallel-decomposition driver had effectively zero compliance.

---

## 3. The One Delegation (arc-36a08778)

### What the Driver Prescribed

The driver specifies a 4-phase protocol:
1. **Phase 1 (Orient, iter 0-2):** Parse task, store `taskAnalysis` and `sharedTask`, initialize `hypothesisResults = {}`.
2. **Phase 2 (Formulate, iter 2-3):** Identify 2-3 distinct hypotheses.
3. **Phase 3 (Delegate, iter 3-4):** Launch 2-3 children via `Promise.all([rlm(...), rlm(...)])`.
4. **Phase 4 (Harvest, iter 5+):** Read `hypothesisResults`, pick best, refine.

### What Actually Happened

**Iterations 0-9: Standard solo exploration.** The agent spent 10 iterations doing exactly what it would do without the driver --- parsing the task, visualizing grids, identifying 6-markers and 2-segments, tracing rectangle chains across 6 training examples. No `taskAnalysis` variable was set. No `hypothesisResults` board was initialized. The agent was the solver, not the coordinator.

**Iteration 10: A single rlm() call (not parallel).** After 10 iterations of manual analysis, the agent delegated to ONE child:

```javascript
const result = await rlm(
  `Solve this ARC task. The parsed task is in 'sharedTask'. There are 6 training examples...
  The pattern involves:
  - Colors 7 (background), 2 (segments), 6 (markers/borders)
  - Input has vertical pairs of 6-markers and horizontal 2-segments
  - Output draws rectangles of 6s around each 2-segment, connected in a spiral/chain...`,
  context,
  {
    systemPrompt: `You are solving an ARC-AGI puzzle...`,
    model: "intelligent"
  }
);
```

**Deviations from the protocol:**

1. **No `Promise.all`**: Single child, not parallel.
2. **No `taskAnalysis` variable**: The parent's 10 iterations of analysis were compressed into the prompt text, not stored in sandbox variables.
3. **No `hypothesisResults`**: No results board for cross-pollination.
4. **No `transformA`/`transformB`**: The child stored its transform as `bestTransform`, not the driver-prescribed variable name.
5. **No parallel hypotheses**: The single child was told to test one hypothesis (the parent's spiral-chain theory), not multiple competing hypotheses.
6. **No cross-pollination**: With only one child, there was nothing to cross-pollinate.
7. **Context passed as prompt text, not shared variables**: The parent wrote the hypothesis into the `rlm()` prompt string instead of storing it in `sharedTask`/`taskAnalysis` for the child to read.

**Iterations 11-13: Harvest and return.** The parent received the child's result, verified it against training (6/6 pass), and returned the test outputs.

**Result: Score 0.** The child's implementation passed all 6 training examples but produced incorrect test outputs. Specifically, the rectangle-drawing logic had off-by-one errors on the test case (rows 3-4 had incorrectly positioned 6-borders).

### Comparison with run-026 (same task, no delegation driver)

In run-026, the agent solved `arc-36a08778` itself in 18 iterations:
- Iterations 0-8: Exploration (same quality as run-029's parent)
- Iterations 9-17: Implementation with 5 refinement attempts, debugging wall-extension logic, blockRow checks
- Iteration 18: 6/6 training pass, applied to test, returned

The critical difference: **run-026 spent 9 iterations debugging its own implementation**, catching subtle edge cases (walls passing through used segments, blockRow checks). In run-029, the parent delegated at iteration 10 and the child had to implement AND debug in a single child invocation. The child produced code that passed training but failed to generalize.

**Root cause of delegation failure:** The parent over-specified the pattern in its prompt ("spiral/chain"), causing the child to implement an overfitted solution. The parent then trusted the training score (6/6) without inspecting test outputs. Had the parent spent those 4 remaining iterations (11-14) refining the child's solution itself --- like run-026 did --- it likely would have caught the edge case.

---

## 4. Why Delegation Was Avoided

### 4.1 The Escape Clause Was Too Permissive

The driver explicitly says:

> **When NOT to use parallel decomposition:**
> - If the task has only 1-2 training examples (not enough signal to differentiate hypotheses)
> - If your Phase 1 analysis reveals an obvious single transformation (just solve it directly)
> - **If the task is simple enough to solve in < 5 iterations**

Every ARC task begins ambiguously. From the agent's perspective at iteration 0, ANY task might be "simple enough" once the pattern is found. The agent's standard approach (orient, hypothesize, implement) already works well. The driver gave the agent permission to skip delegation, and the agent took that permission 100% of the time.

### 4.2 No Tasks Were Obviously "Multi-Hypothesis" at Phase 1

The driver prescribes launching parallel children when the parent identifies "2-3 distinct transformation hypotheses." In practice, ARC task exploration is sequential: the agent examines training examples, forms ONE hypothesis, tests it, refines or rejects it. The agent's natural workflow is hypothesis-then-test, not hypothesis-then-delegate.

At iteration 2-3 (when the driver says to formulate hypotheses), the agent typically has a vague sense of the pattern, not crisp competing theories. Delegation requires pre-specifying what each child should test, which requires more advance understanding than the agent has at that point.

### 4.3 The 12 Other Drivers Competed for Attention

The parallel-decomposition driver was injected alongside 12 other drivers:
- `one-block-per-iteration`
- `deadline-return`
- `verify-all-examples`
- `verify-before-return`
- `hypothesis-budget`
- `exploration-budget`
- `arc-helper-library`
- `overlap-testing`
- `json-stringify-return`
- `return-format-discipline`
- `await-discipline`
- `no-tool-calls` (or similar)

Several of these drivers actively discourage delegation behavior:
- `one-block-per-iteration` encourages sequential, focused execution
- `exploration-budget` pressures the agent to move quickly to implementation
- `verify-before-return` encourages the agent to test its own code rather than trust children

The agent prioritized these concrete, actionable drivers over the abstract coordination protocol. The parallel-decomposition driver required a fundamental change in problem-solving strategy; the others required only behavioral tweaks.

### 4.4 The Agent Does Not Naturally Coordinate

All 20 tasks show the same Phase header format in iteration 0:

```
Iteration 0 of 20. Phase: orient. Implementation attempts: 0.
```

This was consistent across ALL tasks, showing that the system prompt included the phased structure. But the agent treated "Phase: orient" as a label for its own exploration, not as Phase 1 of the parallel-decomposition coordinator protocol. The agent's default behavior is to **be the solver**, not to delegate.

The `Phase: orient` / `Phase: hypothesize` / `Phase: implement` / `Phase: verify` labels are evidence that SOME driver was influencing the iteration header format, but this was interpreted as personal work phases, not coordinator phases.

### 4.5 Trust Deficit: The Agent Does Not Trust Children

The one task that delegated (`arc-36a08778`) reveals the trust problem:
- The parent spent 10 iterations building its own understanding
- Then it delegated to a child with extensive instructions
- The child produced a solution that passed training
- The parent trusted it and returned immediately

But the child's solution was wrong. This is the fundamental risk of delegation for ARC tasks: children have less context than the parent (no visual grid inspection, no iterative refinement), and their solutions are harder to verify than the parent's own code.

### 4.6 Iteration Budget Felt Sufficient for Solo Work

With 20 iterations and ARC tasks that typically require 10-18 iterations, the agent had no pressure to seek leverage. The driver argues for a "30:1 leverage ratio" (1 parent iteration = 30-45 child iterations), but the agent didn't perceive an iteration shortage. Most tasks were solved (or failed) within the budget without delegation.

---

## 5. Run-029 vs Run-026 Regression Analysis

### The Numbers

| Metric | Run-026 | Run-029 | Delta |
|--------|---------|---------|-------|
| Score | 13/20 (65%) | 9/20 (45%) | -4 (-20pp) |
| Regressions (026=1, 029=0) | --- | 4 tasks | --- |
| Improvements (026=0, 029=1) | --- | 0 tasks | --- |
| Both solved | 9 tasks | 9 tasks | --- |
| Both failed | 7 tasks | 7 tasks | --- |

### The 4 Regressed Tasks

**1. arc-136b0064 (snake path encoding)**
- Run-026: Solved in 17 iterations. Systematic hypothesis testing, found "all L's then R's" rule, verified 3/3 training, returned correct answer.
- Run-029: Found the same rule but hit iteration limit (20) without calling `return()`. The agent discovered test-time novelty (doubled shapes) at iteration 18 with only 2 iterations left. Implemented `solve3()` but logged the answer to console instead of calling `return()`.
- **Delegation involvement:** None. The agent never delegated. This was a pure timeout failure.
- **Root cause:** Stochastic. The agent happened to take 3 more iterations to reach the hypothesis this run, leaving insufficient buffer for the test-time edge case.

**2. arc-36a08778 (connected rectangles around segments)**
- Run-026: Solved in 18 iterations. Explored for 8 iterations, then spent 9 iterations on 5 implementation refinements, debugging wall-extension logic incrementally. Achieved 6/6 training pass and correct test output.
- Run-029: Explored for 9 iterations, delegated to child at iteration 10. Child produced code that passed 6/6 training but failed on test. Parent trusted training score, returned wrong answer at iteration 13.
- **Delegation involvement:** Direct cause. The delegation substituted the parent's careful iterative debugging with a single child invocation that lacked the refinement depth to generalize correctly.
- **Root cause:** Delegation bypassed the incremental debugging that made run-026 successful. The parent's prompt over-specified the "spiral" pattern, and the child implemented it literally rather than discovering the true edge-case-handling logic.

**3. arc-6e453dd6 (shape shift + 2s fill)**
- Run-026: Solved in 11 iterations. Three hypotheses tested (H1: row gaps, H2: enclosed holes, H3: enclosed holes + maxC). Breakthrough at iteration 8, clean implementation, 3/3 training pass, correct test output.
- Run-029: Four hypotheses tested, found similar pattern. Implementation at iteration 7 passed 3/3 training but had incorrect conditional logic for edge detection (`touchesMinus1 && !touchesMinus2` was too simplistic). The test case exposed the flaw. Returned wrong answer at iteration 9.
- **Delegation involvement:** None. The agent never delegated.
- **Root cause:** Stochastic. The agent found a slightly different (incorrect) formulation of the conditional rule that happened to pass the training data but failed on test. Run-026's formulation was more precise.

**4. arc-7ed72f31 (reflection across 2-lines)**
- Run-026: Solved in 10 iterations. Identified reflection pattern, caught 4-connectivity bug, switched to 8-connectivity, verified, returned correct answer.
- Run-029: Identified same reflection pattern, implemented with correct 8-connectivity, passed 2/2 training, but satellite assignment logic (Manhattan distance heuristic) failed on test case with complex spatial arrangement.
- **Delegation involvement:** None. The agent never delegated.
- **Root cause:** Stochastic. The satellite-to-mirror assignment heuristic was too simplistic. Run-026 happened to produce a more robust implementation.

### Attribution of the -20pp Regression

| Cause | Tasks | Score Impact |
|-------|-------|-------------|
| Delegation actively harmed | 1 (arc-36a08778) | -1 |
| Stochastic variance (different implementation paths) | 2 (arc-6e453dd6, arc-7ed72f31) | -2 |
| Stochastic variance (timeout/return failure) | 1 (arc-136b0064) | -1 |
| **Total regression** | **4** | **-4** |

**Only 1 of the 4 regressions (25%) was caused by the delegation driver.** The other 3 are run-to-run variance. With n=20 tasks, a 4-task swing (20pp) is within the expected variance of repeated runs.

### Iteration Cost Analysis for Both-Solved Tasks

For the 9 tasks both runs solved, run-029 averaged 1.7 more iterations per task:
- Run-026 average: 13.2 iterations
- Run-029 average: 14.9 iterations

This is a modest overhead. The largest outlier was `arc-2ba387bc` (10 vs 19 iterations), where run-029's agent churn through 8 hypotheses while run-026's agent found the raster-scan rule faster. This is not related to delegation (neither run delegated for this task).

---

## 6. Recommendations

### 6.1 Make the Driver Non-Optional (Structural Enforcement)

The current driver says "you ARE a coordinator" but then provides escape clauses. The agent treats the driver as advice, not a requirement. To force compliance:

**Option A: Remove the escape clause entirely.** Change "When NOT to use parallel decomposition" to "You MUST delegate at least once per task. If you believe the task is simple, delegate with a single child and verify its result."

**Option B: Structural enforcement at the harness level.** Instead of relying on the agent to self-coordinate, make the harness automatically launch parallel children after N iterations. The system prompt tells the agent it will receive child results at iteration 5, and it should formulate hypotheses accordingly.

**Option C: Dedicated coordinator prompt.** Instead of mixing the coordinator role with the solver role, create a separate system prompt where the agent ONLY coordinates. It cannot write transform functions directly; it can only write `rlm()` calls. This forces delegation by removing the alternative.

### 6.2 Reduce Driver Count (Driver Competition)

13 drivers compete for the agent's attention. The parallel-decomposition driver requires a fundamental behavioral change, while the others (verify-before-return, deadline-return, etc.) are incremental behavioral tweaks. Recommendation: test the parallel-decomposition driver in ISOLATION, with only 2-3 essential supporting drivers (deadline-return, json-stringify-return).

### 6.3 Increase Iteration Budget for Delegation Runs

The driver claims 20 iterations is sufficient ("1 parent iteration buys 30-45 child iterations"). But the arc-36a08778 case shows the problem: the parent spent 10 iterations on analysis before delegating, leaving only 10 for child invocation + harvest + refinement. With delegation, the parent needs iterations for:
- Phase 1 (Orient): 2-3 iterations
- Phase 2 (Formulate): 1-2 iterations
- Phase 3 (Delegate): 1 iteration (but costs wall-time)
- Phase 4 (Harvest + Refine): 5-10 iterations

This sums to 9-16 iterations, leaving 4-11 for contingencies. A budget of 25-30 iterations would provide more comfortable margins.

### 6.4 Consider Harness-Level Parallelism Instead

The fundamental problem with agent-level delegation is the trust/verification gap: the agent must trust children it cannot closely supervise. An alternative architecture:

**Harness-level parallelism:** The eval harness launches 3 independent agents per task, each with a different seed or system prompt variation. A separate aggregation step compares their outputs. This achieves the same "parallel hypothesis testing" goal without requiring the agent to change its natural behavior.

This would preserve the agent's strength (deep, iterative, self-correcting exploration) while adding breadth at the infrastructure level.

### 6.5 Fix the Delegation Pattern Itself

If agent-level delegation is retained, the protocol needs fixes:

1. **Children should return structured results, not raw answers.** Instead of returning test outputs directly, children should return `{ score, transform_code, analysis }` so the parent can inspect and refine.

2. **The parent should ALWAYS refine after delegation.** The arc-36a08778 failure shows that trusting a child's training score is insufficient. The parent should spend at least 3-5 iterations verifying and debugging the child's code on its own.

3. **Use delegation for exploration, not for solution.** Instead of asking children to "solve the task," ask them to "identify structural features" or "test whether hypothesis X holds." This gives the parent better raw material for its own solution.

---

## 7. Trajectory Format Extensions for Delegation

The current trajectory format (used in the auto-distilled `arc-*.md` files) captures delegation behavior only partially. The `arc-36a08778` trajectory correctly identified:
- `patterns: delegation-rlm`
- `failureMode: delegation-context-incomplete`
- The control flow shows `DELEGATE:rlm [H1]` at iteration 10

But for runs with more delegation, the format needs extensions.

### Proposed Frontmatter Extensions

```yaml
---
# Existing fields
taskId: arc-36a08778
score: 0
iterations: 14

# New delegation fields
delegationAttempts: 1              # Number of rlm() calls made
delegationProtocol: partial        # none | partial | full
delegationPhase1Completed: false   # Did agent store taskAnalysis?
delegationPhase2Completed: false   # Did agent formulate multiple hypotheses?
delegationPhase3Completed: true    # Did agent launch rlm() children?
delegationPhase4Completed: true    # Did agent harvest and synthesize?
childCount: 1                      # Number of children launched
childParallel: false               # Were children launched via Promise.all?
childIterationsTotal: 15           # Sum of iterations across all children
childScores:                       # Per-child results
  - childId: 0
    hypothesis: "spiral rectangle chain"
    trainScore: "6/6"
    testScore: "0/2"
    iterationsUsed: 15
contextSharingVariables:           # Which driver-prescribed variables were used?
  sharedTask: true
  taskAnalysis: false
  hypothesisResults: false
  sharedDiscovery: false
  transformA: false
  transformB: false
parentPostDelegationIters: 3       # Iterations spent after last child returned
---
```

### Proposed Control Flow Sub-Phases

The control flow notation should support delegation sub-phases:

```
iter 10  DELEGATE:launch     [H1,H2]  ~  launch 2 children via Promise.all
  child-0  CHILD:implement  [H1]      →  test spiral hypothesis (5 iters, 4/6 train)
  child-1  CHILD:implement  [H2]      →  test flood-fill hypothesis (8 iters, 6/6 train)
iter 11  HARVEST:synthesize  [H1,H2]  →  compare child results, pick H2
iter 12  REFINE:debug        [H2]     →  inspect child-1's transform, fix edge case
```

### Proposed New Phase Types

| Phase | Description |
|-------|-------------|
| `DELEGATE:launch` | Parent launches rlm() children |
| `DELEGATE:monitor` | Parent checks intermediate child results (if polling) |
| `HARVEST:synthesize` | Parent reads child results, compares hypotheses |
| `HARVEST:select` | Parent picks the best child result |
| `REFINE:debug` | Parent debugs/refines a child's transform |
| `CHILD:orient` | Child explores task (would be in child's own trajectory) |
| `CHILD:implement` | Child implements a transform |

### Proposed Summary Section

Add a "Delegation Summary" section to trajectories that use delegation:

```markdown
## Delegation Summary

| Metric | Value |
|--------|-------|
| Protocol compliance | partial (Phase 3 only) |
| Children launched | 1 (sequential) |
| Hypothesis diversity | 1 (parent's pre-formed hypothesis) |
| Parent pre-delegation iterations | 10 |
| Parent post-delegation iterations | 3 |
| Child training score | 6/6 |
| Post-delegation refinement | None (trusted child result) |
| Context sharing | sharedTask only (no taskAnalysis, no hypothesisResults) |

**Delegation assessment:** Parent used delegation as implementation outsourcing, not as parallel hypothesis testing. The child received a detailed hypothesis and implemented it, but the parent did not verify the implementation's generalization quality.
```

---

## 8. Context Sharing Analysis

### Global Pattern Counts (All 20 Tasks, All Iterations)

| Pattern | Occurrences in Code Blocks |
|---------|---------------------------|
| `sharedTask` | 3 (2 tasks) |
| `await rlm` | 1 (1 task) |
| `rlm(` | 1 (1 task) |
| `taskAnalysis` | 0 |
| `hypothesisResults` | 0 |
| `sharedDiscovery_*` | 0 |
| `transformA` | 0 |
| `transformB` | 0 |
| `Promise.all` | 0 |
| `await llm` | 0 |

### Per-Task Breakdown

**arc-2ba387bc:** Set `sharedTask = task` in iteration 0 (code line: `const task = JSON.parse(context); sharedTask = task;`). This appears to be a minimal acknowledgment of the driver's Phase 1 instruction. The variable was never used by any child because no children were launched. The agent then spent 19 iterations solving the task manually.

**arc-36a08778:** Set `sharedTask = task` implicitly via the Phase 1 analysis. The `rlm()` prompt said "The parsed task is in 'sharedTask'" but the code did not explicitly set `sharedTask` before launching the child --- the child received `context` as a parameter instead. The child's access to `sharedTask` depended on the sandbox variable persisting from an earlier iteration, which is unreliable.

**All other 18 tasks:** Zero evidence of any context-sharing variable usage. No sandbox variables were set for inter-agent communication. No `rlm()` or `llm()` calls. The agent operated as a completely independent solver.

### Assessment

The context-sharing architecture (sandbox variables readable by children) was never tested. We cannot evaluate whether `hypothesisResults` cross-pollination works because no task reached Phase 3. The one task that delegated passed `context` directly to the child via the `rlm()` call parameter, bypassing the shared-variable mechanism entirely.

---

## 9. Overall Conclusions

1. **The parallel-decomposition driver is dead letter.** With a permissive escape clause and 12 competing drivers, the agent ignores it entirely. The driver had 0% full compliance and 5% partial compliance.

2. **The regression is mostly stochastic, not causal.** Only 1 of 4 regressed tasks was caused by delegation. The other 3 show normal run-to-run variance on hard tasks. A larger sample (n=50-100) would be needed to distinguish driver effects from noise.

3. **Delegation hurt the one task that used it.** Arc-36a08778 went from score=1 (run-026, 18 iterations of solo refinement) to score=0 (run-029, 10 iterations solo + delegation + trust). The delegation short-circuited the iterative debugging that would have caught the edge case.

4. **The coordinator framing is unnatural for LLMs.** The agent's strength is deep, iterative, self-correcting exploration. Asking it to coordinate children requires it to abandon what works and adopt an unfamiliar strategy. Without structural enforcement (harness-level parallelism or forced delegation), the agent will always prefer to solve directly.

5. **Context sharing via sandbox variables was not validated.** The mechanism was never exercised. Future experiments should test it explicitly, perhaps with simpler tasks where the coordination overhead is lower relative to task complexity.
