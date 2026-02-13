# Run 026 Analysis: ARC-AGI-2 with 9 Composable Driver Plugins

**Run ID:** 026
**Model:** Claude Opus 4.6
**Task set:** 20 ARC-AGI-2 tasks
**Configuration:** maxIterations=20, maxDepth=2, maxBlocksPerIteration=1
**Drivers:** one-block-per-iteration, deadline-return, verify-all-examples, verify-before-return, hypothesis-budget, exploration-budget, arc-helper-library, overlap-testing, json-stringify-return
**Paired with:** Run 027 (no drivers, same tasks/model/params)

---

## Score Summary

| Metric | Value |
|--------|-------|
| **Overall accuracy** | **13/20 (65%)** |
| Perfect (score=1) | 13 |
| Partial (0 < score < 1) | 0 |
| Wrong answer (score=0) | 6 |
| Error/timeout (score=0) | 1 |

**Breakdown of failures (7 tasks):**

| Task | Outcome | Failure Mode | Iterations |
|------|---------|-------------|------------|
| arc-0934a4d8 | wrong-answer | Out-of-bounds symmetry fallback | 19 |
| arc-135a2760 | wrong-answer | Incorrect tile period detection | 19 |
| arc-195c6913 | wrong-answer | Incorrect turn logic | 19 |
| arc-446ef5d2 | error/timeout | Never implemented; analysis paralysis | 20 |
| arc-4e34c42c | wrong-answer | Incomplete pattern generalization (1D vs 2D) | 20 |
| arc-78332cb0 | wrong-answer | Wrong layout orientation | 17 |
| arc-89565ca0 | wrong-answer | Incorrect sort key | 19 |

**Key statistic:** Perfect tasks averaged 12.5 iterations. Failed tasks averaged 19.0 iterations. Every failure exhausted nearly the full iteration budget, indicating the agent fights hard before giving up.

---

## What Is Working

### 1. Verify-before-return is strongly enforced and visibly helps

Every single successful task shows the agent validating its solution against **all** training examples before applying to test. This is a consistent, high-value behavior across all 13 wins.

Evidence from `arc-2ba387bc` (score=1, 10 iters):
> "Iter 8: Validated against all 4 training examples. Result: 4/4 perfect matches. Score: 4/4"

Evidence from `arc-b99e7126` (score=1, 14 iters):
> "iter 12: Validation result: 3/3 training examples pass"

Evidence from `arc-36a08778` (score=1, 18 iters):
> "iter 18: test on training: 6/6 pass -- algorithm validated"

This pattern appears in all 13 perfect tasks without exception. In the failures, verification also plays a role -- the agent detects when its solution does not pass training (e.g., `arc-195c6913` where solve2() produced 1/52/93 diffs) and avoids returning a known-bad answer until deadline pressure forces it.

### 2. Hypothesis-driven exploration with quantitative evidence

The agent consistently tests hypotheses against concrete data rather than speculating. Rejected hypotheses are dismissed with numerical evidence, not vague intuitions.

Evidence from `arc-0934a4d8` (symmetry task):
> "H1: 758-806 diffs across entire grid" (rejected)
> "H6: Q1<->Q4: 78/225, Q2<->Q3: 69/225, too low" (rejected)
> "H8: rows 2+29=31, cols 3+28=31... 4/4 train pass" (accepted)

Evidence from `arc-6e453dd6` (shape transformation):
> "H1: 1/3 training examples pass; too aggressive (matches non-enclosed holes)" (rejected)
> "H2: 1/3 training examples pass; still too aggressive" (rejected)
> "H3: rows with enclosed holes AND touching shape's rightmost column -- 3/3 train match" (accepted)

This disciplined approach means the agent does not commit to a pattern until it has statistical evidence. It is visible in all 20 tasks.

### 3. Systematic structural analysis before hypothesis formation

Successful tasks consistently invest 2-5 iterations in parsing, visualizing, and structurally decomposing the input before forming hypotheses. This upfront investment pays off.

