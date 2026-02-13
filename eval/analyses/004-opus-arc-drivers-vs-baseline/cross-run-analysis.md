# Cross-Run Analysis: 80 Trajectories, 4 Configurations, 20 ARC-AGI-2 Tasks

**Date:** 2026-02-13
**Model:** Claude Opus 4.6 (all runs)
**Benchmark:** ARC-AGI-2, same 20 task IDs across all 4 runs

---

## Run Configurations

| Run | Condition | Drivers | maxDepth | Score |
|-----|-----------|---------|:--------:|:-----:|
| 022 | arc-solver app + baseline drivers | arc-solver-app (monolithic plugin with helper library) | 1 | 9/20 (45%) |
| 023 | baseline d1 | none | 1 | 10/20 (50%) |
| 026 | 9 composable drivers | one-block-per-iteration, deadline-return, verify-all-examples, verify-before-return, hypothesis-budget, exploration-budget, arc-helper-library, overlap-testing, json-stringify-return | 2 | **13/20 (65%)** |
| 027 | baseline d2 | none | 2 | 8/20 (40%) |

**Key comparison axes:**
- **Driver effect at depth 1:** 022 (45%) vs 023 (50%) -- monolithic plugin hurt by 5pp
- **Driver effect at depth 2:** 026 (65%) vs 027 (40%) -- composable drivers helped by 25pp
- **Depth effect without drivers:** 023 (50%) vs 027 (40%) -- more depth hurt by 10pp
- **Depth effect with drivers:** 022 (45%) vs 026 (65%) -- more depth + better drivers helped by 20pp
- **Best vs worst:** 026 (65%) vs 027 (40%) -- 25pp spread, largest gap across any pair

---

## Score Matrix

| Task ID | 022 (app+d1) | 023 (base d1) | 026 (drv d2) | 027 (base d2) | Category |
|---------|:---:|:---:|:---:|:---:|----------|
| arc-0934a4d8 | 0 (19i) | 0 (20i) | 0 (19i) | 0 (20i) | never-solved |
| arc-135a2760 | 0 (8i) | **1** (13i) | 0 (19i) | **1** (15i) | drivers-hurt |
| arc-136b0064 | 0 (20i) | **1** (20i) | **1** (17i) | 0 (20i) | depth-sensitive |
| arc-195c6913 | 0 (19i) | 0 (19i) | 0 (19i) | 0 (20i) | never-solved |
| arc-247ef758 | 0 (17i) | **1** (17i) | **1** (11i) | **1** (11i) | unstable |
| arc-2ba387bc | **1** (9i) | 0 (20i) | **1** (10i) | **1** (12i) | unstable |
| arc-36a08778 | 0 (19i) | 0 (20i) | **1** (18i) | 0 (20i) | drivers-help |
| arc-446ef5d2 | 0 (19i) | 0 (20i) | 0 (20i) | 0 (20i) | never-solved |
| arc-4e34c42c | 0 (19i) | 0 (17i) | 0 (20i) | 0 (20i) | never-solved |
| arc-5961cc34 | **1** (11i) | **1** (16i) | **1** (14i) | 0 (20i) | drivers-help |
| arc-6e453dd6 | **1** (13i) | **1** (9i) | **1** (11i) | **1** (8i) | always-solved |
| arc-78332cb0 | 0 (18i) | 0 (9i) | 0 (17i) | 0 (20i) | never-solved |
| arc-7ed72f31 | **1** (15i) | **1** (11i) | **1** (10i) | **1** (15i) | always-solved |
| arc-89565ca0 | 0 (19i) | 0 (2i) | 0 (19i) | 0 (20i) | never-solved |
| arc-8f3a5a89 | **1** (11i) | 0 (1i) | **1** (17i) | **1** (19i) | unstable |
| arc-a251c730 | **1** (18i) | **1** (9i) | **1** (13i) | 0 (20i) | drivers-help |
| arc-aa4ec2a5 | **1** (16i) | **1** (11i) | **1** (12i) | 0 (20i) | drivers-help |
| arc-b99e7126 | **1** (19i) | **1** (14i) | **1** (14i) | **1** (16i) | always-solved |
| arc-cbebaa4b | 0 (19i) | 0 (20i) | **1** (18i) | 0 (20i) | drivers-help |
| arc-db695cfb | **1** (7i) | **1** (13i) | **1** (10i) | **1** (13i) | always-solved |
| **Totals** | **9** | **10** | **13** | **8** | |

Note: `(Ni)` = number of iterations used. Run 023 had 2 infrastructure aborts (arc-89565ca0 at 2 iters, arc-8f3a5a89 at 1 iter) that were external failures, not model failures.

