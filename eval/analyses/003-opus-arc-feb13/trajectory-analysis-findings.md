# Trajectory Analysis: Matched-Pair ARC Eval (Run-022 vs Run-023)

**Date:** 2026-02-13
**Model:** Opus 4.6 (both runs)
**Run-022:** WITH `arc-solver.md` plugin v0.3.0 | 20 tasks | 45% score (9/20) | $13.38
**Run-023:** WITHOUT `arc-solver.md` plugin | 20 tasks | 50% score (10/20) | $10.98
**Design:** Matched-pair, same 20 ARC task IDs

---

## 1. Classification Taxonomy

The full per-task classification is in `trajectory-classification.yml`. The taxonomy has 10 dimensions:

### 1.1 Solving Strategy (15 categories observed)

| Strategy | Run-022 Uses | Run-023 Uses | Both-Solved |
|----------|:----------:|:----------:|:-----------:|
| symmetry-search | 2 | 2 | arc-7ed72f31 |
| connected-component | 0 | 1 | -- |
| ray-tracing | 1 | 1 | arc-5961cc34 |
| tiled-grid | 1 | 1 | arc-b99e7126 |
| periodicity-detection | 1 | 1 | -- |
| shape-stamping | 2 | 2 | -- |
| edge-overlap-assembly | 2 | 2 | -- |
| boundary-tracing | 2 | 2 | -- |
| spatial-sorting | 2 | 2 | -- |
| panel-rearrangement | 1 | 1 | -- |
| nested-rectangle | 1 | 1 | -- |
| path-simulation | 1 | 1 | -- |
| shift-alignment | 1 | 1 | arc-6e453dd6 |
| diagonal-geometry | 1 | 1 | arc-db695cfb |
| flood-fill-reasoning | 1 | 1 | -- |

**Observation:** Both runs converged on the same solving strategy for every matched task (19 of 19 pairs where both have trajectories). The plugin did not redirect strategy selection. Strategy is determined by the task, not the plugin.

### 1.2 Hypothesis Quality Distribution

| Quality | Run-022 (n=19) | Run-023 (n=20) |
|---------|:-----------:|:-----------:|
| correct-first-try | 0 (0%) | 0 (0%) |
| correct-after-refinement | 8 (42%) | 10 (50%) |
| partially-correct | 7 (37%) | 5 (25%) |
| fundamentally-wrong | 2 (11%) | 2 (10%) |
| never-converged | 2 (11%) | 3 (15%) |

No task in either run had a correct-first-try hypothesis. Every success required at least 2-4 iterations of hypothesis refinement.

### 1.3 Iteration Efficiency Distribution

| Efficiency | Run-022 (n=19) | Run-023 (n=20) |
|------------|:-----------:|:-----------:|
| fast (<=11) | 5 (26%) | 8 (40%) |
| moderate (12-16) | 2 (11%) | 3 (15%) |
| slow (17-19) | 11 (58%) | 3 (15%) |
| exhausted (20) | 1 (5%) | 6 (30%) |

**Key finding:** Run-022 clusters heavily in the "slow" bucket (58% at 17-19 iterations), while run-023 is bimodal -- either fast (40%) or exhausted (30%). The plugin appears to prevent early termination and timeouts but also prevents fast solves by adding overhead.

### 1.4 Failure Mode Distribution

| Failure Mode | Run-022 | Run-023 |
|-------------|:-------:|:-------:|
| incorrect-symmetry-application | 1 | 0 |
| incorrect-tile-detection | 1 | 0 |
| wrong-pattern-hypothesis | 1 | 0 |
| incomplete-algorithm | 1 | 1 |
| overlap-priority-wrong | 1 | 0 |
| incomplete-rule-extraction | 1 | 0 |
| wrong-transformation-rule | 2 | 0 |
| incomplete-chain-detection | 1 | 0 |
| wrong-ordering-and-dimensions | 1 | 0 |
| state-loss-on-refactor | 1 | 0 |
| incorrect-sorting-heuristic | 0 | 1 |
| abandoned-correct-answer | 0 | 1 |
| timeout-on-edge-case | 0 | 1 |
| timeout-no-return | 0 | 2 |
| timeout-via-exhaustive-analysis | 0 | 1 |
| aborted-in-exploration | 0 | 1 |
| early-termination | 0 | 1 |
| incomplete-shape-placement | 0 | 1 |
| incomplete-pattern-understanding | 0 | 1 |

