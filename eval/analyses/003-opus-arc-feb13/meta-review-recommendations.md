# Meta-Review Recommendations for Batch 003 (Opus ARC Feb 13)

## Context

Two matched-pair eval runs on 20 ARC tasks:
- **run-022**: WITH `arc-solver.md` plugin. 9/20 correct (45%)
- **run-023**: WITHOUT `arc-solver.md` plugin. 10/20 correct (50%)

The plugin **hurt performance by 5 percentage points.** This is the central finding that the meta-review's 5 recommendations must be evaluated against.

---

## 1. Cross-Run Task-Level Comparison

| Task ID | run-022 (plugin) | run-023 (no plugin) | Delta | Notes |
|---|---|---|---|---|
| arc-0934a4d8 | 0 (wrong, 19 iter) | 0 (timeout, 20 iter) | tie | Both hit boundary-symmetry edge case |
| arc-135a2760 | 0 (wrong, 8 iter) | **1** (perfect, 13 iter) | -1 | Plugin's `findRepeatingTile` was wrong; no-plugin used 2D modulo approach |
| arc-136b0064 | 0 (20 iter) | **1** (perfect, 20 iter) | -1 | |
| arc-195c6913 | 0 (19 iter) | 0 (wrong, 19 iter) | tie | |
| arc-247ef758 | 0 (wrong, 17 iter) | **1** (perfect, 17 iter) | -1 | Plugin run had overlap-priority bug; no-plugin solved it |
| arc-2ba387bc | **1** (perfect, 9 iter) | 0 (timeout, 20 iter) | +1 | Plugin run solved fast; no-plugin churned on sorting heuristic |
| arc-36a08778 | 0 (19 iter) | 0 (wrong, 20 iter) | tie | |
| arc-446ef5d2 | 0 (wrong, 19 iter) | 0 (20 iter) | tie | |
| arc-4e34c42c | 0 (19 iter) | 0 (timeout, 17 iter) | tie | |
| arc-5961cc34 | **1** (perfect, 11 iter) | **1** (perfect, 16 iter) | tie | Plugin run more efficient (11 vs 16 iter) |
| arc-6e453dd6 | **1** (perfect, 13 iter) | **1** (perfect, 9 iter) | tie | No-plugin run more efficient |
| arc-78332cb0 | 0 (wrong, 18 iter) | 0 (timeout, 9 iter) | tie | Plugin run explored more; no-plugin got stuck in analysis paralysis |
| arc-7ed72f31 | **1** (15 iter) | **1** (perfect, 11 iter) | tie | No-plugin more efficient |
| arc-89565ca0 | 0 (wrong, 19 iter) | 0 (error, 2 iter) | tie | No-plugin aborted early (streaming timeout) |
| arc-8f3a5a89 | **1** (perfect, 11 iter) | 0 (timeout, 1 iter) | +1 | No-plugin aborted in iter 1 (streaming timeout) |
| arc-a251c730 | **1** (18 iter) | **1** (perfect, 9 iter) | tie | No-plugin much more efficient |
| arc-aa4ec2a5 | N/A (missing) | **1** (perfect, 11 iter) | N/A | Only in run-023 |
| arc-b99e7126 | **1** (perfect, 19 iter) | **1** (perfect, 14 iter) | tie | No-plugin faster |
| arc-cbebaa4b | 0 (19 iter) | 0 (20 iter) | tie | |
| arc-db695cfb | **1** (perfect, 7 iter) | **1** (perfect, 13 iter) | tie | Plugin run nearly twice as fast |

**Summary of deltas:**
- Plugin wins: arc-2ba387bc, arc-8f3a5a89 = **2 tasks**
- No-plugin wins: arc-135a2760, arc-136b0064, arc-247ef758 = **3 tasks**
- Ties: 14 tasks (both correct: 5, both wrong: 9)
- Excluded: arc-aa4ec2a5 (only in run-023)

**Net effect: plugin costs 1 task (-5%).** The plugin's arc-8f3a5a89 "win" is questionable since the no-plugin run aborted at iteration 1 due to a streaming timeout, not a reasoning failure.

---

## 2. Evaluation of the Meta-Review's 5 Recommendations

### Recommendation 1: Structured trajectory data alongside markdown (trajectories.jsonl)
**Applicability to this batch: HIGH**

This batch vividly demonstrates the need. Building the cross-run comparison table above required reading 40 individual markdown files and manually extracting frontmatter fields. The meta-review estimated +30% analysis velocity; based on the actual labor of this analysis, that estimate is conservative. A `trajectories.jsonl` per run would have enabled the comparison table in seconds.

