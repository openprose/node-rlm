# Driver Recommendations for Run 028

**Based on:** Cross-run analysis of 80 trajectories across runs 022, 023, 026, 027
**Date:** 2026-02-13
**Author:** Claude Opus 4.6 (automated analysis)

---

## Current Driver Assessment (9 drivers from run-026)

### KEEP: Strong evidence of positive impact

**1. verify-all-examples (v0.2.0) -- KEEP as-is**

The single strongest behavioral signal across all 80 trajectories. All 13 run-026 successes validated against the complete training set before returning. Cross-run correlation: 86% success rate with verification (n=37) vs 19% without (n=43). No modification needed.

**2. verify-before-return (v0.1.0) -- KEEP as-is**

Complementary to verify-all-examples. Prevents the agent from returning a value it has never seen printed. All 13 run-026 successes logged the answer before returning. The two-iteration "log then return" pattern is consistently followed.

**3. deadline-return (v0.1.0) -- KEEP as-is**

Prevents total timeouts. In run-026, 6 of 7 failures returned an answer (vs 0 of 12 failures returning in the baseline). Under binary scoring, a wrong answer equals a timeout -- but wrong answers are vastly more diagnostic for the outer-loop improvement cycle. The sole timeout (arc-446ef5d2) was a case where the agent never entered the extract phase at all. No changes needed.

**4. one-block-per-iteration (v0.2.0) -- KEEP as-is**

Creates clean iteration boundaries. All run-026 trajectories show one action per step. Essential for trajectory analysis infrastructure and prevents hallucinated multi-block outputs. Low token cost, no negative effects observed.

**5. json-stringify-return (v0.1.0) -- KEEP as-is**

All returned answers were valid JSON grids. Low-visibility but prevents format-related score=0 outcomes. Costs almost nothing in tokens.

### MODIFY: Useful concept, needs changes based on evidence

**6. exploration-budget (v0.1.0 -> v0.2.0) -- MODIFIED**

The intended effect (forcing EXPLORE-to-EXTRACT transition) is the critical mechanism that differentiates the 5 drivers-help tasks. But the current version is too soft -- arc-446ef5d2 spent 19/20 iterations in explore mode despite the driver. The v0.2.0 rewrite adds:

- **Hard ceiling at iteration 12:** Must have attempted at least one implementation by then. The analysis shows successful tasks break through by iter 8 on average; failures that never implement are the costliest failure mode.
- **ARC-specific phase structure:** Orient (0-3), Hypothesize (4-8), Implement (9-16), Verify (17+). The generic "Orient/Commit/Execute" framing from v0.1.0 was written for data-analysis tasks, not ARC.
- **Removed generic content:** The "3-strike rule" and "can't find the labels" sections were irrelevant to ARC tasks and diluted the signal.

Evidence: on the 5 drivers-help tasks, run-026 averaged 8.0 explore iters vs run-027's 15.6 explore iters. The explore budget cuts exploration by ~50%, which converts timeouts into solves.

**7. hypothesis-budget (v0.1.0 -> v0.2.0) -- MODIFIED**

Successful run-026 tasks tested 3.2 hypotheses; failures tested 7.3. The v0.1.0 driver partially constrained churn but arc-78332cb0 still tested 10 hypotheses. The v0.2.0 rewrite adds:

- **Reframing trigger at 5 rejected hypotheses:** Forces the agent to identify the shared assumption across all failed hypotheses and try a fundamentally different framing. This directly addresses the arc-78332cb0 failure (10 sorting hypotheses when the answer was not a sorting problem) and arc-89565ca0 (5 sort-key hypotheses when the answer may have involved containment).
- **Kept the core 3-hypothesis protocol** and scoreboard.
- **Removed the "tie-breaking" section** which added words without changing behavior.

### REMOVE: No evidence of impact or net-negative

**8. overlap-testing (v0.1.0) -- REMOVE**