Evidence from `arc-2ba387bc` (score=1, 10 iters):
> "Phase 1: Data Exploration (iter 0-3) -- Agent invested 4 iterations in understanding data structure before hypothesis testing. This prevented premature pattern-jumping."

Evidence from `arc-5961cc34` (score=1, 14 iters):
> "Phase 1-2: Agent didn't jump to conclusions. It methodically identified all special cells (4, 2, 3, 1), labeled components, analyzed bounding boxes, and examined output patterns before forming hypotheses."

Evidence from `arc-b99e7126` (score=1, 14 iters):
> "Phase 2: Deep dive into the grid structure... Grid has 7x7 tiling structure with 3x3 content tiles. Divider rows/columns at positions 0, 4, 8, 12, 16, 20, 24, 28."

### 4. Deadline-return prevents total timeouts in most cases

The `deadline-return` driver forced the agent to submit an answer even when the solution was imperfect. Of the 7 failures, 6 managed to return an answer (albeit wrong). Only `arc-446ef5d2` timed out without returning -- and that task was the sole instance where the agent never entered the EXTRACT phase at all (0 extract iterations, 19 explore iterations).

Evidence from `arc-135a2760`:
> "Iter 17: Agent explicitly recognized 'DEADLINE MODE' and decided to revert to the iter-8 transform() function that passed 2/2 training."

Evidence from `arc-0934a4d8`:
> "Time pressure: Agent reached 'DEADLINE mode' at iter 18 (2 iterations remaining), forcing a hasty fallback."

### 5. Incremental refinement through multiple solve() versions

Several tasks show the agent creating 2-5 versions of its solve() function, each fixing specific issues diagnosed from training feedback. This iterative approach is robust.

Evidence from `arc-36a08778` (score=1, 18 iters):
> "5 implementation attempts: solve v1 (1/6 pass) -> v2 (0/6) -> v3 (4/6) -> v4 (6/6 pass). Each fix addressed a specific diagnosed bug."

Evidence from `arc-8f3a5a89` (score=1, 17 iters):
> "solve() v1: Basic flood-fill + border (1/3) -> solve2(): Added 8-connectivity (2/3) -> solve3(): Fixed component erasure (3/3)"

### 6. Connected-component analysis as a reliable algorithmic primitive

Multiple successful tasks leveraged flood-fill and connected-component labeling. This is a strong pattern for ARC tasks. Tasks that discovered this approach early tended to succeed.

Used in: `arc-2ba387bc` (BFS rectangles), `arc-5961cc34` (shape identification), `arc-6e453dd6` (flood-fill enclosure), `arc-7ed72f31` (8-connectivity components), `arc-8f3a5a89` (component labeling), `arc-aa4ec2a5` (enclosed hole detection), `arc-a251c730` (connected-component pattern extraction), `arc-cbebaa4b` (shape detection).

---

## What Is Not Working

### 1. Analysis paralysis: Exploration without implementation transition

The most severe failure mode. The agent explores exhaustively but never transitions to the EXTRACT phase in time.

**Worst case -- `arc-446ef5d2`** (score=0, timeout):
> "20 iterations of pure EXPLORE with 0 EXTRACT iterations. The agent essentially spent 20 iterations doing what successful agents do in 5-8 iterations."
> "itersExplore: 19, itersExtract: 0, implementationAttempts: 0"

The agent correctly identified the assembly pattern at iter 9-10 and the quadrant mapping at iter 13, but spent iters 14-19 refining edge detection and corner classification without ever writing a `solve()` function.

**Also visible in `arc-89565ca0`** (score=0):
> "13 of 19 iterations were spent in exploration/diagnosis without testing complete hypotheses."

The exploration-budget driver is not aggressively enough enforcing a transition to implementation. On successful tasks, the EXPLORE-to-EXTRACT transition happens around iteration 8-10. On failures, it happens at iteration 15+ or never.

### 2. Training-validation trap: overfitting to simple training examples

Several failures show the agent achieving perfect training accuracy with a solution that does not generalize to test data.