**Concrete action:**
- Add a post-distillation step that reads all `trajectories/*.md` files and emits `trajectories.jsonl` with all frontmatter fields plus derived metrics (e.g., `explorationIterations`, `extractionIterations`, `verificationIterations` parsed from control flow).
- Priority: **P1** -- this is blocking efficient analysis of every future run.

### Recommendation 2: Automated cross-run comparison with diff-to-config mapping
**Applicability to this batch: CRITICAL**

This is the highest-leverage recommendation for this specific batch. The entire point of runs 022 vs 023 was to measure the plugin's effect, and that comparison had to be done manually. A `cross-analyze.ts` tool would have immediately flagged:
- The 3 regressions caused by the plugin (arc-135a2760, arc-136b0064, arc-247ef758)
- The 2 improvements from the plugin (arc-2ba387bc, arc-8f3a5a89)
- That the plugin's `findRepeatingTile` helper was actively harmful in arc-135a2760
- That tasks where both runs succeed, the no-plugin run is often faster (5 of 5 shared successes had equal or fewer iterations without the plugin)

**Concrete action:**
- Build `cross-analyze.ts` that takes two result JSONs + config diff, outputs per-task delta table and aggregate metrics.
- Include iteration-efficiency comparison for shared successes (plugin runs averaged 13.2 iter vs no-plugin 12.0 iter on shared successes).
- Priority: **P0** -- this is the single highest-leverage tool for the current workflow.

### Recommendation 3: Close the loop (analysis -> prompt/config diffs)
**Applicability to this batch: HIGH**

This analysis reveals three specific prompt-level fixes that should be generated as diffs:

1. **Remove `findRepeatingTile` from arc-solver.md or fix its algorithm.** The helper's "first minimum errors" heuristic caused the arc-135a2760 regression. The no-plugin run used a superior 2D modulo-arithmetic approach with majority voting. The fix: either remove the function or change it to prefer the shortest tile length among equal-error candidates and add 2D pattern awareness.

2. **Add deadline-return enforcement earlier.** Both runs show the same failure pattern: agents hit "DEADLINE MODE" at iterations 18-19 but either fail to return (arc-0934a4d8 run-023 timed out) or return a known-bad heuristic (arc-0934a4d8 run-022). The arc-solver.md says "Late (iters 11+): pick your best-scoring transform" but this guidance is too soft. The fix: add an explicit rule like "At iteration N-3, you MUST call return() with your best candidate. Do not explore further."

3. **Add overlap-handling guidance.** arc-247ef758 failed in run-022 due to the wrong overlap-priority rule ("first writer wins" vs "last writer wins"). The plugin should include guidance: "When shapes overlap, test BOTH orderings against training data."

**Concrete action:**
- Generate a `recommendations.json` with the three diffs above, each referencing specific task IDs as evidence.
- Priority: **P1** -- these are concrete, testable changes.

### Recommendation 4: Per-iteration telemetry in trace data
**Applicability to this batch: MEDIUM**

Two specific cases where per-iteration telemetry would have been valuable:
- **arc-89565ca0 (run-023)**: Aborted after 2 iterations with 271s wall time. The trajectory annotator had to guess: "Streaming timeout hypothesis: The model may have exceeded a streaming output timeout while generating detailed analysis." Per-iteration `wallTimeMs` and `inputChars`/`outputChars` would have diagnosed this instantly.
- **arc-8f3a5a89 (run-023)**: Aborted after 1 iteration with 256s wall time. Same diagnosis problem.

These two streaming timeouts account for 2 of the 10 failures in run-023. If they are infrastructure problems (not reasoning failures), the "true" no-plugin score might be 10/18 (56%) rather than 10/20 (50%), changing the plugin comparison significantly.

**Concrete action:**
- Add `wallTimeMs` per iteration to `TraceEntry`. This is the minimum viable telemetry.
- Investigate whether the streaming timeouts are caused by verbose logging (both aborted tasks had the RLM logging full grid contents, which for 29x30 grids is ~870 cells per grid).
- Priority: **P2** -- important for diagnosing infrastructure vs reasoning failures, but lower leverage than recs 1-3.

### Recommendation 5: Failure mode regression tracking
**Applicability to this batch: MEDIUM**