**Key finding:** Run-022 failures are dominated by "wrong answer" modes (returned something incorrect), while run-023 has a significant population of timeout/abort failures (5 of 10 failures). The plugin ensures answers are returned; without it, the model sometimes never returns.

---

## 2. Key Statistical Findings

### 2.1 Success Rate Comparison

| Metric | Run-022 (plugin) | Run-023 (no plugin) | Delta |
|--------|:-----------------:|:-------------------:|:-----:|
| Tasks scored | 20 | 20 | -- |
| Trajectory files | 19 | 20 | -1 |
| Score = 1.0 | 9 (45%) | 10 (50%) | +5pp |
| Score = 0 | 11 (55%) | 10 (50%) | -5pp |
| Mean iterations | 15.75 | 14.05 | -1.70 |
| Total cost | $13.38 | $10.98 | -$2.40 |
| Mean wall time | 247.7s | 289.8s | +42.1s |

**Headline:** The plugin-free run scored 5 percentage points higher, used fewer iterations on average, and cost 18% less. However, run-023 had higher mean wall time due to 2 tasks with extremely long individual iterations (arc-4e34c42c at 625s, arc-446ef5d2 at 667s).

**Caveat:** Run-023 had 2 externally-aborted tasks (arc-89565ca0 at 2 iter, arc-8f3a5a89 at 1 iter) that would likely have scored higher with full iteration budgets. Run-022 solved arc-8f3a5a89 perfectly (score=1, 11 iterations). If we credit these as infrastructure failures rather than model failures, the adjusted scores become more comparable.

### 2.2 Iteration Efficiency for Successful Tasks

| Task | Run-022 Iter | Run-023 Iter | Delta | Faster Run |
|------|:----------:|:----------:|:-----:|:----------:|
| arc-5961cc34 | 11 | 16 | +5 | Run-022 |
| arc-6e453dd6 | 13 | 9 | -4 | Run-023 |
| arc-7ed72f31 | 15 | 11 | -4 | Run-023 |
| arc-a251c730 | 18 | 9 | -9 | Run-023 |
| arc-b99e7126 | 19 | 14 | -5 | Run-023 |
| arc-db695cfb | 7 | 13 | +6 | Run-022 |

**Among the 6 tasks solved by both runs:** Run-023 was faster on 4 of 6 tasks. Mean iterations: run-022 = 13.8, run-023 = 12.0. The plugin added ~1.8 iterations of overhead on average for jointly-solved tasks.

The two tasks where run-022 was faster (arc-5961cc34, arc-db695cfb) are both tasks that benefit from spatial helper functions (connected component detection, grid comparison). The four tasks where run-023 was faster suggest the helper library copy-paste overhead and the plugin's structured iteration guide can slow down tasks that don't need those tools.

### 2.3 Success Predictors

**Strong predictors of success (either run):**

1. **Exhaustive training verification:** 16 of 19 successes (84%) tested against all training examples before returning. Only 5 of 20 failures (25%) did exhaustive verification. (Chi-squared p < 0.001 equivalent)

2. **Hypothesis quality = "correct-after-refinement":** 18 of 19 successes had this label. All "fundamentally-wrong" and "never-converged" tasks scored 0.

3. **Comfortable or deadline-aware return:** 17 of 19 successes returned comfortably or with deadline awareness. 0 successes came from deadline-panic, timeout, or abort.

4. **Iteration count <= 16:** 16 of 19 successes (84%) completed in 16 or fewer iterations. Success rate for tasks using 17+ iterations: 3/20 (15%).

**Weak or non-predictors:**

1. **Plugin presence:** 9/20 with plugin vs 10/20 without -- not a significant predictor.
2. **Wall time:** No meaningful correlation between wall time and success.
3. **Exploration depth:** Light, balanced, and heavy exploration depths all produced successes.

### 2.4 The Eager Return Phenomenon

The most dramatic behavioral difference between runs is the "eager return (iter 1)" metric:

- **Run-022:** 17/20 tasks (85%) attempted a return in iteration 1
- **Run-023:** 0/20 tasks (0%) attempted a return in iteration 1