**`arc-4e34c42c`** (score=0, 1D chain passes training but test requires 2D assembly):
> "Training-validation trap: Agent achieved perfect training accuracy (2/2) at iter 17, which created false confidence and prevented exploration of alternative hypotheses. The training examples were an incomplete specification of the full pattern."

**`arc-135a2760`** (score=0, smallest-tile heuristic passes training but wrong on test):
> "Training set bias: The two training examples had simple patterns where the smallest high-scoring tile happened to be correct."
> "Score on test: 96% correct (807/841 cells) but score=0 due to grid mismatch."

**`arc-78332cb0`** (score=0, hardcoded rules pass training, fail test):
> "Premature commitment: After achieving 3/3 training validation, agent immediately applied to test without considering edge cases."

The `verify-all-examples` driver successfully ensures training validation, but there is no corresponding driver for *test-time sanity checking* (e.g., output dimension validation, checking for obviously wrong values like 8s in a task about removing 8s).

### 3. Late test-data inspection

In multiple failures, the agent does not look at test input structure until 90%+ through the iteration budget.

**`arc-4e34c42c`**:
> "Agent didn't inspect test case structure until iter 18 (after implementing full solver). Discovered the 2D requirement at iter 19 (last iteration before deadline)."

**`arc-89565ca0`**:
> "Agent never checked the actual width of the expected output (6, not 4)."

A driver that encourages early test-data inspection (e.g., "by iteration 5, examine test input dimensions and structure") would catch cases where the test departs from training assumptions.

### 4. Hypothesis churn without convergence

Some failures show rapid cycling through hypotheses without integrating findings.

**`arc-78332cb0`** (10 hypotheses tested, 9 rejected):
> "Spent 9 iterations testing sorting/ordering hypotheses. Each hypothesis worked for 1-2 examples but failed on others. Agent got stuck trying to find a single unified ordering rule."

**`arc-89565ca0`** (5 hypotheses tested, 5 rejected):
> "None of the sort keys matched the training examples perfectly. Agent committed to pixel-count sorting despite knowing it failed all training examples."

The hypothesis-budget driver should potentially enforce convergence: after N rejections, force a different framing rather than continuing to iterate on the same approach.

### 5. Failed RLM delegation wastes iterations

Two tasks attempted to delegate to a child RLM, and both attempts failed:

**`arc-195c6913`** (iter 14):
> "Child RLM hit max iterations (7) without returning. This cost 1 iteration."

**`arc-cbebaa4b`** (iter 10):
> "Delegation failed - child RLM reached max iterations (7) without returning. This consumed 1 iteration but provided no value."

With maxDepth=2, the child RLM has 7 iterations -- which appears insufficient for ARC subtask implementation. These wasted iterations are costly in a 20-iteration budget.

### 6. Edge-case failures after correct pattern discovery

Three tasks correctly identified the core pattern but failed on edge cases in the test input:

**`arc-0934a4d8`**: Point symmetry formula correct, but test grid had out-of-bounds column indices. Agent's fallback produced `[[8,8,8],...]` when the entire purpose was to replace 8s.
> "Verification step: Before returning, check if the output contains any 8s. [[8,8,8],...] should have triggered a 'sanity check failed' error."

**`arc-135a2760`**: Tile detection correct on training, but smallest-tile heuristic missed larger tiles in test.
> "R4 1x3: score=0.850 (SELECTED by algorithm) vs R4 4x4: score=0.980 (CORRECT tile)"

**`arc-195c6913`**: Path-tracing rule correct, but turn logic broke on different staircase geometries.
> "1 diff on Train 0, 52 diffs on Train 1, 93 diffs on Train 2"

---

## Per-Task Summary Table