This batch reveals several failure modes that should be tracked across runs:
- `timeout-on-edge-case` (arc-0934a4d8): Present in both runs. Persistent across the matched pair. The boundary-symmetry problem is genuinely hard.
- `analysis-paralysis` / `hypothesis-churn` (arc-78332cb0, arc-89565ca0): Present in both runs. The pattern of spending 15+ iterations exploring without implementing anything is a systemic failure.
- `incorrect-tile-detection` (arc-135a2760): Present only in the plugin run. The plugin's helper function was the direct cause.
- `overlap-priority-wrong` (arc-247ef758): Present only in the plugin run.
- `early-termination` (arc-89565ca0, arc-8f3a5a89 in run-023): These look like infrastructure issues, not reasoning failures.

A `failure-registry.json` would help distinguish:
- Persistent failures (both runs fail the same task the same way) -- these need algorithm-level fixes
- Plugin-induced regressions (task passes without plugin, fails with) -- these need plugin fixes
- Infrastructure failures (timeouts, aborts) -- these need harness fixes

**Concrete action:**
- Build the registry as part of the `cross-analyze.ts` tool (rec 2).
- Priority: **P2** -- valuable but can be bundled with rec 2.

---

## 3. Additional Findings the Meta-Review Missed

### Finding A: The plugin's helper library can be actively harmful

The meta-review praised the plugin system as "clean prompt composition" but did not consider that providing a helper library can cause regressions. The `findRepeatingTile` function in `arc-solver.md` has a flawed algorithm (greedy first-minimum-errors search). In arc-135a2760:
- **With plugin (run-022)**: Agent used the provided `findRepeatingTile`, got a wrong tile period, scored 0.
- **Without plugin (run-023)**: Agent invented its own modulo-arithmetic + majority-voting approach, which was superior. Scored 1.

This is a concrete case where the plugin's "tested and correct" helper was wrong for the task's edge case. The meta-review should have flagged: **provided helper functions must be validated against the specific eval task set, not just in isolation.**

**Action:** Audit all helper functions in `arc-solver.md` against the 20-task eval set. Remove or fix any that produce wrong results. Consider marking helpers as "optional reference implementations" rather than "tested and correct -- do not reimplement."

### Finding B: The no-plugin model is often more iteration-efficient

On the 5 tasks where both runs succeeded, the no-plugin run used fewer iterations in 3 cases, equal in 1, and more in 1:

| Task | Plugin iter | No-plugin iter | Delta |
|---|---|---|---|
| arc-5961cc34 | 11 | 16 | plugin +5 faster |
| arc-6e453dd6 | 13 | 9 | no-plugin +4 faster |
| arc-7ed72f31 | 15 | 11 | no-plugin +4 faster |
| arc-a251c730 | 18 | 9 | no-plugin +9 faster |
| arc-b99e7126 | 19 | 14 | no-plugin +5 faster |
| arc-db695cfb | 7 | 13 | plugin +6 faster |

Average: plugin = 13.8 iter, no-plugin = 12.0 iter. The plugin adds ~1.8 iterations of overhead on average for tasks that are ultimately solved. This suggests the plugin's guidance (or the overhead of copying the helper library) slows down the model's natural problem-solving process.

**Action:** Investigate whether the helper library copy step (mandated in "your first code block") is consuming an iteration that the model would otherwise use for exploration. Consider lazy-loading helpers only when needed.

### Finding C: Analysis paralysis is the dominant failure mode, and the plugin does not address it

The most common failure pattern across both runs is spending too many iterations exploring without committing to an implementation:
- **arc-78332cb0 (run-022)**: 18 iterations, 15 spent exploring, never found rule. (run-023): 9 iterations, ALL exploring, aborted.
- **arc-89565ca0 (run-022)**: 19 iterations, 15 exploring hypotheses, none worked. (run-023): 2 iterations, aborted.
- **arc-0934a4d8 (both runs)**: Found the correct symmetry rule by iter 8-9, then spent 10+ iterations stuck on an edge case without returning a partial answer.
- **arc-78332cb0**: In run-022, the agent tested 8+ ordering hypotheses across 6 iterations without implementing any. In run-023, it computed features for 9 iterations without ever writing a candidate transformation.

The plugin's iteration guide says "Late (iters 11+): pick your best-scoring transform" but this is not enforced and is regularly ignored. A more forceful intervention is needed.

**Action:** Add a hard checkpoint to the RLM harness or plugin: "If you have not called `return()` by iteration N-3, you MUST return your best candidate in the next iteration. A partial answer always beats a timeout." Consider implementing this as a system-level guard rather than a prompt suggestion.

### Finding D: Streaming timeouts are a confound that masks the true comparison