This metric, captured in `analysis.txt`, measures whether the agent's first iteration code block includes a `return()` call. In run-022, the arc-solver plugin's instruction to "Copy the helper library" and then immediately test symmetries appears to encourage the model to also attempt a return after the first batch test. Of the 17 eager returns: 9 succeeded and 8 failed.

**Interpretation:** The eager return pattern is a double-edged sword. For tasks with simple symmetry transforms, it enables fast solutions (arc-db695cfb at 7 iterations). For tasks requiring deeper analysis, the failed early return wastes an iteration and may anchor the agent to a wrong hypothesis. The 47% failure rate of eager returns (8/17) suggests this pattern is not reliably discriminative.

**Recommendation:** The plugin should NOT encourage return attempts in iteration 1. Instead, iteration 1 should be pure exploration (parse task, print grids, compute basic statistics). Returns should be gated on passing verification against ALL training examples.

### 2.5 Delegation Usage

- Run-022: 2 tasks used `rlm()` (arc-446ef5d2 and one other). Both tasks scored 0.
- Run-023: 0 tasks used `rlm()` or `llm()`.

**Interpretation:** rlm() delegation was rare and unsuccessful. For ARC tasks, direct code implementation outperforms delegation to sub-models because the reasoning requires maintaining visual grid state across iterations, which is lost in delegation handoffs.

---

## 3. Matched-Pair Analysis

### 3.1 Task Outcome Matrix

| Outcome | Count | Task IDs |
|---------|:-----:|----------|
| Both solved | 6 | arc-5961cc34, arc-6e453dd6, arc-7ed72f31, arc-a251c730, arc-b99e7126, arc-db695cfb |
| Only run-022 solved | 2 | arc-2ba387bc, arc-8f3a5a89 |
| Only run-023 solved | 4 | arc-135a2760, arc-136b0064, arc-247ef758, arc-aa4ec2a5* |
| Neither solved | 8 | arc-0934a4d8, arc-195c6913, arc-36a08778, arc-446ef5d2, arc-4e34c42c, arc-78332cb0, arc-89565ca0, arc-cbebaa4b |

\* arc-aa4ec2a5 has no run-022 trajectory file, so this classification is provisional.

### 3.2 Disagree Tasks: Deep Analysis

#### Tasks Only Run-022 Solved

**arc-2ba387bc** (block extraction and sorting)
- Run-022: Score 1, 9 iterations. Used helper library for efficient block detection. Clean categorization of hollow vs solid blocks with correct sorting.
- Run-023: Score 0, 20 iterations (timeout). Got the block extraction right but cycled through incorrect sorting heuristics. Answer had correct structure but wrong color pairing (rows 5-8: `1,1,1,1/8,8,8,8` instead of `7,7,7,7/1,1,1,1`).
- **Plugin advantage:** The helper library (`labelComponents`, `boundingBox`) accelerated the object detection phase, leaving more iterations for the sorting logic. Without helpers, run-023 spent too many iterations on basic infrastructure.

**arc-8f3a5a89** (flood-fill border drawing)
- Run-022: Score 1, 11 iterations. Clean flood-fill implementation with marker detection.
- Run-023: Score 0, 1 iteration (aborted). External termination after 256s on a single iteration. **This is an infrastructure failure, not a model failure.** Run-022 proves the model can solve this task.
- **Plugin advantage:** None. This is a confounded data point.

#### Tasks Only Run-023 Solved

**arc-135a2760** (repeating tile pattern correction)
- Run-022: Score 0, 8 iterations. Simple row-wise tile detection passed training but failed on test. Returned early despite having 12 iterations remaining.
- Run-023: Score 1, 13 iterations. More sophisticated modulo-arithmetic approach with majority voting for outlier detection.
- **Plugin disadvantage:** The plugin's "Late (iters 11+): pick your best-scoring transform and return" guidance may have encouraged the premature return at iteration 8. Without this pressure, run-023 invested 5 more iterations in a more robust approach.

**arc-136b0064** (snake-path shape decoding)
- Run-022: Score 0, 20 iterations. Core path-direction hypothesis was off by a column offset. Manual construction under deadline pressure produced wrong answer.
- Run-023: Score 1, 20 iterations. Both used the full budget. Run-023 achieved correct path decoding through better backtracking and self-correction.
- **Plugin disadvantage:** No clear plugin effect. Both runs struggled equally with this hard task. Run-023's success may be due to stochastic variation in hypothesis exploration.