| Task ID | Score | Iters | Wall Time | Outcome | Hypotheses (Tested/Rejected) | Breakthrough Iter | Notes |
|---------|-------|-------|-----------|---------|------------------------------|-------------------|-------|
| arc-247ef758 | 1 | 11 | 152s | perfect | 3/2 | 6 | Shape placement at border marker intersections. Clean multi-marker + overlap handling. |
| arc-2ba387bc | 1 | 10 | 99s | perfect | 3/2 | 7 | Frame/solid rectangle pairing by position order. BFS detection, 4/4 train. |
| arc-7ed72f31 | 1 | 10 | n/a | perfect | 3/2 | 6 | Reflection across lines of 2s. Fixed 4-conn to 8-conn in one iteration. |
| arc-db695cfb | 1 | 10 | 159s | perfect | 6/5 | 8 | Diagonal line connections. Coordinate grouping (r+c, r-c) was key breakthrough. |
| arc-6e453dd6 | 1 | 11 | 156s | perfect | 3/2 | 8 | Shape shift + enclosed hole detection via flood-fill. Zero wasted iterations. |
| arc-aa4ec2a5 | 1 | 12 | 136s | perfect | 3/2 | 5 | Component classification by enclosed holes. Fixed border/hole overlap ordering. |
| arc-a251c730 | 1 | 13 | 190s | perfect | 2/1 | 12 | Template pattern stamping at markers. Pivoted from closest-center to connected-components. |
| arc-5961cc34 | 1 | 14 | 265s | perfect | 3/2 | 8 | Ray-tracing with directional redirects. Fixed boundary stopping logic. |
| arc-b99e7126 | 1 | 14 | 206s | perfect | 3/2 | 9 | Tile anomaly pattern = output shape on tile grid. Elegant multi-level abstraction. |
| arc-136b0064 | 1 | 17 | 285s | perfect | 4/3 | 13 | Snake path with shape-encoded movements. Complex multi-shape, multi-direction task. |
| arc-8f3a5a89 | 1 | 17 | 256s | perfect | 5/4 | 10 | Flood-fill region + border drawing + component erasure. 3 solve() versions. |
| arc-36a08778 | 1 | 18 | 330s | perfect | 1/0 | 5 | Segment chaining with rectangular frames. 5 implementation attempts, all targeted fixes. |
| arc-cbebaa4b | 1 | 18 | 461s | perfect | 5/4 | 5 | Puzzle assembly via 2-connector ports. Greedy best-match BFS placement. |
| arc-78332cb0 | 0 | 17 | 330s | wrong | 10/9 | 14 | Block rearrangement. Hardcoded orientation rules from training; test required different orientation. |
| arc-0934a4d8 | 0 | 19 | 209s | wrong | 9/8 | 10 | Point symmetry correct but OOB fallback for boundary columns produced 8s in output. |
| arc-135a2760 | 0 | 19 | 247s | wrong | 5/3 | 8 | 2D tile repair. Smallest-tile heuristic underfitted test regions (96% cells correct, score=0). |
| arc-195c6913 | 0 | 19 | 806s | wrong | 5/4 | 13 | Staircase path tracing. Turn logic correct on Train 0 (1 diff) but failed Train 1/2. |
| arc-89565ca0 | 0 | 19 | 364s | wrong | 5/5 | none | Rectangle sorting. Never found correct sort key. Wrong output dimensions (5x4 vs 5x6). |
| arc-4e34c42c | 0 | 20 | 421s | wrong | 8/7 | 9 | Object assembly. 1D chain passed training but test required 2D grid layout. |
| arc-446ef5d2 | 0 | 20 | 349s | timeout | 9/8 | 9 | Component assembly. 0 EXTRACT iterations. Understood pattern but never implemented. |

---

## Driver-by-Driver Assessment

### one-block-per-iteration
**Effect:** Forces single code block execution per iteration, creating clean iteration boundaries.
**Evidence:** All trajectories show a clean iter-by-iter progression with one action per step. This makes the traces highly readable and prevents the agent from doing too much in one step without checkpointing.
**Verdict:** Working well. No negative effects observed.

### deadline-return
**Effect:** Forces the agent to return an answer as the iteration budget runs out.
**Evidence:** 6 of 7 failures returned an answer (albeit wrong). Only `arc-446ef5d2` timed out -- and that task had 0 extract iterations, suggesting the agent never formed a returnable answer.
**Verdict:** Working well. Prevents total timeouts. Could be enhanced to trigger earlier (e.g., at iter 16/20 rather than 18-19/20) to allow more time for test application.