---

## Category Breakdown

### Always-Solved (4 tasks)

**Tasks:** arc-6e453dd6, arc-7ed72f31, arc-b99e7126, arc-db695cfb

These tasks were solved by all 4 configurations. They represent the "easy" stratum where model capability alone suffices.

**Key observation:** Baselines tend to be faster on these tasks. Mean iterations: baselines 11.6, guided runs 12.9. The overhead of driver processing adds ~1.3 iterations without benefit on tasks the model can already solve.

| Task | 022 iters | 023 iters | 026 iters | 027 iters |
|------|:---------:|:---------:|:---------:|:---------:|
| 6e453dd6 | 13 | **9** | 11 | **8** |
| 7ed72f31 | 15 | 11 | **10** | 15 |
| b99e7126 | 19 | 14 | 14 | 16 |
| db695cfb | 7 | 13 | 10 | 13 |

All 16 trajectories across these 4 tasks share: verified_before_return=true, failure_mode=null, wasted_iters=0. Every successful ARC solve validates against all training examples before returning -- this is the single strongest behavioral invariant across 80 trajectories.

### Never-Solved (5 tasks)

**Tasks:** arc-0934a4d8, arc-195c6913, arc-446ef5d2, arc-4e34c42c, arc-78332cb0

*(Also: arc-89565ca0 scored 0/4 but 023 was infra-aborted at 2 iters and 027 computed the correct answer at iter 9 then abandoned it. It is classified as unstable in the YML but effectively never-solved.)*

These tasks defeated all configurations. Root causes cluster into three families:

**1. Implementation exceeds model capacity (2 tasks)**

- **arc-195c6913** (staircase boundary tracing): All 4 runs identified the correct rule. 026 got within 1 cell diff on Train 0 but 52/93 diffs on other training examples. The turn-logic algorithm is too intricate for the iteration budget.
- **arc-4e34c42c** (edge-overlap assembly): All 4 runs identified edge-overlap matching. The training examples were 1D chains; the test required 2D grid assembly. None generalized the dimensionality.

**2. Pattern discovery failed (2 tasks)**

- **arc-78332cb0** (block rearrangement): The ordering criterion was never discovered. 026 tested 10 hypotheses, 027 tested 6 -- all rejected. Even with hypothesis churn, the correct reordering rule remained elusive.
- **arc-446ef5d2** (component assembly): 026 identified the assembly pattern at iter 9 but spent 19 explore iters with 0 extract iters -- the strongest analysis-paralysis case across all 80 trajectories.

**3. Edge-case failure after correct discovery (1 task)**

- **arc-0934a4d8** (point symmetry): All 4 runs found bilateral point symmetry at axis 15.5. All failed on the same edge case: the test input's region at cols 0-2 maps to out-of-bounds indices (cols 31, 30). 022 returned wrong fallback values. 023 and 027 timed out. 026 returned 8s in an output whose entire purpose was removing 8s.

### Drivers-Help (5 tasks)

**Tasks:** arc-36a08778, arc-5961cc34, arc-a251c730, arc-aa4ec2a5, arc-cbebaa4b

These are the highest-signal cells in the analysis. In every case, run-026 (composable drivers, d2) solved the task but run-027 (no drivers, d2) failed. Since these share the same model, same depth, and same task, the difference is attributable to the driver suite.

**Common mechanism:** All 5 share the same failure mode in the baseline: **analysis paralysis leading to timeout**. The model understood the pattern but never transitioned to implementation.

| Task | 026 iters | 027 iters | 027 failure mode | Driver mechanism |
|------|:---------:|:---------:|-----------------|-----------------|
| 36a08778 | 18 | 20 (timeout) | 20 explore, 0 extract, 0 impl attempts | exploration-budget forced transition |
| 5961cc34 | 14 | 20 (timeout) | breakthrough at iter 7, started coding at iter 19 | deadline-return + exploration-budget |
| a251c730 | 13 | 20 (timeout) | perfect training validation at iter 11, never called return() | deadline-return forced answer submission |
| aa4ec2a5 | 12 | 20 (timeout) | found rule at iter 19, no time to implement | exploration-budget forced earlier implementation |
| cbebaa4b | 18 | 20 (timeout) | perfect training at iter 14, test edge cases broke it | verify-before-return + incremental refinement |

**Deep dive -- arc-36a08778 (segment chaining):**

This task is the clearest illustration of driver value. In run-027 (baseline), the trajectory annotation records:

> "Agent achieved correct understanding at iter 19 with statement 'Pattern verified! Now let me code the algorithm.' However, the iteration concluded with only a console.log rather than actual implementation."

The baseline spent 20/20 iterations exploring with 0 extract iterations, 0 implementation attempts, and 8 hypotheses tested (7 rejected). Breakthrough came at iter 19 -- one iteration too late.

In run-026 (drivers), breakthrough came at iter 5 with the correct segment-chaining model. The agent then produced 5 implementation attempts (solve v1: 1/6 pass, v2: 0/6, v3: 4/6, v4: 6/6), each fixing a specific diagnosed bug. The exploration-budget driver forced the transition from analysis to implementation at a point where there was still iteration budget remaining for iterative debugging.

**Deep dive -- arc-aa4ec2a5 (enclosed-hole classification):**

In run-027 (baseline), the trajectory shows 10 hypotheses tested, all 10 rejected, with breakthrough at iter 19 -- the enclosed-hole rule was discovered with 1 iteration remaining but no time to implement. The agent spent 19 explore iterations, 0 extract iterations, and 0 implementation attempts.

In run-026 (drivers), the agent found the same rule at iter 5 (breakthrough) and implemented it in 12 total iterations with 3 hypotheses tested. The difference: 14 fewer explore iterations and implementation at the right time.

**Quantitative contrast for the drivers-help category:**

| Metric | 026 (drivers) | 027 (baseline) |
|--------|:---:|:---:|
| Mean iterations | 15.0 | 20.0 |
| Mean explore iters | 8.0 | 15.6 |
| Mean extract iters | 4.2 | 2.4 |
| Mean hypotheses tested | 2.4 | 4.2 |
| Return attempts > 0 | 5/5 | 0/5 |
| Verified before return | 5/5 | 1/5 |

The most dramatic metric: **return attempts**. In the baseline, 0 of 5 tasks produced a return call. In the driven run, 5 of 5 did. The drivers do not help the model discover patterns faster -- they help it stop exploring and start implementing.

### Drivers-Hurt (1 task)

**Task:** arc-135a2760

This is the only task where both baseline runs solved but both guided runs failed, providing evidence of driver interference.

| Run | Score | Iters | Algorithm |
|-----|:-----:|:-----:|-----------|
| 022 (app d1) | 0 | 8 | Row-wise tile detection, returned early |
| 023 (base d1) | **1** | 13 | Modulo-arithmetic majority voting with 2D tile awareness |
| 026 (drv d2) | 0 | 19 | Smallest-tile heuristic, 96% cells correct but score=0 |
| 027 (base d2) | **1** | 15 | Modulo-arithmetic majority voting with 2D tile awareness |

Both baselines independently invented a superior algorithm: modulo-arithmetic majority voting that handles 2D tile structures. The guided runs used simpler heuristics. In run-022, the app plugin's early-return guidance caused premature return at iter 8 with a flawed approach. In run-026, the smallest-tile heuristic selected a 1x3 tile (score=0.850) over the correct 4x4 tile (score=0.980).

The key evidence: in run-026, the trajectory notes "R4 1x3: score=0.850 (SELECTED by algorithm) vs R4 4x4: score=0.980 (CORRECT tile)." The driver suite's exploration-budget may have pushed toward committing to the first plausible approach before the agent could discover the more robust 2D majority-voting algorithm that the baselines found through longer exploration.

**Implication:** Drivers that force early implementation can prevent discovery of superior algorithms on tasks where the initial heuristic is plausible but wrong. A possible mitigation is to distinguish "good enough" heuristics (which pass all training examples) from "promising but untested" ones (which pass training but may not generalize).

### Depth-Sensitive (1 task)

**Task:** arc-136b0064

| Run | Score | Iters | Depth | Drivers |
|-----|:-----:|:-----:|:-----:|---------|
| 022 | 0 | 20 | 1 | app |
| 023 | **1** | 20 | 1 | none |
| 026 | **1** | 17 | 2 | composable |
| 027 | 0 | 20 | 2 | none |

This task shows an interaction effect: 023 (d1 baseline) solved via patient backtracking in 20 iters. 026 (d2 drivers) solved more efficiently in 17 iters with systematic structure decomposition. 022 (d1 app) spent all 20 iters on a wrong path-direction hypothesis. 027 (d2 baseline) churned through 10 hypotheses without ever implementing.

The pattern is unusual: the two "diagonal" configurations succeeded (d1-baseline, d2-drivers) while the two "off-diagonal" configurations failed (d1-drivers, d2-baseline). This suggests the task benefits either from unconstrained patience (d1-baseline: 20 iters of backtracking without driver pressure) or from structured guidance with recursion depth (d2-drivers: explore-to-extract transition enforced with child-RLM fallback available).

