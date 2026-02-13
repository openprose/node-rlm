# Run 027 Baseline Analysis: Raw Opus 4.6 on ARC-AGI-2

**Run:** 027 (BASELINE -- no driver plugins, no app plugin)
**Model:** Claude Opus 4.6 (`anthropic/claude-opus-4-6`)
**Benchmark:** ARC-AGI-2 (20 tasks)
**Config:** maxIterations=20, maxDepth=2, maxBlocksPerIteration=1
**Paired with:** Run 026 (9 composable driver plugins, same 20 tasks)
**Date:** 2026-02-13

---

## Score Summary

| Metric | Value |
|--------|-------|
| **Overall accuracy** | **8/20 = 40%** |
| Perfect (score=1) | 8 tasks |
| Partial (0 < score < 1) | 0 tasks |
| Wrong (score=0) | 12 tasks |

All 12 failures were **timeouts** -- the model reached the 20-iteration limit without calling `return()`. Not a single task produced a wrong answer; the model either got the correct answer or ran out of time. There were zero cases of returning an incorrect grid.

### Iteration Budget Usage

| Category | Avg Iterations | Tasks |
|----------|---------------|-------|
| Perfect tasks | **12.4** (range 8-19) | 8 |
| Failed tasks | **20.0** (all hit limit) | 12 |

The successful tasks used a mean of 12.4 iterations (62% of budget). The most efficient success was `arc-6e453dd6` at 8 iterations; the tightest success was `arc-8f3a5a89` at 19 iterations (one iteration from timeout).

---

## What's Working: Natural Strengths Without Guidance

### 1. Strong Pattern Recognition and Hypothesis Formation

Raw Opus 4.6 demonstrates genuinely strong spatial reasoning. In every single trajectory -- including the failures -- the model forms plausible hypotheses about the transformation rule. It identifies structural elements (separators, borders, connected components, color semantics) quickly and accurately.

In the successful cases, hypothesis formation was rapid:

- **arc-6e453dd6** (8 iters, perfect): Identified connected components, per-component shift, and gap-marking rule in just 4 iterations. Quote from trajectory: "The transition from H2 to H3 represents a conceptual shift from row-based analysis to shape-based analysis."
- **arc-247ef758** (11 iters, perfect): Single hypothesis formed and refined. "The agent didn't jump to implementation but carefully reasoned through the centering rule."
- **arc-db695cfb** (13 iters, perfect): Breakthrough at iteration 2 with the diagonal-pair hypothesis. Only 2 rejected hypotheses before converging.

### 2. Systematic Data Probing

The model has a natural instinct to parse, visualize, and probe the data before committing. Every trajectory begins with 1-3 iterations of structured exploration: printing grid dimensions, extracting color counts, identifying structural elements. This is good practice and mirrors what driver-guided runs do explicitly.

### 3. Effective Self-Correction and Error Recovery

When training validation reveals mismatches, the model debugs systematically:

- **arc-135a2760** (15 iters, perfect): H1 (1D row patterns) validated perfectly on training but failed on the structurally different test case. The model immediately recognized the structural difference and devised H2 (2D tile patterns) rather than forcing H1. Quote: "Only 1 iteration wasted on applying H1 to the test before recognizing the need for H2."
- **arc-8f3a5a89** (19 iters, perfect): Progressed through 6 hypotheses (H1-H6), each refining the previous. When Train 1 failed with H3 (4-connectivity), the model correctly identified the need for 8-connectivity (H4). When Train 2 failed with H4, it correctly identified the edge-adjacency rule (H6).
- **arc-7ed72f31** (15 iters, perfect): Recovered from a `TypeError: center is not a function` by refactoring the function scope and improving the pairing algorithm simultaneously.

### 4. Training Validation Discipline

Every successful trajectory validates against training examples before returning. This pattern appears consistently:

- **arc-2ba387bc**: Cross-validated against all 4 training examples (iter 8, 10) before returning.
- **arc-b99e7126**: Ran `solveGrid()` on all 3 training examples, confirmed 3/3 match.
- **arc-db695cfb**: Verified against all 5 training examples -- "Train 0: CORRECT, Train 1: CORRECT, ..., Train 4: CORRECT."

### 5. Clean Code Implementation

When the model reaches the implementation phase, code quality is generally high. BFS-based connected component extraction, flood-fill algorithms, majority-voting pattern detection, and overlap-based stitching algorithms are all implemented correctly on first attempt in several trajectories. Implementation bugs are rare in the successful runs.

---

## What's Not Working: Failure Modes Without Driver Guidance

### Failure Mode 1: Analysis Paralysis / No Transition to Implementation (12/12 failures)