Run-023 had 2 tasks (arc-89565ca0, arc-8f3a5a89) that aborted in iterations 1-2 due to apparent streaming timeouts (271s and 256s wall time, trivial iteration counts). These are infrastructure failures, not reasoning failures. Run-022 did not have this problem for those same tasks (arc-89565ca0 ran all 19 iterations, arc-8f3a5a89 ran 11 iterations).

This means the matched-pair comparison is confounded: run-023's score of 10/20 includes 2 infrastructure failures. If those tasks had run to completion, run-023 might have scored 11/20 or 12/20, making the plugin's negative effect even larger.

**Action:** Add retry logic for infrastructure failures (streaming aborts, API errors). Flag infrastructure failures separately from reasoning failures in the analysis. Rerun aborted tasks before drawing conclusions about prompt/plugin effects.

### Finding E: The plugin's `testAllSymmetries` guidance was useful but underutilized

The plugin explicitly says: "In one of your first 3 iterations, run `testAllSymmetries`." Looking at the trajectories where symmetry was relevant:
- **arc-0934a4d8 (run-022)**: The agent did search for symmetries, finding axis 15.5 by iteration 8. But it did not use `testAllSymmetries` -- it wrote its own symmetry search. The plugin's `testAllSymmetries` function only tests the 7 standard transforms, not parametric symmetry axes, so it would not have helped here.
- **arc-b99e7126 (run-022)**: The agent discovered the self-similar tiling pattern without using `testAllSymmetries`.

The standard symmetries (identity, reflectH, reflectV, rotate90, rotate180, rotate270, transpose) are rarely the complete answer for ARC tasks. Most ARC tasks have domain-specific transformations. The plugin's emphasis on standard symmetries may be wasting early iterations.

**Action:** Soften the `testAllSymmetries` guidance. Change "In one of your first 3 iterations, run `testAllSymmetries`" to "Consider testing standard symmetries early if the task appears to involve spatial transforms. For tasks with custom rules (tiling, ray-tracing, pattern completion), skip this and invest early iterations in understanding the task-specific structure."

---

## 4. Prioritized Action Plan

### P0: Build cross-run comparison tooling [Meta-review rec 2]
- Create `cross-analyze.ts` that auto-generates the task-level delta table
- Include config diff mapping (what changed between runs)
- Flag regressions, improvements, and infrastructure failures separately
- **Why P0:** Without this, every A/B comparison requires hours of manual file reading. This batch took that manual effort. Future batches should not.

### P1a: Fix or remove `findRepeatingTile` in arc-solver.md [New finding A]
- The function's greedy algorithm caused a regression in arc-135a2760
- Either fix (prefer shortest tile, add 2D awareness) or remove and let the model invent its own approach
- Change "tested and correct -- do not reimplement" to "reference implementations -- use or improve as needed"
- **Evidence:** arc-135a2760 run-022 (score 0, used plugin helper) vs run-023 (score 1, invented superior algorithm)

### P1b: Add hard deadline-return enforcement [New finding C, meta-review rec 3]
- Implement a system-level guard: at iteration `maxIterations - 3`, inject a system message forcing return
- Change plugin guidance from "pick your best" (soft) to "you MUST return" (hard)
- **Evidence:** arc-0934a4d8 (run-023 timed out despite having partial answer), arc-78332cb0 (both runs), arc-89565ca0 (run-022 spent 19 iterations without finding rule)

### P1c: Add overlap-testing guidance to plugin [New finding from arc-247ef758]
- Add: "When implementing a rule that involves overlapping elements, test BOTH orderings (first-writer-wins vs last-writer-wins) against ALL training examples"
- **Evidence:** arc-247ef758 run-022 (score 0, wrong overlap rule) vs run-023 (score 1, same overlap rule happened to be correct due to different implementation path)

### P1d: Emit trajectories.jsonl for programmatic analysis [Meta-review rec 1]
- Post-distillation script to parse frontmatter from all `*.md` files into JSONL
- Include computed metrics: iteration phase distribution, pattern counts, failure mode
- **Why P1:** Enables P0 tooling and all future analysis automation

### P2a: Add per-iteration wallTimeMs to TraceEntry [Meta-review rec 4]
- Minimum viable telemetry to distinguish infrastructure failures from reasoning failures
- **Evidence:** arc-89565ca0 and arc-8f3a5a89 in run-023 (streaming timeouts masquerading as reasoning failures)

### P2b: Add retry logic for infrastructure failures [New finding D]
- Detect "This operation was aborted" errors and retry the task
- Flag retried tasks in the results
- **Evidence:** 2 of 20 tasks in run-023 were lost to infrastructure, confounding the comparison