No clear behavioral signal in any trajectory. The analysis notes: "the most common failure mode was NOT checking test output properties (dimensions, value sanity). The driver may not be triggering when it should." The output-sanity-check driver (new) subsumes the useful part of this concept with concrete, actionable checks. arc-0934a4d8 returned 8s in a task about removing 8s -- if overlap-testing were working, it would have caught this. It didn't.

**9. arc-helper-library (v0.2.0) -- REMOVE**

The analysis found that "these appear to be reimplemented from scratch rather than imported from the library." In run-026, the model consistently wrote its own flood-fill, connected-component, and grid-manipulation code rather than using the provided functions. In run-022 (which had a monolithic app with the same helpers), library usage correlated with faster solves (arc-db695cfb at 7 iters, arc-2ba387bc at 9 iters) -- but the run-022 monolithic approach scored 5pp below baseline, so this acceleration did not translate to net benefit.

The library adds ~180 lines to the system prompt. That is a significant token and attention cost for a driver the model ignores. The model's own implementations work correctly when it reaches the implementation phase -- the bottleneck is getting to implementation, not implementation quality.

---

## New Drivers

### test-input-inspection (v0.1.0) -- NEW

**File:** `/Users/sl/code/trinity/node-rlm/plugins/drivers/test-input-inspection.md`

**What it does:** Forces the agent to examine test input structure (dimensions, object count, color palette) by iteration 6 and compare to training assumptions.

**Evidence supporting it:**
- arc-4e34c42c: Training was 1D chains, test required 2D grid assembly. Agent did not inspect test until iter 18.
- arc-89565ca0: Agent never checked expected output width (6, not 4). Wrong dimensions guaranteed score=0.
- arc-78332cb0: Test 1 input exactly matched Train 0 output -- a strong signal of inverse relationship that was never noticed.

**Expected impact:** Catches 2-3 of the training-test divergence failures by redirecting hypothesis search before the implementation phase. Low token cost (~25 lines).

### output-sanity-check (v0.1.0) -- NEW

**File:** `/Users/sl/code/trinity/node-rlm/plugins/drivers/output-sanity-check.md`

**What it does:** Before returning, validates output dimensions against training outputs, checks for values that should have been removed, and flags unexpected colors.

**Evidence supporting it:**
- arc-0934a4d8: Returned output containing 8s in a task about removing 8s. A value-range check would catch this.
- arc-4e34c42c: Output was 7x34 vs expected ~19x19. A dimension check would catch this.
- arc-89565ca0: Output was 5x4 vs expected 5x6. A dimension check would catch this.

**Expected impact:** Prevents guaranteed-zero submissions from dimension and value errors. These are free points -- the checks cost almost nothing to run but prevent obvious mistakes. Subsumes the intent of the removed overlap-testing driver with concrete, actionable code.

### no-arc-delegation (v0.1.0) -- NEW

**File:** `/Users/sl/code/trinity/node-rlm/plugins/drivers/no-arc-delegation.md`

**What it does:** Explicitly tells the agent not to use `rlm()` for ARC tasks.

**Evidence supporting it:**
- 0/3 success rate on delegation attempts across all 80 trajectories
- arc-195c6913: Child RLM hit max iterations (7) without returning. 1 wasted parent iteration.
- arc-cbebaa4b: Delegation failed, child reached max iterations. 1 wasted iteration.
- arc-4e34c42c (run-027): Delegation failed + runtime errors cost 3 iterations total.

**Expected impact:** Saves 1-2 iterations per task that would have attempted delegation. At 5% budget per iteration, this is material. Low token cost (~15 lines).

---

## Proposed Driver Stack for Run 028

