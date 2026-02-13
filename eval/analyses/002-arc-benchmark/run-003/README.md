# Run 003: Recursive Delegation (arc-solver v0.2.0)

## Configuration

| Parameter       | Value                            |
| --------------- | -------------------------------- |
| Model           | `anthropic/claude-sonnet-4.5`    |
| Max Iterations  | 15                               |
| Max Depth       | 2                                |
| Concurrency     | 1                                |
| App             | `arc-solver` v0.2.0 (recursive strategist) |
| Drivers         | (via arc-solver app) |
| Model Aliases   | `fast` (Gemini Flash), `orchestrator` (Sonnet), `intelligent` (Opus) |
| Tasks           | 2 (same as run-002)              |
| Timestamp       | 2026-02-13T11:17:41Z             |
| Total Wall Time | 399s (~6.6 min)                  |
| Est. Cost       | $1.20                            |

## Results

| Task ID        | Score | Iters | Wall Time | Verdict      | vs Run-001 | vs Run-002 |
| -------------- | ----- | ----- | --------- | ------------ | ---------- | ---------- |
| arc-0934a4d8   | 0     | 15    | 210s      | timeout      | Same (was timeout @ 25) | Worse (was timeout @ 50 with 3/4 solution) |
| arc-135a2760   | 0     | 15    | 189s      | timeout      | Same (was timeout @ 25) | Worse (was wrong-answer @ 13, now timeout @ 15) |

**Aggregate: 0/2 (0%)**

## The Key Change: What Was Different

Run-003 is the first test of the **recursive delegation architecture** defined in `arc-solver.md` v0.2.0:

1. **Outer model as strategist:** The outer model (Sonnet) explores the task, formulates hypotheses, and delegates implementation/testing to child RLMs
2. **Child RLMs as implementers:** Children (Gemini Flash) receive a hypothesis + helper library, implement a transform, test it against training data, and return `{score, code}`
3. **Parallel testing:** Multiple hypotheses tested simultaneously via `Promise.all`
4. **maxDepth=2:** Children can run their own REPL loops (5-10 iterations each)
5. **Reduced outer budget:** 15 iterations instead of 50, since work is delegated

## What Worked

### Delegation protocol executed for the first time

In **arc-135a2760**, the model successfully:
- Generated 3 numbered hypotheses at iteration 1
- Spawned 3 child RLMs in parallel at iteration 2
- Passed the full HELPER_LIBRARY to all children
- Used `model: "fast"` for all children (cost-effective)
- Received structured `{score, code}` results from all 3 children
- Parsed and displayed results at iteration 4

This is the first time in 3 runs that the delegation machinery worked end-to-end. The `Promise.all` pattern, the structured return format, and the helper library injection all functioned as designed.

### HELPER_LIBRARY was passed to children

In both tasks, the model constructed the helper library constant and injected it into children's system prompts. This is a direct improvement over runs 001 and 002 where the model never used the helper library at all.

### Budget awareness appeared (faintly)