**arc-247ef758** (shape placement via color markers)
- Run-022: Score 0, 17 iterations. Test 0 perfect, test 1 had ONE wrong cell at (6,12) due to overlap priority error. ARC exact-match scoring: 0.
- Run-023: Score 1, 17 iterations. Same approach, same iteration count, but correctly handled the overlap case.
- **Plugin disadvantage:** None clear. This appears to be a stochastic difference -- one cell out of hundreds. The self-correction pattern in run-023 caught the edge case that run-022 missed.

**arc-aa4ec2a5** (topology-based component transformation)
- Run-022: No trajectory file available. Cannot analyze.
- Run-023: Score 1, 11 iterations. Exemplary trajectory using BFS + flood-fill topology detection. Cleanly separated connected components, detected enclosed holes, and applied conditional transformations.
- **Plugin effect:** Unknown due to missing run-022 data.

### 3.3 Neither-Solved Tasks: Difficulty Analysis

These 8 tasks represent the "hard" stratum that neither condition could crack:

| Task | Strategy | Run-022 Mode | Run-023 Mode | Common Issue |
|------|----------|:----------:|:----------:|-------------|
| arc-0934a4d8 | symmetry-search | wrong-answer (19 iter) | timeout (20 iter) | Grid boundary edge case in symmetry reconstruction |
| arc-195c6913 | boundary-tracing | wrong-answer (19 iter) | wrong-answer (19 iter) | Path-tracing algorithm too complex to implement correctly |
| arc-36a08778 | boundary-tracing | wrong-answer (19 iter) | wrong-answer (20 iter) | U-bracket wall extension logic never converged |
| arc-446ef5d2 | nested-rectangle | wrong-answer (19 iter) | wrong-answer (20 iter) | Fundamentally wrong "tiling" hypothesis in both runs |
| arc-4e34c42c | edge-overlap-assembly | wrong-answer (19 iter) | timeout (17 iter) | Overlap matching tolerance: too strict or too permissive |
| arc-78332cb0 | panel-rearrangement | wrong-answer (18 iter) | timeout (9 iter) | Panel ordering rule never discovered |
| arc-89565ca0 | spatial-sorting | wrong-answer (19 iter) | error (2 iter, aborted) | Rectangle ordering criterion too complex |
| arc-cbebaa4b | edge-overlap-assembly | wrong-answer (19 iter) | wrong-answer (20 iter) | Both had correct algorithms but implementation bugs |

**Common themes in hard tasks:**
1. **Multi-step spatial assembly** (arc-4e34c42c, arc-cbebaa4b): Connecting objects via shared edges requires both correct detection of overlap patterns AND correct graph traversal for assembly ordering.
2. **Implicit ordering rules** (arc-78332cb0, arc-89565ca0): Tasks where the ordering criterion is not geometrically obvious defeated hypothesis search.
3. **Complex path algorithms** (arc-195c6913, arc-36a08778): Tasks requiring precise boundary-following algorithms exceeded implementation capacity within the iteration budget.
4. **Fundamental misunderstanding** (arc-446ef5d2): When the core hypothesis is wrong (tiling vs nesting), no amount of refinement helps.

**Notable case -- arc-cbebaa4b:** Both runs developed CORRECT algorithms that passed all training examples. Run-022 failed due to state-loss-on-refactor (variable scoping bug in the RLM harness). Run-023 failed due to BFS placement validation being too strict on test data. This task represents a class of problems where the model has sufficient reasoning capability but the implementation environment introduces fragility.

---

## 4. What Patterns Predict Success

### 4.1 The Success Formula

Based on 19 successful trajectories across both runs, the consistent pattern is:

1. **Systematic exploration** (2-5 iterations of pure data probing before hypothesis formation)
2. **Incremental hypothesis refinement** (test, fail, revise -- not abandon-and-restart)
3. **Exhaustive training verification** (test candidate solution against ALL examples)
4. **Comfortable iteration budget** (finish with >= 4 iterations to spare)
5. **Clean code architecture** (separated functions, explicit variable names)

### 4.2 The Failure Formula

The 20 failed trajectories share these anti-patterns:

1. **Premature commitment** to wrong hypothesis (arc-446ef5d2: "tiling" lock)
2. **Incomplete verification** before return (arc-135a2760 run-022: passed training, failed test)
3. **Deadline panic** (arc-195c6913: abandoned correct answer under time pressure)
4. **State loss** across iterations (arc-cbebaa4b run-022: variable scoping bug)
5. **Analysis paralysis** (arc-78332cb0 run-023: 9 iterations of feature computation, no hypothesis testing)

### 4.3 Iteration Budget as Triage Signal

The iteration count is a strong signal for triaging trajectories:

| Iteration Range | Total Tasks | Successes | Success Rate |
|----------------|:-----------:|:---------:|:------------:|
| 1-11 | 13 | 10 | 77% |
| 12-16 | 5 | 5 | 100% |
| 17-19 | 14 | 3 | 21% |
| 20 | 7 | 1 | 14% |

The "sweet spot" is 9-16 iterations. Tasks that finish in this range have the highest success rate. Tasks that push to 17+ iterations are likely stuck in hypothesis churn or implementation debugging.

### 4.4 Verification as Gate

The single strongest predictor of success is **exhaustive training verification**:

- Tasks with exhaustive verification: 16/21 scored 1.0 (76%)
- Tasks without exhaustive verification: 3/18 scored 1.0 (17%)

This suggests the most impactful system prompt change would be to REQUIRE exhaustive verification as a hard gate before any return() call.

---

## 5. Circumstantial Factors for `arc-solver.md`

### 5.1 Where the Plugin Helped

1. **arc-2ba387bc:** The `labelComponents` and `boundingBox` helpers directly accelerated object detection, freeing iterations for the sorting logic. Run-022 solved in 9 iterations; run-023 failed after 20.

2. **arc-db695cfb:** Fastest solve in run-022 at 7 iterations. The helper library's grid utility functions (`gridCopy`, `gridEqual`, `gridNew`) reduced boilerplate, allowing faster iteration on the diagonal geometry hypothesis.

3. **arc-5961cc34:** Run-022 solved in 11 iterations vs 16 for run-023. Connected component helpers reduced infrastructure code.

**Pattern:** The plugin helps most on tasks that require standard grid primitives (component detection, symmetry testing, grid comparison). These are "infrastructure-heavy" tasks where the model would otherwise spend iterations reimplementing basic utilities.

### 5.2 Where the Plugin Hurt

1. **arc-135a2760:** Run-022 returned at iteration 8 with a wrong answer. The plugin's "Late (iters 11+): pick your best-scoring transform and return" may have encouraged premature return. Run-023 took 13 iterations and got it right.

2. **arc-a251c730:** Run-022 took 18 iterations; run-023 took 9. The plugin's structured iteration guide (early/middle/late phases) may have slowed down a task where direct manual inspection was the most efficient approach.

3. **arc-6e453dd6:** Run-023 solved in 9 iterations vs 13 for run-022. Similar pattern -- the plugin added overhead to a task that didn't need helper functions.

4. **arc-b99e7126:** Run-023 solved in 14 iterations vs 19 for run-022. The plugin's early symmetry testing recommendation was a red herring for this non-symmetry task.

5. **arc-7ed72f31:** Run-023 solved in 11 iterations vs 15 for run-022. Even for a reflection-based task, the plugin didn't accelerate the solve.

**Pattern:** The plugin hurts on tasks where (a) the direct inspection approach is fastest, (b) the symmetry-first heuristic is a red herring, or (c) the structured iteration guide creates unnecessary phases. For 4 of 6 jointly-solved tasks, run-023 was faster.

### 5.3 The Eager Return Problem

The arc-solver plugin's most significant negative effect is the "eager return (iter 1)" behavior:

- **85% of run-022 tasks** attempted a return in iteration 1
- **0% of run-023 tasks** attempted a return in iteration 1
- Of 17 eager returns: 8 failed (47% failure rate)

The plugin's instruction to "Copy the helper library" and "Run `testAllSymmetries` or equivalent batch test against training data" in iterations 1-3 appears to encourage the model to immediately try returning if the batch test produces any match. For complex tasks that require deeper analysis, this eager return attempt wastes an iteration and can anchor the agent to a wrong hypothesis.

### 5.4 Helper Library Usage