This is the dominant failure mode. **Every single failure** shares the same root cause: the model spends too many iterations exploring and not enough implementing. The explore-to-extract ratio is catastrophically skewed.

| Task | Explore iters | Extract iters | Verify iters | Implementation attempts |
|------|:---:|:---:|:---:|:---:|
| arc-0934a4d8 | 18 | 0 | 1 | 0 |
| arc-136b0064 | 18 | 0 | 0 | 0 |
| arc-195c6913 | 19 | 0 | 0 | 0 |
| arc-36a08778 | 20 | 0 | 0 | 0 |
| arc-446ef5d2 | 19 | 0 | 0 | 0 |
| arc-4e34c42c | 10 | 7 | 3 | 3 |
| arc-5961cc34 | 11 | 8 | 0 | 1 |
| arc-78332cb0 | 18 | 0 | 0 | 0 |
| arc-89565ca0 | 20 | 0 | 0 | 0 |
| arc-a251c730 | 15 | 4 | 1 | 1 |
| arc-aa4ec2a5 | 19 | 0 | 1 | 0 |
| arc-cbebaa4b | 13 | 4 | 3 | 1 |

**7 of 12 failures had zero implementation attempts.** The model never wrote a `solve()` function, never generated a test output, never called `return()`. It spent the entire 20-iteration budget exploring, diagnosing, and refining hypotheses.

Evidence from the trajectories:

- **arc-36a08778**: "Agent achieved correct understanding at iter 19 with statement 'Pattern verified! Now let me code the algorithm.' However, the iteration concluded with only a `console.log` rather than actual implementation."
- **arc-446ef5d2**: "Despite having all the necessary information and the correct algorithm (H5), the agent never implemented a solve function or called return()."
- **arc-195c6913**: "The agent never transitioned from exploration to extraction. By iteration 15, the conceptual understanding was sufficient to attempt a solve() function, but the agent chose to continue investigating details."

### Failure Mode 2: Breakthrough-Too-Late (5/12 failures)

In 5 of the 12 failures, the model actually discovered the correct (or near-correct) transformation rule -- but too late to implement it.

| Task | Breakthrough iter | Budget remaining | What happened |
|------|:---:|:---:|---|
| arc-0934a4d8 | 18 | 2 iters | Found transpose-mirror pattern, started verifying, timed out |
| arc-36a08778 | 19 | 1 iter | Found beam propagation model, wrote "Now let me code," timed out |
| arc-aa4ec2a5 | 19 | 1 iter | Found enclosed-hole rule at 100% match, no time to implement |
| arc-89565ca0 | 9 | 11 iters | Had correct answer at iter 9, then abandoned it after over-verification |
| arc-a251c730 | 11 | 9 iters | Validated perfectly on training, spent 8 more iters on test extraction |

The `arc-89565ca0` case is particularly tragic. The trajectory annotation states: "The correct answer [1, 8, 2, 4, 3] was computed at iteration 9 (45% through the budget) but never returned. The agent had sufficient time to succeed but self-sabotaged through over-verification and hypothesis abandonment."

### Failure Mode 3: Hypothesis Churn Without Commitment (8/12 failures)

The model tests many hypotheses but doesn't commit to any of them long enough to reach implementation:

| Task | Hypotheses tested | Hypotheses rejected | Avg iters per hypothesis |
|------|:---:|:---:|:---:|
| arc-89565ca0 | 11 | 11 | 1.8 |
| arc-136b0064 | 10 | 10 | 2.0 |
| arc-195c6913 | 12 | 12 | 1.7 |
| arc-aa4ec2a5 | 10 | 10 | 2.0 |
| arc-78332cb0 | 6 | 6 | 3.3 |
| arc-36a08778 | 8 | 7 | 2.5 |

The model frequently tests 1-2 iterations per hypothesis before pivoting, generating a flat exploration pattern rather than deepening any one promising direction. Compare this to the successful trajectories, where the model typically tests 1-4 hypotheses total and spends substantial time refining the accepted one.

### Failure Mode 4: No Iteration Budget Awareness (12/12 failures)

None of the 12 failed trajectories show any evidence that the model is tracking its iteration count or adjusting strategy as the budget depletes. There is no urgency signal at iteration 15, no "best effort" fallback at iteration 18, no emergency return at iteration 19.

Quotes from trajectory annotations:

- **arc-5961cc34**: "No indication agent recognized time pressure."
- **arc-4e34c42c**: "The agent did not track remaining iterations or prioritize returning an answer."
- **arc-cbebaa4b**: "At iteration 18 (2 iterations left), it should have prioritized returning a best-effort answer over continuing diagnosis."
- **arc-136b0064**: "The agent showed no urgency or time management. By iteration 15 (75% through), it should have committed to the most promising hypothesis."