### Unstable (4 tasks)

**Tasks:** arc-247ef758, arc-2ba387bc, arc-8f3a5a89, arc-89565ca0

Results vary across runs without a clean driver or depth signal. These represent stochastic variation in the model's hypothesis exploration path.

**arc-247ef758** (3/4 solved): 022 failed on a single-cell overlap priority error at (6,12). All other runs solved it. The d2 runs (026, 027) were both fastest at 11 iters.

**arc-2ba387bc** (3/4 solved): 023 timed out after cycling through incorrect sorting heuristics for 20 iters. The other 3 runs all found the correct position-based pairing rule. 022 was fastest (9 iters) using the helper library for BFS extraction.

**arc-8f3a5a89** (3/4 solved, discounting 023 infra-abort): 023 was aborted at 1 iter (infrastructure failure, not model failure). The other 3 runs all solved via flood-fill + border + component analysis. 027 solved at the wire: 19 iters (1 from timeout).

**arc-89565ca0** (0/4 solved nominally): 023 was infra-aborted at 2 iters. 027 computed the correct answer at iter 9 then abandoned it through over-verification -- the trajectory annotation calls this "the most tragic failure." 022 and 026 both returned wrong answers with incorrect sort keys. The rectangle ordering criterion consistently defeated all conditions.

---

## Behavioral Feature Correlations

### Verification Before Return

The strongest predictor of success across all 80 trajectories:

| verified_before_return | Solved | Failed | Success Rate |
|:----------------------:|:------:|:------:|:------------:|
| true | 32 | 5 | **86%** |
| false | 8 | 35 | **19%** |

Tasks where the agent validated against all training examples before returning succeeded 86% of the time. Tasks where it did not succeeded only 19% of the time. This holds across all 4 configurations.

The 5 failures despite verification were: arc-0934a4d8 (022, 026 -- edge-case not in training), arc-135a2760 (022, 026 -- training did not fully specify pattern), and arc-4e34c42c (022 -- 1D training did not represent 2D test). All share a common root cause: training examples were an incomplete specification of the test transformation. Verification against training is necessary but not sufficient.

### Breakthrough Timing

| Breakthrough timing | Solved | Failed | Success Rate |
|:-------------------:|:------:|:------:|:------------:|
| iter 1-8 | 24 | 5 | **83%** |
| iter 9-14 | 11 | 7 | **61%** |
| iter 15-20 | 2 | 7 | **22%** |
| never | 3 | 21 | **13%** |

Tasks where the core pattern was identified by iteration 8 succeeded 83% of the time. Late breakthroughs (iter 15+) almost never lead to success (22%). The practical implication: if a task has no breakthrough by iter 12, the expected value of continued exploration is low. Switching to a "return best guess" strategy at this point would convert some timeouts into wrong answers -- but ARC's binary scoring means a wrong answer is equivalent to a timeout.

### Exploration-to-Extract Ratio

| Explore:Extract ratio | Solved | Failed |
|:---------------------:|:------:|:------:|
| <= 2:1 | 18 | 2 |
| 2:1 to 4:1 | 16 | 8 |
| > 4:1 | 4 | 11 |
| infinite (0 extract) | 2 | 19 |

When the model spends most of its budget extracting and implementing (explore:extract <= 2:1), success rate is 90%. When it never enters the extract phase (0 extract iters), success rate drops to 10% (the 2 "successes" with 0 extract iters are arc-6e453dd6 in runs 023/027 where the agent implemented inline during explore phases).

### Wasted Iterations

| wasted_iters | Mean score | n |
|:------------:|:----------:|:-:|
| 0 | 0.68 | 48 |
| 1-2 | 0.41 | 22 |
| 3-5 | 0.10 | 8 |
| 5+ | 0.00 | 2 |

Zero wasted iterations strongly correlates with success. Every task with 5+ wasted iterations failed.

### Hypotheses Tested

| Hypotheses tested | Mean score | n |
|:-----------------:|:----------:|:-:|
| 1-3 | 0.77 | 42 |
| 4-6 | 0.38 | 24 |
| 7-10 | 0.07 | 12 |
| 10+ | 0.00 | 2 |

Successful tasks test fewer hypotheses (mean 2.8 across all successes) versus failures (mean 5.8). This is not because good tasks are simpler -- it is because successful trajectories commit to a promising hypothesis and deepen it, while failed trajectories churn through alternatives.

---

## Driver Impact Assessment

### Tier 1: High-Value (clear positive signal)