### P2c: Soften testAllSymmetries guidance [New finding E]
- Make it conditional on task type rather than mandatory in first 3 iterations
- **Evidence:** No ARC task in this batch was solved by a standard symmetry operation alone

### P3: Build failure-mode regression registry [Meta-review rec 5]
- Bundle with cross-analyze tooling (P0)
- Track persistent failures, plugin-induced regressions, infrastructure failures
- Can wait until cross-analyze.ts exists

---

## 5. Key Insight: The Plugin Net-Negative Result

The most important finding for the trajectory distillation work is that the `arc-solver.md` plugin produced a **net-negative result** (-5%). This challenges the assumption that more guidance is always better. The specific mechanisms of harm were:

1. **Buggy helper function** (`findRepeatingTile`): Provided a flawed algorithm that the model trusted instead of inventing a better one. Cost: 1 task (arc-135a2760).

2. **Iteration overhead**: Copying the helper library and following the "test all symmetries early" guidance consumed iterations that the model could have spent on task-specific exploration. Average iteration count on shared successes: 13.8 (plugin) vs 12.0 (no-plugin).

3. **False confidence from training validation**: The plugin's emphasis on "verify on ALL training examples" is sound in principle, but in arc-247ef758, perfect training validation masked an ambiguous overlap rule. The model validated a heuristic that happened to work on training but failed on test.

4. **Guidance ignored under pressure**: The plugin's "return before your budget runs out" and "Late (iters 11+)" guidance was consistently ignored when agents entered analysis paralysis mode. Prompt guidance alone is insufficient; system-level enforcement is needed.

The implication for trajectory distillation: **trajectories from the no-plugin run (run-023) are generally higher quality training data for distillation**, because they show the model's natural problem-solving approach without the overhead and misdirection of the plugin. The 5 shared-success trajectories from run-023 are particularly valuable -- they demonstrate efficient, unguided ARC solving.

However, the plugin run's successes on arc-2ba387bc and arc-8f3a5a89 (where run-023 failed due to timeout/abort) suggest the plugin can help in some cases. The ideal plugin would provide lightweight guidance (deadline enforcement, overlap-testing reminders) without heavyweight helper functions or mandatory early steps.

---

## 6. Recommended Distillation Priorities for This Batch

### Best trajectories for positive distillation (teach "how to solve ARC well"):
1. **arc-5961cc34 (run-022)**: Ray-tracing task solved in 11 iterations. Methodical exploration, clean hypothesis formation, perfect first-attempt implementation. Textbook trajectory.
2. **arc-db695cfb (run-022)**: Diagonal+perpendicular task solved in 7 iterations. Fastest solve in the batch. Demonstrates efficient exploration-to-implementation pipeline.
3. **arc-247ef758 (run-023)**: Shape-placement task solved in 17 iterations. Shows strong self-correction (overlap bug found and fixed) and thorough verification.
4. **arc-b99e7126 (run-023)**: Self-similar tiling task solved in 14 iterations. Demonstrates multi-level abstraction and systematic hypothesis testing with backtracking.
5. **arc-135a2760 (run-023)**: Pattern repair via modulo-arithmetic. Shows algorithmic superiority over the plugin's helper function. Good example of the model inventing the right algorithm.

### Best trajectories for negative distillation (teach "what not to do"):
1. **arc-78332cb0 (run-023)**: 9 iterations, ALL exploration, zero implementation. Textbook analysis paralysis. The model computed features endlessly without ever testing a hypothesis.
2. **arc-89565ca0 (run-022)**: 19 iterations of hypothesis churn. Tested 8+ sorting heuristics without finding the rule. Never verified any hypothesis against all training examples.
3. **arc-0934a4d8 (run-023)**: Reached "MUST RETURN NOW" at iteration 19 but still explored instead of returning. Demonstrates the failure of soft deadline guidance.

### Matched pairs for contrastive distillation (teach "why this approach beats that one"):
1. **arc-135a2760**: run-022 (plugin helper, score 0) vs run-023 (custom algorithm, score 1). Shows that inventing the right algorithm beats using a provided-but-flawed one.
2. **arc-247ef758**: run-022 (wrong overlap rule, score 0) vs run-023 (correct overlap handling, score 1). Shows the importance of testing edge cases in rules.
3. **arc-78332cb0**: run-022 (18 iterations, partial exploration, wrong answer) vs run-023 (9 iterations, pure exploration, abort). Both fail, but the run-022 trajectory at least attempted an answer. Demonstrates that attempting an answer is always better than timing out.