### Failure Mode 5: Over-Verification Leading to Abandonment (2/12 failures)

In two cases, the model had a working hypothesis but over-verified it, discovered minor implementation bugs, and then abandoned the correct hypothesis entirely:

- **arc-89565ca0**: Sub-cell counting matched all training examples at iter 7. Agent computed correct test answer at iter 9. Then recounted and found grid-line detection bugs. Instead of fixing the implementation, abandoned the hypothesis and tested 7 more incorrect hypotheses.
- **arc-0934a4d8**: Found transpose-mirror pattern with perfect match on train 0 at iter 18. When train 1 showed mismatches, started debugging instead of returning the answer from the successful pattern.

### Failure Mode 6: Failed Delegation and Runtime Errors (2/12 failures)

- **arc-4e34c42c**: Attempted delegation to child RLM at iter 11 (1 wasted iteration), then hit function-scoping `TypeError` at iters 12-13 (2 more wasted iterations). Total: 3 iterations lost to operational issues, which was exactly the shortfall.
- **arc-cbebaa4b**: No delegation issues, but the algorithm had hard-coded assumptions (even marker counts, single component per color) that broke on test edge cases.

---

## Per-Task Summary Table

| Task ID | Score | Iters | Outcome | Hyps Tested | Breakthrough | Notes |
|---------|:-----:|:-----:|---------|:-----------:|:------------:|-------|
| arc-247ef758 | 1 | 11 | perfect | 1 | iter 5 | Shape placement at marker intersections. Single hypothesis, methodical refinement. |
| arc-135a2760 | 1 | 15 | perfect | 2 | iter 3 | Repeating pattern error correction. Adapted from 1D (training) to 2D (test) structure. |
| arc-6e453dd6 | 1 | 8 | perfect | 3 | iter 4 | Connected component shift + gap marking. Most efficient trajectory. |
| arc-2ba387bc | 1 | 12 | perfect | 5 | iter 7 | Hollow/solid shape pairing by sorted position. 4 rejected hypotheses before breakthrough. |
| arc-db695cfb | 1 | 13 | perfect | 4 | iter 2 | Diagonal 1-pairs with perpendicular 6-rays. Early breakthrough, thorough verification across 5 training examples. |
| arc-7ed72f31 | 1 | 15 | perfect | 4 | iter 5 | Reflection across 2-axes (line and point). Recovered from TypeError, refined pairing algorithm. |
| arc-b99e7126 | 1 | 16 | perfect | 4 | iter 9 | Tile-grid pattern stamping. Visual ASCII debugging was the turning point. |
| arc-8f3a5a89 | 1 | 19 | perfect | 6 | iter 16 | Flood-fill with edge-adjacency rule. 6 hypotheses refined incrementally. Narrowest success (1 iter from timeout). |
| arc-0934a4d8 | 0 | 20 | timeout | 10 | iter 18 | Transpose-mirror of 8-region. Breakthrough 2 iters from deadline; never implemented. |
| arc-136b0064 | 0 | 20 | timeout | 10 | none | Path-tracing with per-color offsets. 10 hypotheses, 0 implementations. Pure exploration loop. |
| arc-195c6913 | 0 | 20 | timeout | 12 | none | Staircase boundary pattern drawing. Understood pattern conceptually but never wrote code. |
| arc-36a08778 | 0 | 20 | timeout | 8 | iter 19 | Beam propagation with U-borders. Said "Now let me code" at iter 19; ran out of time. |
| arc-446ef5d2 | 0 | 20 | timeout | 5 | iter 6 | Border-matching rectangle assembly. Correct rule validated on training by iter 12, then analyzed test for 8 more iters without implementing. |
| arc-4e34c42c | 0 | 20 | timeout | 4 | iter 9 | Object stitching via edge overlap. Perfect training validation at iter 19, but no return call. Lost 3 iters to delegation fail + runtime errors. |
| arc-5961cc34 | 0 | 20 | timeout | 1 | iter 7 | Arrow beam cascade. Correct hypothesis validated across all training. Spent 6 iters on edge-case investigation, started coding at iter 19. |
| arc-78332cb0 | 0 | 20 | timeout | 6 | none | Section rearrangement. Partial patterns found (diagonal reading, 90deg rotation) but never synthesized into composite rule. |
| arc-89565ca0 | 0 | 20 | timeout | 11 | iter 7 | Rectangle ordering by sub-cell count. Correct answer computed at iter 9, then abandoned after over-verification. Most tragic failure. |
| arc-a251c730 | 0 | 20 | timeout | 6 | iter 11 | Pattern stamping at marker positions. Generated pixel-perfect output at iter 19 but never called return(). |
| arc-aa4ec2a5 | 0 | 20 | timeout | 10 | iter 19 | Enclosed-hole classification. 18 iters of pairing hypotheses before testing the intrinsic-property rule. |
| arc-cbebaa4b | 0 | 20 | timeout | 3 | iter 14 | Displacement-matching assembly. Perfect training validation but test edge cases (odd markers, split components) broke assumptions. |