| # | Driver | Version | Status | Token cost estimate |
|---|--------|---------|--------|---------------------|
| 1 | one-block-per-iteration | 0.2.0 | KEEP | ~30 lines |
| 2 | deadline-return | 0.1.0 | KEEP | ~30 lines |
| 3 | verify-all-examples | 0.2.0 | KEEP | ~40 lines |
| 4 | verify-before-return | 0.1.0 | KEEP | ~10 lines |
| 5 | exploration-budget | **0.2.0** | MODIFIED | ~35 lines (was ~40) |
| 6 | hypothesis-budget | **0.2.0** | MODIFIED | ~30 lines (was ~35) |
| 7 | json-stringify-return | 0.1.0 | KEEP | ~8 lines |
| 8 | test-input-inspection | **0.1.0** | **NEW** | ~25 lines |
| 9 | output-sanity-check | **0.1.0** | **NEW** | ~30 lines |
| 10 | no-arc-delegation | **0.1.0** | **NEW** | ~15 lines |

**Removed:**
- overlap-testing (no evidence of impact, subsumed by output-sanity-check)
- arc-helper-library (model ignores it, 180 lines of wasted tokens)

**Net change:** 10 drivers (was 9). Total estimated prompt lines ~253 (was ~360+). Despite adding a driver, the net token cost decreases because the 180-line helper library is removed.

---

## Expected Impact

### Quantitative predictions

Based on the failure mode analysis of run-026's 7 failures:

| Task | Failure mode | Addressed by | Expected flip? |
|------|-------------|--------------|----------------|
| arc-0934a4d8 | Out-of-bounds fallback returned 8s | output-sanity-check | Maybe -- catches the bad return, but the edge case itself remains hard |
| arc-135a2760 | Wrong tile period (96% correct) | No direct driver | Unlikely -- this is the drivers-hurt case; less aggressive exploration might help but hard to target |
| arc-195c6913 | Implementation exceeds capacity | No direct driver | Unlikely -- this is a model capability limit |
| arc-446ef5d2 | 19 explore iters, 0 extract | exploration-budget v0.2.0 (hard ceiling) | **Likely** -- the hard ceiling at iter 12 directly addresses this failure |
| arc-4e34c42c | 1D training, 2D test divergence | test-input-inspection | **Likely** -- early test inspection would redirect algorithm |
| arc-78332cb0 | 10 hypotheses, same framing | hypothesis-budget v0.2.0 (reframing trigger) | Maybe -- reframing might find the right approach, but the pattern is genuinely hard |
| arc-89565ca0 | Wrong output dimensions | output-sanity-check + test-input-inspection | Maybe -- catches the dimension error, but the sort key remains elusive |

**Conservative estimate:** 1-2 additional tasks solved (67-72% expected accuracy)
**Optimistic estimate:** 3-4 additional tasks solved (73-80% expected accuracy)

### Risk assessment

The main risk is the same one identified in the drivers-hurt analysis: stronger exploration ceilings could prevent discovery of superior algorithms on tasks where the first plausible approach is wrong. The arc-135a2760 case showed this with run-026.

Mitigation: the exploration-budget v0.2.0 sets the hard ceiling at iteration 12, not iteration 8. This leaves 4 iterations of hypothesis work after the Orient phase. The reframing trigger in hypothesis-budget v0.2.0 provides an escape hatch when the agent is stuck in a local optimum.

The 1:5 ratio (1 task hurt vs 5 tasks helped) from run-026 suggests the expected value remains strongly positive even if the harder ceiling costs 1 additional task.

---

## Changes Made

### Files modified:
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/exploration-budget.md` -- v0.1.0 to v0.2.0
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/hypothesis-budget.md` -- v0.1.0 to v0.2.0

### Files created:
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/test-input-inspection.md` -- v0.1.0
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/output-sanity-check.md` -- v0.1.0
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/no-arc-delegation.md` -- v0.1.0

### Files recommended for removal from the run-028 driver list:
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/overlap-testing.md` -- not deleted, just exclude from run config
- `/Users/sl/code/trinity/node-rlm/plugins/drivers/arc-helper-library.md` -- not deleted, just exclude from run config