The helper library (`gridDims`, `gridEqual`, `gridCopy`, `reflectH`, `rotate90`, `testAllSymmetries`, `labelComponents`, `boundingBox`, `findRepeatingTile`) was used in all 19 run-022 trajectories (per the plugin's instruction "Copy the functions below into your first code block"). However, many tasks did not actually benefit from any of these functions:

- **Tasks that directly used spatial helpers:** arc-2ba387bc (labelComponents), arc-5961cc34, arc-7ed72f31, arc-db695cfb
- **Tasks that only used utility helpers:** arc-6e453dd6, arc-b99e7126, arc-a251c730 (gridCopy, gridEqual for verification)
- **Tasks where helpers were irrelevant:** arc-195c6913, arc-36a08778, arc-446ef5d2, arc-4e34c42c, arc-78332cb0, arc-89565ca0, arc-cbebaa4b

The copy-paste overhead of the full library into every first code block is wasteful for tasks that don't need it. A modular import system would be more efficient.

### 5.5 Net Assessment

| Dimension | Plugin Effect | Evidence |
|-----------|:----------:|---------|
| Overall score | Slightly negative | 45% vs 50% |
| Cost | Negative | $13.38 vs $10.98 (22% more expensive) |
| Iteration efficiency (joint solves) | Negative | Mean 13.8 vs 12.0 iterations |
| Prevents timeouts | Positive | 0 timeouts in run-022 vs 5 in run-023 |
| Prevents aborts | Positive | 0 aborted tasks vs 2 aborted |
| Helps infrastructure-heavy tasks | Positive | arc-2ba387bc: solved vs failed |
| Encourages premature return | Negative | 85% eager return rate, 47% failure |
| Adds overhead to simple tasks | Negative | 4/6 joint solves faster without plugin |

**Summary:** The plugin's primary value is as a safety net (preventing timeouts and aborts) and as an infrastructure accelerator for tasks needing standard grid primitives. Its primary costs are iteration overhead from mandatory library copying, premature returns from eager symmetry testing, and rigidity from the phased iteration guide. The net effect on score is approximately neutral to slightly negative, but the cost is consistently higher.

---

## 6. Recommendations

### 6.1 For `arc-solver.md` Plugin

**R1: Remove eager return encouragement.** The current wording "Run `testAllSymmetries` or equivalent batch test against training data" in the "Early (iters 1-3)" section encourages immediate return attempts. Replace with: "Iterations 1-2 are EXPLORATION ONLY. Parse the task, print all grids, compute basic statistics. Do NOT attempt to return in the first 2 iterations."

**R2: Make the helper library modular.** Instead of "Copy the functions below into your first code block," provide a library index and let the model select relevant functions: "The following functions are available. Copy ONLY the ones you need." Group by category: grid utilities, symmetry operations, component analysis, spatial operations.

**R3: Remove the phased iteration guide.** The rigid "Early/Middle/Late" structure is counterproductive. Replace with a single principle: "Verify your hypothesis against ALL training examples before returning. If any example fails, do not return."

**R4: Add a verification gate.** Add a critical rule: "NEVER call return() unless your solution produces exact matches on ALL training examples. If you cannot verify, state what is unverified."

**R5: Keep the `JSON.stringify` rule.** The instruction to call `return(JSON.stringify(grid))` prevents serialization bugs and should be retained.

**R6: Add edge-case guidance.** Several failures (arc-0934a4d8, arc-247ef758) were caused by boundary conditions or overlap precedence. Add: "Before returning, check: Does your solution handle grid boundaries? Are there overlapping elements that need precedence rules?"

### 6.2 For the System Prompt

**R7: Require exhaustive training verification.** The single highest-impact change: mandate that the model must verify against all training examples before returning. This is the strongest predictor of success (76% vs 17% success rate).

**R8: Discourage early returns.** Add: "Spending fewer iterations is NOT better. Spending the RIGHT number of iterations leads to correct answers. Do not rush."

**R9: Warn about hypothesis anchoring.** Add: "If your first hypothesis fails on any training example, ABANDON it. Do not try to patch a fundamentally wrong hypothesis."

### 6.3 For the RLM Harness

**R10: Fix cross-iteration variable scoping.** The state-loss-on-refactor failure in arc-cbebaa4b (run-022) was caused by a late-iteration function losing access to helpers defined earlier. The harness should ensure that variables and functions defined in any iteration remain accessible in all subsequent iterations.

**R11: Add a "verification checkpoint" mechanism.** Before allowing a return, the harness could automatically run the candidate solution against training examples and warn if any mismatch is detected. This would catch the 47% of eager returns that currently fail.

**R12: Prevent external aborts during active computation.** Run-023 had 2 tasks (arc-89565ca0, arc-8f3a5a89) aborted after 1-2 iterations with 256-272s wall time. These appear to be infrastructure timeouts during long-running individual iterations. The harness should differentiate between "iteration budget exhausted" and "wall time exceeded" and provide different handling.

### 6.4 For Driver Plugins

**R13: Consider task-type detection before plugin selection.** Not all ARC tasks benefit from the symmetry-first approach. A lightweight pre-classifier could detect task type (symmetry, assembly, path-following, sorting) and select appropriate strategy guidance.

**R14: Track plugin effectiveness at the task level.** Store per-task metadata about which plugin functions were actually called, enabling data-driven decisions about plugin inclusion.

---

## Appendix A: Data Integrity Notes

1. **Missing trajectory:** Run-022 has only 19 trajectory files. `arc-aa4ec2a5` is missing from run-022 but present in run-023 (score=1, 11 iterations). The run-022 `analysis.txt` reports 20 tasks with 9 scoring 1.0, but only 8 successes are visible in the 19 trajectories. The 9th success is likely arc-aa4ec2a5, but this cannot be confirmed without the trajectory file.

2. **Aborted tasks:** Run-023 had 2 externally-aborted tasks (arc-89565ca0 at 2 iterations/272s, arc-8f3a5a89 at 1 iteration/256s). These are infrastructure failures, not model failures. Run-022 solved arc-8f3a5a89 perfectly, proving model capability. Adjusted for infrastructure failures, run-023's effective score range is 50-60%.

3. **Run-022 iteration count discrepancy:** The `analysis.txt` reports `code blocks/task = 15.75` which equals `iterations = 15.75`, confirming 1 code block per iteration (no multi-block violations in this eval).

4. **Wall time null value:** Run-022 arc-136b0064 has `wallTimeMs: null`, suggesting a measurement error. This task is excluded from wall time statistics.

## Appendix B: Per-Task Summary Table

| Task ID | Run-022 Score | R022 Iter | Run-023 Score | R023 Iter | Strategy | Both Solved? |
|---------|:---:|:---:|:---:|:---:|----------|:---:|
| arc-0934a4d8 | 0 | 19 | 0 | 20 | symmetry-search | No |
| arc-135a2760 | 0 | 8 | 1 | 13 | periodicity-detection | R023 only |
| arc-136b0064 | 0 | 20 | 1 | 20 | path-simulation | R023 only |
| arc-195c6913 | 0 | 19 | 0 | 19 | boundary-tracing | No |
| arc-247ef758 | 0 | 17 | 1 | 17 | shape-stamping | R023 only |
| arc-2ba387bc | 1 | 9 | 0 | 20 | spatial-sorting | R022 only |
| arc-36a08778 | 0 | 19 | 0 | 20 | boundary-tracing | No |
| arc-446ef5d2 | 0 | 19 | 0 | 20 | nested-rectangle | No |
| arc-4e34c42c | 0 | 19 | 0 | 17 | edge-overlap-assembly | No |
| arc-5961cc34 | 1 | 11 | 1 | 16 | ray-tracing | Yes |
| arc-6e453dd6 | 1 | 13 | 1 | 9 | shift-alignment | Yes |
| arc-78332cb0 | 0 | 18 | 0 | 9 | panel-rearrangement | No |
| arc-7ed72f31 | 1 | 15 | 1 | 11 | symmetry-search | Yes |
| arc-89565ca0 | 0 | 19 | 0 | 2* | spatial-sorting | No |
| arc-8f3a5a89 | 1 | 11 | 0* | 1* | flood-fill-reasoning | R022 only* |
| arc-a251c730 | 1 | 18 | 1 | 9 | shape-stamping | Yes |
| arc-aa4ec2a5 | ?** | ? | 1 | 11 | connected-component | R023 only** |
| arc-b99e7126 | 1 | 19 | 1 | 14 | tiled-grid | Yes |
| arc-cbebaa4b | 0 | 19 | 0 | 20 | edge-overlap-assembly | No |
| arc-db695cfb | 1 | 7 | 1 | 13 | diagonal-geometry | Yes |

\* Infrastructure abort, not model failure.
\*\* Missing trajectory file for run-022.