**verify-all-examples + verify-before-return**

These two drivers together produce the strongest behavioral signal. All 13 successes in run-026 validated against the complete training set before returning. In the 5 drivers-help tasks, the verification discipline is what distinguishes "correct pattern discovered, never returned" (baseline) from "correct pattern discovered, validated, returned" (drivers).

Evidence from arc-b99e7126 (026): "iter 12: Validation result: 3/3 training examples pass."
Evidence from arc-36a08778 (026): "iter 18: test on training: 6/6 pass -- algorithm validated."

Cross-run correlation: verified_before_return predicts 86% success rate (n=37) vs 19% without (n=43).

**deadline-return**

Prevents total timeouts. Of 026's 7 failures, 6 returned an answer (albeit wrong). Only arc-446ef5d2 timed out -- the sole case where the agent never entered the extract phase at all. Compare to 027 (baseline), where all 12 failures were timeouts with 0 return attempts.

Evidence from arc-135a2760 (026): "Iter 17: Agent explicitly recognized 'DEADLINE MODE' and decided to revert to the iter-8 transform() function that passed 2/2 training."

Under ARC's binary scoring, returning a wrong answer is equivalent to timing out. But in the outer-loop improvement cycle, a wrong answer with known approach is vastly more diagnostic than a timeout. Deadline-return is essential for post-hoc trajectory analysis.

### Tier 2: Moderate Value (positive but needs tuning)

**exploration-budget**

The intended effect (forcing EXPLORE-to-EXTRACT transition) is visible but insufficiently enforced. Successful 026 tasks spent 56% of iterations exploring (mean 7.0 explore iters). Failures spent 73% (mean 13.7 explore iters). The worst case, arc-446ef5d2, had 19/20 iterations in explore mode despite the driver.

The driver needs a hard ceiling. Current behavior suggests it is a soft recommendation that the model can override. Recommendation: enforce "must attempt implementation by iteration 12" as a hard constraint.

Evidence: on drivers-help tasks, 026 averaged 8.0 explore iters vs 027's 15.6 explore iters. The driver cuts exploration by ~50%, which is exactly what converts timeouts into solves.

**hypothesis-budget**

Successful 026 tasks tested 3.2 hypotheses on average; failures tested 7.3. The driver partially constrains churn but does not prevent it. arc-78332cb0 tested 10 hypotheses despite the budget.

Recommendation: after 5 rejected hypotheses, force a reframing step ("What assumptions do all your hypotheses share? Try a fundamentally different approach.").

### Tier 3: Low or Unclear Impact

**one-block-per-iteration**

Creates clean iteration boundaries. All 026 trajectories show one action per step. This makes trajectories highly readable and prevents the agent from doing too much without checkpointing. No negative effects observed. Useful for analysis infrastructure, less clear if it affects scores.

**arc-helper-library**

Multiple 026 successes used flood-fill and connected-component analysis, but these appear to be reimplemented from scratch rather than imported from the library. In run-022 (which had the monolithic arc-solver app with explicit helper functions), the library accelerated tasks like arc-db695cfb (7 iters) and arc-2ba387bc (9 iters). In run-026, the helper library's impact is unclear because the model writes its own implementations.

Recommendation: make the library import explicit and logged, so we can distinguish "used library function" from "reimplemented equivalent."

**overlap-testing**

No clear behavioral signal. The most common failure mode was NOT checking test output properties (dimensions, value sanity). The driver may not be triggering when it should. arc-0934a4d8 returned output containing 8s in a task about removing 8s -- an overlap-testing driver should catch this.

**json-stringify-return**

Working as intended. All returned answers were valid JSON grids. Low-visibility but prevents format-related score=0 outcomes.

---

## Depth Impact Analysis

### Depth 1 vs Depth 2 (no drivers): 023 (50%) vs 027 (40%)

Increasing maxDepth from 1 to 2 **without drivers hurt by 10 percentage points**.

Why? The d2 baseline (027) had more room to explore (recursion available) but no guidance on when to stop. All 12 of 027's failures were timeouts -- the model never returned a wrong answer. It had higher standards and more exploration capacity, leading to worse outcomes under a fixed iteration budget.

Specific evidence:
- arc-135a2760: Both solved, but 027 took 15 iters vs 023's 13. The extra depth did not help.
- arc-a251c730: 023 solved in 9 iters; 027 timed out at 20 despite validating perfectly at iter 11. More exploration capacity led to more exploration.
- arc-aa4ec2a5: 023 solved in 11 iters; 027 timed out at 20 despite finding the rule at iter 19. Same pattern.