In arc-0934a4d8 at iteration 9, the model wrote: `"I'm at iteration 9 - entering deadline mode soon."` This is the first mention of iteration budget awareness in any run. The effect was zero (it didn't change behavior), but the signal exists.

## What Failed

### 1. Orchestrator alias bug

The `orchestrator` alias resolved to `anthropic/claude-sonnet-4-5-20250929` which is not a valid LiteLLM model ID. This caused a 400 error that destroyed arc-0934a4d8's first (and most important) delegation attempt at iteration 8.

```
anthropic/claude-sonnet-4-5-20250929 API error (400):
{"error":{"message":"anthropic/claude-sonnet-4-5-20250929 is not a valid model ID","code":400}}
```

The error cascaded: Promise.all failed, and the harness reported 2 additional rlm() calls as "NOT awaited." Three iterations' worth of API cost was wasted.

**Fix needed:** Correct the orchestrator alias mapping in the eval configuration.

### 2. Children given bad hypotheses

The core failure mode: the strategist delegated hypotheses it hadn't validated structurally.

For **arc-0934a4d8**, the model delegated:
- H1: "output is extracted from a reflected position" (already falsified by model in iters 3-7)
- H2: "output appears somewhere in the grid" (output doesn't exist verbatim in input)
- H3: "complex transform with rotation/reflection" (too vague, sent to crashed orchestrator)

All children scored 0/4. The hypotheses were bad because the model hadn't yet discovered the structural principle (column reversal + offset).

For **arc-135a2760**, the model delegated:
- H1: "row tiling" (correct direction, but too generic)
- H2: "alternating pattern extension" (similar to H1)
- H3: "2D symmetry correction" (wrong approach)

All children scored 0/2. The hypotheses were in the right neighborhood but lacked the critical structural insight (2-layer frame, interior-only correction).

**Lesson:** Delegation works best when the strategist has already identified structural properties (grid dimensions, frame structure, color roles) and can give children specific, well-scoped implementation tasks. Delegating early (before structural analysis) produces generic hypotheses that children can't refine.

### 3. Reduced iteration budget was catastrophic

15 iterations was far too few:

| Task | Iters to find rule (run-002) | Iters to find rule (run-003) | Budget |
|------|------------------------------|------------------------------|--------|
| arc-0934a4d8 | 21 | Never | 15 |
| arc-135a2760 | 3 | 5 | 15 |

For arc-0934a4d8, the model needed 20+ iterations of structural analysis in run-002. With only 15 iterations and 3 spent on failed delegation, there was no path to success.

For arc-135a2760, the model found the rule at iteration 5 but needed 8 more iterations to debug the implementation. It achieved 2/2 at iteration 13 with 0 iterations left to return.

### 4. No return() called (again)

Neither task called `return()`. The error is the same as every previous run:

```
"error": "RLM reached max iterations (15) without returning an answer"
```

For arc-135a2760, this is a pure budget problem -- the model achieved 2/2 at iteration 13 and simply had no iterations left. For arc-0934a4d8, the model never found the rule and had nothing to return.

### 5. Model abandoned delegation after failure

After getting 0/4 or 0/2 from all children, the model switched entirely to self-directed coding. It never delegated a refinement task as specified in the arc-solver protocol (iter 7: "Refine via delegation"). This meant the delegation was a pure overhead cost with no payoff.

## Cross-Run Comparison

### arc-0934a4d8: Regression

| Metric | Run-001 | Run-002 | Run-003 |
|--------|---------|---------|---------|
| Iterations | 25 | 50 | 15 |
| Found rule | No | Yes (iter 21) | No |
| Best train score | Unknown | 3/4 (iter 45) | 0/4 |
| Returned | No | No | No |
| Delegated | No | No | Yes (3 children, all failed) |
| Score | 0 | 0 | 0 |

**Verdict:** Run-003 is the worst run for this task. The reduced budget and failed delegation left no room for the extended exploration this task requires.

### arc-135a2760: Regression

| Metric | Run-001 | Run-002 | Run-003 |
|--------|---------|---------|---------|
| Iterations | 25 | 13/50 | 15/15 |
| Found rule | Timeout | Yes (iter 3) | Yes (iter 5) |
| Best train score | Unknown | 2/2 (iter 11) | 2/2 (iter 13) |
| Returned | No | Yes (iter 12) | No |
| Delegated | No | No | Yes (3 children, all 0/2) |
| Score | 0 | 0 (format bug) | 0 (no return) |

**Verdict:** Run-002 was better -- it returned an answer. Run-003's delegation overhead (+2 iterations) pushed the solution past the budget boundary. If the budget had been 17 instead of 15, the model would have had time to return.

## Infrastructure Issues Discovered

### 1. Model alias bug (critical, blocks orchestrator usage)

The `orchestrator` alias resolves to an invalid model ID. Must be fixed before any run that uses `model: "orchestrator"` for refinement delegation.

### 2. Iteration budget too small for delegation overhead

The delegation pattern adds ~3-4 iterations of overhead (spawn children, wait, parse results, compare). With a 15-iteration budget, this leaves only 11-12 iterations for actual work. For hard tasks, this is insufficient.

**Recommendation:** Budget should be `max(20, N)` where N is the estimated iterations for the task category. For ARC tasks that previously needed 20-50 iterations, a budget of 20-25 with delegation would be appropriate.

### 3. Promise.all error handling

When one child in a Promise.all batch crashes (e.g., the orchestrator alias bug), the entire batch fails and the other children's results are lost. The harness should catch individual promise rejections so partial results survive.

## Open Questions

1. **When should the strategist delegate?** Early delegation (before structural analysis) produced generic hypotheses that failed. Late delegation wastes budget on solo exploration. The sweet spot appears to be: explore structure yourself for 2-3 iterations, THEN delegate specific hypotheses.

2. **How to size the iteration budget?** 15 was too small. 50 (run-002) was more than enough for arc-135a2760 but still insufficient for arc-0934a4d8 to return. The ideal budget depends on task complexity, which is unknown in advance.

3. **Should the model skip delegation for "easy" tasks?** arc-135a2760 is simpler (2 training examples, clear diff pattern). The model could have solved it faster without delegation. A meta-strategy: if the task has few training examples and small diffs, solve directly; if it has 4+ examples and complex structure, delegate.

4. **How to prevent the model from abandoning delegation?** After all children scored 0, the model stopped delegating and went solo. The protocol says to delegate refinement (iter 7), but the model ignored this. Possible fix: make the protocol more explicit about what to do when all hypotheses fail.

## Summary

Run-003 marks the first successful execution of recursive delegation in ARC benchmarking. The machinery works: children are spawned, run their own REPL loops, test hypotheses, and return structured results. The helper library injection works. The parallel execution works.

However, the delegation was net-negative on both tasks in this run:
- **arc-0934a4d8:** Delegation crashed (alias bug) and wasted 3 iterations. Would have needed 20+ iterations regardless.
- **arc-135a2760:** Delegation succeeded mechanically but children all scored 0/2. Added 2 iterations of overhead, pushing the solution past the budget boundary.

The central lesson: **delegation is overhead unless the strategist gives children well-informed, specific tasks.** The arc-solver protocol's "explore, hypothesize, delegate" sequence is correct, but the exploration phase (iters 1-2) needs to produce structural insights, not just data visualization. Children need to know about frame structure, color roles, and grid organization -- not just "try tiling."