---

## Key Observations: Behavioral Patterns in the Baseline

### 1. The Model Never Returns a Wrong Answer

This is a striking finding. All 8 successes are perfect (score=1), and all 12 failures are timeouts (score=0). The model has extremely high standards for what it will return -- it wants complete certainty. This perfectionism is both a strength (no wrong answers) and a fatal weakness (it would rather time out than submit an uncertain answer).

A guided run with driver plugins would inject time-management pressure: "You have 5 iterations remaining. Return your best answer now." The baseline model has no such mechanism.

### 2. Explore/Extract Phase Imbalance

Across all 20 tasks, the phase distribution is:

| Phase | Total iters (successes) | Total iters (failures) |
|-------|:-----------------------:|:----------------------:|
| Explore | 60 (60%) | 200 (83%) |
| Extract | 22 (22%) | 23 (10%) |
| Verify | 7 (7%) | 8 (3%) |
| Wasted | 2 (2%) | 9 (4%) |

Successful trajectories spend ~60% of iterations exploring and ~22% extracting. Failed trajectories spend ~83% exploring and only ~10% extracting. The model's natural bias is heavily toward continued exploration, and without a driver to prompt phase transitions, it stays in explore mode indefinitely.

### 3. The Model Understands More Than It Implements

In at least 8 of the 12 failures, the trajectory annotations identify a breakthrough iteration where the model discovers the correct rule. The average breakthrough-to-deadline gap in these cases is only 2.6 iterations -- not enough to implement, test, and return. This suggests the model's core reasoning capability is sufficient for these tasks; the bottleneck is operational discipline (when to stop exploring and start coding).

### 4. Verification Before Return Is Present But Costly

The model naturally verifies against training before returning, which is good. But in the failures, verification sometimes triggers a regression: the model finds a minor bug in its implementation, loses confidence, and abandons the correct hypothesis (see `arc-89565ca0`, `arc-0934a4d8`). A driver could enforce "fix the bug, don't abandon the hypothesis."

### 5. No Delegation Strategy

Only one trajectory (`arc-4e34c42c`) attempted delegation to a child RLM, and it failed (the child also timed out). The model shows no natural instinct to break complex problems into delegatable sub-tasks. The `arc-195c6913` trajectory notes: "The agent's reasoning at iteration 15 explicitly considered delegation but then immediately abandoned this idea and continued manual exploration."

### 6. Visual Debugging Is Effective But Underused

Several successful trajectories credit visual debugging as the breakthrough mechanism:

- **arc-b99e7126**: "Printing the tile patterns as ASCII art (iters 7-8) was a turning point."
- **arc-0934a4d8** (failed but insightful): "The breakthrough came from visualizing the data in iter 17. If the agent had started with visualization alongside symmetry testing, it might have discovered the pattern earlier."

The model sometimes uses visualization, but not systematically. In many failed trajectories, it performs abstract mathematical analysis (counting mismatches, computing percentages) when a simple grid print would have revealed the pattern faster.

### 7. Implementation Quality Is High When Reached

Tasks that reach the implementation phase tend to have clean, correct code on the first attempt. BFS, flood-fill, majority voting, and geometric calculations are all implemented competently. The model's coding ability is not the bottleneck -- the bottleneck is deciding when to start coding.

---

## Summary: The Case for Driver Plugins

The baseline run reveals that raw Opus 4.6 has strong spatial reasoning and pattern recognition capabilities for ARC-AGI-2 tasks. Its 40% accuracy on these tasks is entirely composed of perfect scores -- when it solves, it solves correctly.

However, the model lacks three critical meta-cognitive capabilities that driver plugins would provide:

1. **Phase management**: The ability to transition from exploration to implementation at the right time. The model's natural tendency is to keep exploring until it reaches complete certainty, which is incompatible with a 20-iteration budget.

2. **Budget awareness**: Tracking remaining iterations and adjusting strategy accordingly. None of the 12 failures show any evidence of time pressure awareness.

3. **Commitment under uncertainty**: The willingness to return a best-effort answer when time is running out. The model would rather time out with score 0 than return an uncertain answer with possible partial credit.

These are precisely the kinds of behavioral guardrails that composable driver plugins are designed to inject. The matched-pair comparison with Run 026 should reveal whether these drivers successfully address the timeout-dominated failure mode observed here.