### verify-all-examples
**Effect:** Encourages validating on all training examples, not just one.
**Evidence:** All 13 successful tasks validated on the complete training set. Several failures also benefited by detecting partial failures (e.g., `arc-195c6913`: 1/52/93 diffs across three training examples).
**Verdict:** High-value driver. The strongest behavioral signal across all trajectories.

### verify-before-return
**Effect:** Ensures the agent checks its solution against training before returning.
**Evidence:** Visible in every trajectory. Even under deadline pressure, agents verify training accuracy before returning (e.g., `arc-135a2760` re-verified 2/2 training pass before reverting to original solution).
**Verdict:** High-value driver. Complementary to verify-all-examples.

### hypothesis-budget
**Effect:** Intended to prevent unbounded hypothesis churn.
**Evidence:** Mixed. Successful tasks averaged 3.2 hypotheses tested. Failures averaged 7.3 hypotheses tested. The worst case (`arc-78332cb0`) tested 10 hypotheses. The driver does not appear to effectively cap exploration -- the agent still churns through many hypotheses in failure cases.
**Verdict:** Partially working. The budget may need to be tighter, or should enforce a "step back and reframe" action after N rejections rather than simply continuing.

### exploration-budget
**Effect:** Intended to enforce transition from EXPLORE to EXTRACT phase.
**Evidence:** Successful tasks spent 56% of iterations in EXPLORE (avg 7.0 explore iters). Failures spent 73% in EXPLORE (avg 13.7 explore iters). The worst case (`arc-446ef5d2`) spent 19/20 iterations exploring. The driver is not effectively forcing the transition.
**Verdict:** Not working well enough. The explore-to-extract transition is the critical differentiator between success and failure. A hard ceiling (e.g., "must attempt implementation by iteration 12") would likely improve outcomes.

### arc-helper-library
**Effect:** Provides reusable ARC utility functions (flood-fill, component detection, etc.).
**Evidence:** Multiple tasks leveraged flood-fill and component analysis (at least 8 of 13 successes). However, these appear to be reimplemented each time rather than provided by the library. It is unclear how much the library contributed versus the agent's own algorithmic knowledge.
**Verdict:** Unclear impact. Would benefit from explicit logging of library function usage.

### overlap-testing
**Effect:** Intended to help with test-time verification.
**Evidence:** No clear evidence this driver affected behavior. The most common failure mode was NOT checking test output properties (e.g., dimensions, value sanity). This driver may not be triggering when it should.
**Verdict:** Insufficient impact. Needs strengthening -- should enforce checks like "do test output dimensions match expected?" and "does output contain obviously invalid values?"

### json-stringify-return
**Effect:** Ensures the answer is returned as JSON-stringified grid.
**Evidence:** All returned answers were valid JSON grids. No formatting errors observed.
**Verdict:** Working as intended. Low-visibility but prevents format-related score=0 outcomes.

---

## Key Recommendations for Next Run

### 1. Add a hard exploration ceiling

The single most impactful change. Enforce: **"By iteration 12, you must have attempted at least one complete implementation and tested it on training data."**

Evidence: Successful tasks break through by iter 8-10 on average. Failures that never implement (`arc-446ef5d2`) or implement too late (`arc-89565ca0` at iter 17) are the costliest failure modes.

### 2. Add a test-input inspection driver

New driver: **"By iteration 6, examine the test input structure (dimensions, object count, structural properties). Compare to training assumptions."**

This would catch:
- `arc-4e34c42c`: Test had 6 objects requiring 2D assembly vs training's 3-4 objects in 1D chains
- `arc-89565ca0`: Test expected 5x6 output, not 5x4
- `arc-78332cb0`: Test 1 input exactly matched Train 0 output (strong signal of inverse relationship)

### 3. Add output sanity checking before return