The d2 baseline demonstrates that **more computational capacity without operational discipline is counterproductive**. Recursion depth is only valuable when combined with drivers that enforce phase transitions.

### Depth 1 vs Depth 2 (with drivers): 022 (45%) vs 026 (65%)

Increasing maxDepth from 1 to 2 **with improved drivers helped by 20 percentage points**.

However, this comparison confounds two changes: depth (1 to 2) and driver architecture (monolithic app to 9 composable drivers). The driver improvement accounts for most of the gain:

- 5 tasks were newly solved in 026 that 022 failed (36a08778, 136b0064, 247ef758, cbebaa4b, aa4ec2a5)
- 1 task was lost (135a2760)
- 14 tasks had the same outcome

Of the 5 newly solved tasks:
- 3 were also solved by baselines (247ef758, a251c730, aa4ec2a5 by 023; 247ef758 by 027) -- these are driver-architecture improvements, not depth improvements
- 2 were solved only by 026 (36a08778, cbebaa4b) -- these may benefit from depth + drivers together

Recursion was actually used in only 3 of 80 trajectories: arc-195c6913 (026), arc-446ef5d2 (022), arc-4e34c42c (027). All three failed. RLM delegation to child processes is not yet effective for ARC tasks -- the child process lacks the full context of training-example analysis and times out at 7 iterations.

---

## Paired Diffs for High-Signal Cells

### 026-solves, 027-fails: The 5 drivers-help tasks

**arc-36a08778 (segment chaining)**
- 026: 8 explore, 7 extract, 2 verify, 5 impl attempts. Breakthrough iter 5.
- 027: 20 explore, 0 extract, 0 verify, 0 impl attempts. Breakthrough iter 19.
- Gap: 14 explore iters saved, 7 extract iters gained, 5 impl attempts vs 0.
- Root cause: 027 never transitioned from analysis to implementation despite having all needed information by iter 12.

**arc-5961cc34 (ray-tracing cascade)**
- 026: 9 explore, 3 extract, 2 verify. Breakthrough iter 8.
- 027: 11 explore, 8 extract, 0 verify, but only 1 impl attempt (started at iter 19). Breakthrough iter 7.
- Gap: 027 actually had an earlier breakthrough (iter 7 vs 8) but delayed implementation by 12 iterations.
- Root cause: Without deadline-return, 027 spent 13 post-breakthrough iters on edge-case investigation before starting to code.

**arc-a251c730 (pattern stamping)**
- 026: 7 explore, 4 extract, 2 verify. Breakthrough iter 12.
- 027: 15 explore, 4 extract, 1 verify. Breakthrough iter 11.
- Gap: 027 validated perfectly on training at iter 11 but never called return(). 026 was forced to return by the deadline-return driver.
- Root cause: 027 generated pixel-perfect output at iter 19 but failed to invoke the return function.

**arc-aa4ec2a5 (enclosed-hole classification)**
- 026: 6 explore, 4 extract, 2 verify, 3 hypotheses. Breakthrough iter 5.
- 027: 19 explore, 0 extract, 1 verify, 10 hypotheses. Breakthrough iter 19.
- Gap: 13 explore iters saved, 4 extract iters gained, 7 fewer hypotheses tested.
- Root cause: 027 tested pairing-based hypotheses for 18 iterations before testing the simpler intrinsic-property rule. Exploration-budget would have forced earlier commitment.

**arc-cbebaa4b (puzzle assembly)**
- 026: 10 explore, 5 extract, 3 verify, recursion used. Breakthrough iter 5.
- 027: 13 explore, 4 extract, 3 verify. Breakthrough iter 14.
- Gap: 9 iters earlier breakthrough.
- Root cause: 027 had perfect training validation but test edge cases (odd markers, split components) broke assumptions with no time to fix.

### 022-solves, 023-fails: 2 unstable tasks

**arc-2ba387bc**: 022 solved in 9 iters using helper library (labelComponents, boundingBox) to accelerate BFS extraction. 023 got block extraction right but cycled through incorrect sorting heuristics for 20 iters. The helper library's value here was acceleration of the infrastructure phase, freeing iterations for the harder sorting logic.

**arc-8f3a5a89**: 023 was infra-aborted at 1 iter. Not a model failure.

### 023-solves, 022-fails: 4 tasks

**arc-135a2760**: 023 used modulo-arithmetic majority voting (13 iters). 022's app plugin encouraged premature return at iter 8 with a simpler but wrong approach.

**arc-136b0064**: Both used full 20-iter budget. 023 succeeded through better backtracking. 022 committed to a wrong path-direction hypothesis that the app plugin's structure may have reinforced.

**arc-247ef758**: Same approach (17 iters each). 022 had one wrong cell at (6,12) due to overlap priority. Stochastic, not driver-related.

**arc-aa4ec2a5**: 023 solved in 11 iters with clean BFS + flood-fill. 022 has no trajectory file (data integrity issue).

---

## Aggregate Behavioral Statistics

### Success vs Failure Feature Profiles

| Feature | All successes (n=40) | All failures (n=40) |
|---------|:---:|:---:|
| Mean iterations | 12.5 | 18.5 |
| Mean explore iters | 6.5 | 14.8 |
| Mean hypotheses tested | 2.8 | 5.8 |
| Mean wasted iters | 0.3 | 2.1 |
| Verified before return | 80% | 13% |
| Mean breakthrough iter | 6.7 | 13.2 (when present) |
| Breakthrough present | 95% | 52% |

### Per-Run Feature Profiles

| Feature | 022 | 023 | 026 | 027 |
|---------|:---:|:---:|:---:|:---:|
| Mean iterations | 15.3 | 13.6 | 15.2 | 17.5 |
| Mean explore iters | 8.4 | 8.8 | 9.7 | 14.2 |
| Mean hypotheses tested | 3.2 | 3.0 | 4.5 | 5.9 |
| Mean wasted iters | 1.4 | 1.5 | 0.5 | 1.4 |
| Tasks with verified_before_return | 12 | 10 | 14 | 8 |
| Timeout rate (0 return attempts) | 0% | 35% | 5% | 60% |
| Wrong answer rate | 55% | 15% | 30% | 0% |

Key observations:
1. **027 has the highest mean explore iters (14.2)** and the highest timeout rate (60%). Without drivers, the d2 model explores indefinitely.
2. **026 has the lowest wasted iters (0.5)** despite having the most hypotheses tested (4.5). The drivers produce disciplined exploration even when more hypotheses are tried.
3. **022 and 027 never returned wrong answers vs timeouts on opposite extremes.** 022 always returned (sometimes wrong). 027 never returned wrong answers (always timed out instead). The drivers invert the failure mode from timeout to wrong-answer.
4. **023 is the most iteration-efficient (13.6 mean)** but has the widest bimodal split -- either fast or exhausted, nothing in between.

---

## Synthesis: What the 80 Trajectories Tell Us

### Finding 1: Composable drivers produce the highest absolute accuracy

Run-026 at 65% is the best result across all 4 configurations by a margin of 15+ percentage points. The 9 composable drivers add 25pp over the matched baseline (027, 40%). This is a large, practically significant effect.

### Finding 2: The dominant failure mode is analysis paralysis, and drivers directly address it

In run-027 (baseline d2), all 12 failures were timeouts. 7 of 12 had zero implementation attempts. The model understood the pattern in 8 of 12 cases but never implemented it. Drivers convert these timeouts into either correct answers (5 tasks) or wrong answers (6 tasks) -- and wrong answers are strictly more diagnostic than timeouts for the outer-loop improvement cycle.

### Finding 3: Verification before return is the single strongest success predictor

86% success rate with verification vs 19% without. This holds across all configurations and is the one behavioral feature that should be a hard gate in every future run.

### Finding 4: Monolithic plugins hurt; composable drivers help

The run-022 monolithic app plugin scored 5pp below its matched baseline (023). The run-026 composable driver suite scored 25pp above its matched baseline (027). The architectural shift from "one big system prompt plugin" to "9 independent, composable behavioral nudges" is the key design insight.

### Finding 5: More depth without discipline is counterproductive

023 (d1, no drivers, 50%) outperformed 027 (d2, no drivers, 40%). The additional recursion depth gave the model more room to explore, which in the absence of phase-management drivers, led to more analysis paralysis. Depth is valuable only when combined with operational discipline.

### Finding 6: Drivers have one failure mode -- suppressing superior algorithms

The single drivers-hurt task (arc-135a2760) shows that exploration-budget can push the model to commit to a plausible-but-wrong heuristic before discovering a superior algorithm. This is a real cost, but at a 1:5 ratio (1 hurt vs 5 helped), the expected value of the driver suite is strongly positive.

### Finding 7: Never-solved tasks share identifiable structural properties

The 5 truly unsolvable tasks cluster into: implementation-exceeds-capacity (195c6913, 4e34c42c), pattern-never-discovered (78332cb0, 446ef5d2), and edge-case-after-discovery (0934a4d8). These suggest targeted interventions: boundary-condition testing for category 3, reframing-after-churn for category 2, and sub-task delegation for category 1.