New driver: **"Before returning, verify: (a) output dimensions are reasonable, (b) output does not contain obviously invalid values, (c) output has expected structure."**

This would catch:
- `arc-0934a4d8`: Output contained 8s -- the entire task was about removing 8s
- `arc-4e34c42c`: Output was 7x34 vs expected 19x19
- `arc-89565ca0`: Output was 5x4 vs expected 5x6

### 4. Tighten the hypothesis budget with a reframing trigger

After 5 rejected hypotheses on the same framing, force: **"Step back. Reconsider whether you are asking the right question. What assumptions have all your hypotheses shared? Try a fundamentally different approach."**

This would help:
- `arc-78332cb0`: 10 hypotheses all asking "how to sort blocks" when the right question was "what determines output orientation"
- `arc-89565ca0`: All hypotheses about sorting when the right question may have been about nesting/containment

### 5. Discourage child RLM delegation for ARC tasks

Both delegation attempts failed (child RLM timed out at 7 iterations). ARC tasks require deep contextual understanding that does not transfer well to a child process with limited iterations.

Recommended: Either disable delegation for ARC or increase child iteration budget to 12+.

### 6. Add a "training sufficiency" warning

When training examples are few (2-3) and all share a structural property (e.g., all 1D chains, all simple tiles), emit a warning: **"Training examples may not fully specify the pattern. Consider whether test cases could exercise different dimensions of the rule."**

This addresses the training-validation trap seen in `arc-4e34c42c`, `arc-135a2760`, and `arc-78332cb0`.

### 7. Consider partial-credit evaluation

Three failures were very close to correct:
- `arc-135a2760`: 96% of cells correct (807/841)
- `arc-0934a4d8`: Bottom 5 rows of 9 were perfect; only top 4 rows wrong
- `arc-195c6913`: Train 0 had only 1 diff out of 400 cells

Binary scoring obscures the quality of these attempts. Partial credit would better measure incremental improvements between runs.

---

## Aggregate Statistics

| Metric | Successes (n=13) | Failures (n=7) | Delta |
|--------|-------------------|-----------------|-------|
| Avg iterations used | 12.5 | 19.0 | +6.5 |
| Avg hypotheses tested | 3.2 | 7.3 | +4.1 |
| Avg hypotheses rejected | 2.2 | 6.3 | +4.1 |
| Avg explore iterations | 7.0 | 13.7 | +6.7 |
| Avg extract iterations | 2.5 | 3.3 | +0.8 |
| Avg verify iterations | 1.3 | 0.7 | -0.6 |
| Avg implementation attempts | 1.9 | 2.7 | +0.8 |
| Avg wasted iterations | 0.2 | 0.7 | +0.5 |
| Breakthrough before iter 10 | 10/13 (77%) | 2/7 (29%) | -48pp |

**The clearest predictor of success is breakthrough timing.** Tasks where the core pattern was identified by iteration 10 succeeded 83% of the time (10/12). Tasks where breakthrough occurred after iteration 10 or never succeeded only 38% of the time (3/8).

**The second predictor is explore/extract ratio.** Successful tasks had an average explore:extract ratio of 2.8:1. Failures had a ratio of 4.2:1 (or infinite for `arc-446ef5d2`).

---

## Summary

Run 026 with 9 composable drivers achieved 65% accuracy (13/20) on ARC-AGI-2 tasks. The strongest driver behaviors are **verify-all-examples** and **verify-before-return**, which are consistently enforced and directly contribute to correct answers. The **deadline-return** driver successfully prevents most total timeouts.

The primary weakness is insufficient enforcement of the **exploration-to-extraction transition**. The exploration-budget driver allows the agent to spend 15-20 iterations exploring without implementing, which is the dominant failure mode. Secondarily, the agent does not inspect test data early enough and does not perform output sanity checks before returning.

The recommended changes for the next run are: (1) a hard exploration ceiling at iteration 12, (2) a test-input inspection trigger at iteration 6, and (3) output sanity checking before return. These three changes would address 5 of the 7 failure modes observed in this run.