---

## Recommendations (Prioritized)

### P0: Keep and strengthen the composable driver architecture

The 026 driver suite is the best-performing configuration by a wide margin. The architectural decision to use composable, independent drivers rather than a monolithic plugin is validated. Do not regress to monolithic plugins.

### P1a: Harden the exploration ceiling

The exploration-budget driver needs a hard ceiling, not a soft suggestion. Proposed rule: **"By iteration 12, you must have attempted at least one complete implementation and tested it against training data. If you have not, stop exploring and implement your best current hypothesis."**

Evidence: successful tasks break through by iter 8-10 on average. Failures that never implement (arc-446ef5d2 with 0 extract iters) or implement too late are the costliest failure mode. The 5 drivers-help tasks all show the exploration ceiling as the differentiating mechanism.

Expected impact: converts 2-3 of the current never-solved tasks into wrong-answers or partial solves.

### P1b: Add a test-input inspection driver

New driver: **"By iteration 6, examine the test input structure (dimensions, object count, structural properties). Compare to training assumptions."**

Evidence from failures:
- arc-4e34c42c: Test had 6 objects requiring 2D assembly vs training's 3-4 in 1D chains
- arc-89565ca0: Test expected 5x6 output, not 5x4
- arc-78332cb0: Test 1 input exactly matched Train 0 output (strong signal of inverse relationship)

These are cases where early test inspection would have redirected hypothesis search toward the correct generalization.

### P1c: Add output sanity checking before return

New driver: **"Before returning, verify: (a) output dimensions match expected, (b) output does not contain values that should have been removed, (c) output structure is consistent with training examples."**

Evidence:
- arc-0934a4d8: Returned output containing 8s in a task about removing 8s
- arc-4e34c42c: Output was 7x34 vs expected 19x19
- arc-89565ca0: Output was 5x4 vs expected 5x6

These are cheap checks that would catch obvious errors before submission.

### P2a: Tighten hypothesis budget with reframing trigger

After 5 rejected hypotheses sharing the same framing, inject: **"Step back. What assumptions have all your hypotheses shared? Try a fundamentally different approach."**

Evidence: arc-78332cb0 tested 10 hypotheses all about "how to sort blocks" when the answer required a different conceptual frame. arc-89565ca0 tested 5 sorting hypotheses when the answer may have involved nesting/containment.

### P2b: Add training-sufficiency warning

When training has <= 3 examples and they share a structural property (e.g., all 1D, all same size, all simple), inject: **"Warning: training examples may not fully specify the pattern. Consider whether test cases could exercise different dimensions of the rule."**

Evidence: the training-validation trap appeared in arc-4e34c42c (training was 1D, test was 2D), arc-135a2760 (training had simple tiles, test had complex ones), and arc-78332cb0 (training had consistent orientation, test required different orientation).

### P2c: Discourage or improve child RLM delegation for ARC

All 3 delegation attempts across 80 trajectories failed. The child RLM has only 7 iterations and lacks the parent's accumulated context from training-example analysis.

Options: (a) disable delegation for ARC tasks, or (b) increase child iteration budget to 12+, or (c) pass summarized training analysis to the child as context.

### P3: Explore partial-credit scoring

Three failures were very close to correct:
- arc-135a2760 (026): 807/841 cells correct (96%)
- arc-0934a4d8 (026): bottom 5 of 9 rows perfect
- arc-195c6913 (026): 1 cell diff on Train 0

Binary scoring obscures the quality of near-misses and makes it impossible to measure incremental improvement between runs. Partial-credit scoring would surface whether driver changes improve solution quality even when they do not flip the binary outcome.

---

## Appendix: Data Sources

| Source | Path |
|--------|------|
| Run 022 trajectories | `/Users/sl/code/trinity/node-rlm/eval/analyses/003-opus-arc-feb13/run-022/trajectories/` |
| Run 023 trajectories | `/Users/sl/code/trinity/node-rlm/eval/analyses/003-opus-arc-feb13/run-023/trajectories/` |
| Run 026 trajectories | `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-026-drivers/trajectory-analysis/trajectories/` |
| Run 027 trajectories | `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-027-baseline/trajectory-analysis/trajectories/` |
| Run 026 analysis | `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-026-drivers/ANALYSIS.md` |
| Run 027 analysis | `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-027-baseline/ANALYSIS.md` |
| Run 022 vs 023 analysis | `/Users/sl/code/trinity/node-rlm/eval/analyses/003-opus-arc-feb13/trajectory-analysis-findings.md` |
| Structured cross-run data | `/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/cross-run-analysis.yml` |
