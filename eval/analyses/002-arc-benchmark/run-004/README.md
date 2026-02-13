# Run 004: Opus 4.6 Recursive (arc-solver v0.2.0)

## Configuration

| Parameter       | Value                            |
| --------------- | -------------------------------- |
| Model           | `anthropic/claude-opus-4.6`      |
| Max Iterations  | 15                               |
| Max Depth       | 2                                |
| Concurrency     | 1                                |
| App             | `arc-solver` v0.2.0 (recursive delegation protocol) |
| Drivers         | `one-block-per-iteration`, `deadline-return` |
| Tasks           | 2 (same as run-002, run-003)     |
| Timestamp       | 2026-02-13T11:32:53Z             |
| Total Wall Time | 382s (~6.4 min)                  |
| Est. Cost       | $0.57                            |

## Results

| Task ID        | Score | Iters | Wall Time | Verdict      | vs Run-002 | vs Run-003 |
| -------------- | ----- | ----- | --------- | ------------ | ---------- | ---------- |
| arc-0934a4d8   | 0     | 3     | 208s      | error (timeout) | Same (0) but found rule faster | Better (found correct reconstruction rule in 3 iters vs never) |
| arc-135a2760   | 0     | 4     | 173s      | wrong-answer (9/841 mismatches) | Same score, much better accuracy | Better (returned answer vs no-return; 98.9% accuracy) |

**Aggregate: 0/2 (0%)**

## The Key Change: What Was Different

Run-004 is the first test of **Opus 4.6** on the ARC benchmark. All prior runs used Sonnet 4.5. The same arc-solver v0.2.0 recursive delegation protocol was available, but Opus never used it.

The most striking behavioral difference: **Opus packed 7-9 code blocks per response**, treating each iteration as a complete problem-solving session. Every response hit `finish=length` (output token cap), producing 10K+ characters of interleaved reasoning and code. The harness extracted and executed all blocks, effectively giving Opus 7-9 "mini-iterations" per actual iteration.

This means Opus accomplished in 3-4 iterations what Sonnet needed 13-25 iterations for -- but at the cost of output truncation cutting off analysis before it could complete.

## What Worked

### 1. Dramatically faster hypothesis generation and testing

Opus compressed multi-step exploration into single responses. For arc-0934a4d8:
- **Sonnet (run-002):** Found 8-rectangle at iter 2, tested symmetries iter 3-7, found reconstruction rule at iter 21
- **Opus (run-004):** Found 8-rectangle, tested 3 symmetry types, discovered row/column mirror symmetry, tested 3 reconstruction strategies, and identified that col-mirror works for some examples and row-mirror for others -- all within 3 iterations

For arc-135a2760:
- **Sonnet (run-003):** Found repeating tile rule at iter 5
- **Opus (run-004):** Found repeating tile rule at iter 2, implemented tile finder, applied to test, validated on training, identified and diagnosed tile-period bug, and returned an answer -- all within 4 iterations

### 2. Best-ever cell accuracy on arc-135a2760

The returned answer for arc-135a2760 achieved **98.9% cell accuracy** (832/841 cells correct). This is the best result across all 4 runs:

| Run | Cell Accuracy | Returned? | Mismatches |
|-----|--------------|-----------|------------|
| Run-001 | N/A | No | N/A |
| Run-002 | ~90% (est) | Yes (format bug) | ~80 cells |
| Run-003 | N/A | No (budget) | N/A |
| Run-004 | 98.9% | Yes | 9 cells |

The 9 mismatches are all caused by a single algorithmic issue (tile period selection too permissive) that the model identified but couldn't fix before deadline.

### 3. Majority-vote tile reconstruction algorithm

Opus's tile-finding approach was sound: for each candidate tile period, build the tile by majority voting across all repetitions, count mismatches, select the period with fewest mismatches. This is robust against sparse corruption (1-3 errors per panel of 25+ rows).

### 4. Correct structural analysis

Both tasks were analyzed correctly at a structural level:
- arc-0934a4d8: 8-rectangle masking, dual mirror symmetry, correct reconstruction rules identified
- arc-135a2760: Panel structure, border layers, interior tile patterns, majority-vote correction

## What Failed

### 1. Output truncation (critical, affected both tasks)

Every Opus response hit the output token limit (`finish=length`). This is the dominant failure mode for this run:

- **arc-0934a4d8:** Iteration 3 was truncated while the model was determining which mirror to use for reconstruction. The timeout killed the task before iteration 4 could begin. The model was 1-2 code blocks away from having a complete solution.

- **arc-135a2760:** Iteration 3 was truncated during training validation. The model had identified the tile-period selection bug but couldn't implement the fix. It returned a best-effort answer in iteration 4.

**Root cause:** Opus's multi-block response style (7-9 code blocks per response) consumes the entire output token budget. The harness's output cap is calibrated for Sonnet's 1-block-per-iteration style and is insufficient for Opus.

### 2. No delegation despite maxDepth=2

Zero `rlm()` or `llm()` calls across both tasks. Opus never attempted delegation. This is the opposite of Sonnet in run-003, which delegated 3 parallel children on each task.

**Why Opus didn't delegate:**
1. Multi-block style leaves no room for delegation calls -- the model fills the response with solo code before it could write `rlm()` calls
2. Opus appears to treat each iteration as a self-contained problem-solving session, not as a step in a multi-agent workflow
3. The `one-block-per-iteration` driver was configured but Opus ignored it entirely

**Impact:** For arc-0934a4d8, delegation could have parallelized the 3 symmetry hypotheses. For arc-135a2760, delegation could have parallelized per-panel tile finding.

### 3. `one-block-per-iteration` driver was ignored

The driver configuration specified `one-block-per-iteration`, but Opus consistently generated 7-9 code blocks per response. The harness executed all of them rather than stopping after the first. This means the driver either:
- Was not enforced at the response-generation level (Opus wrote multiple blocks freely)
- Was not enforced at the execution level (harness ran all blocks, not just the first)

Either way, the driver had zero effect on Opus's behavior.

### 4. Tile period selection bug (arc-135a2760)

The `findBest2DTile` function accepted any tile period with fewer errors than the current best. For a 25-row panel, period 24 or 25 trivially achieves 0 errors by memorizing the entire input (including corruptions). The correct approach: prefer the smallest period with low errors, or cap the maximum period.

The model diagnosed this bug during iteration 3's training validation but was truncated before fixing it.

### 5. `deadline-return` driver worked partially

For arc-135a2760, the model did enter "DEADLINE MODE" and called `return()` with its best candidate. This is the first time in any run that an Opus model returned an answer for an ARC task. However, for arc-0934a4d8, the timeout killed the task before the deadline-return logic could fire.

## The Truncation Problem: Detailed Analysis

The central issue of run-004 is output truncation. Here is the data:

| Task | Iter | Input Chars | Output Chars | Blocks | finish |
|------|------|-------------|--------------|--------|--------|
| arc-0934a4d8 | 1 | ~70K | ~10K | 8+ | length |
| arc-0934a4d8 | 2 | ~70K | ~10K | 7+ | length |
| arc-0934a4d8 | 3 | ~70K | ~10K | 8+ | length |
| arc-135a2760 | 1 | ~52K | ~10K | 7+ | length |
| arc-135a2760 | 2 | ~52K | ~10K | 5+ | length |
| arc-135a2760 | 3 | ~52K | ~10K | 4+ | length |
| arc-135a2760 | 4 | ~52K | ~7K | 3 | stop |

Total input chars: 416,539. Total output chars: 68,223.

The only iteration that completed normally (finish=stop) was arc-135a2760 iteration 4, which was the deadline return. Every other iteration was truncated.

**Implication for Opus in the RLM harness:** The current output token limit is calibrated for models that produce 1 code block per iteration. Opus needs either:
- A higher output token limit (2-3x current), or
- Actual enforcement of one-block-per-iteration at generation time (stop token injection after first code fence), or
- A system prompt instruction that Opus actually follows (the current instruction was ignored)

## Did Opus Delegate?

**No. Not once. This is the most surprising finding of run-004.**

Run-003 (Sonnet 4.5) successfully delegated 3 parallel children per task. Run-004 (Opus 4.6) delegated zero times despite identical configuration (maxDepth=2, arc-solver v0.2.0 protocol, same system prompt).

The likely explanation: Opus's planning style is incompatible with the delegation protocol as currently specified. The protocol expects the model to:
1. Explore (1-2 iterations)
2. Generate hypotheses (1 iteration)
3. Delegate to children (1 iteration)
4. Parse results (1 iteration)
5. Refine or return

But Opus compresses steps 1-5 into a single response. By the time it would write the `rlm()` call, it has already explored, hypothesized, AND implemented the solution within the same response. Delegation feels redundant to a model that can do everything itself in one turn.

**Irony:** Opus didn't delegate because it was too capable per-iteration. But this same capability caused truncation, which prevented it from completing its analysis. Delegation would have been the correct strategy: let children handle parallel hypothesis testing while the parent manages the overall budget.

## Cross-Run Comparison

### arc-0934a4d8

| Metric | Run-001 (Sonnet) | Run-002 (Sonnet) | Run-003 (Sonnet) | Run-004 (Opus) |
|--------|-----------------|-----------------|-----------------|----------------|
| Iterations | 25 | 50 | 15 | 3 |
| Wall time | ~250s | ~500s | 210s | 208s |
| Found 8-rect | Yes | Yes | Yes | Yes (iter 2) |
| Found mirror rule | No | Yes (iter 21) | No | Partial (iter 3) |
| Tested col-mirror | No | Yes | No | Yes (iter 3) |
| Delegated | No | No | Yes (crashed) | No |
| Returned | No | No | No | No |
| Score | 0 | 0 | 0 | 0 |

**Insight density:** Opus reached the col-mirror/row-mirror reconstruction rule in 3 iterations. Sonnet needed 21 iterations in run-002 to reach the same understanding. Opus is approximately 7x more efficient at hypothesis generation and testing for this task -- but the truncation prevented it from completing the final step (determining which mirror to use for the test input).

### arc-135a2760

| Metric | Run-001 (Sonnet) | Run-002 (Sonnet) | Run-003 (Sonnet) | Run-004 (Opus) |
|--------|-----------------|-----------------|-----------------|----------------|
| Iterations | 25 | 13 | 15 | 4 |
| Wall time | ~250s | ~200s | 189s | 173s |
| Found tile rule | No | Yes (iter 3) | Yes (iter 5) | Yes (iter 2) |
| Validated 2/2 train | No | Yes (iter 11) | Yes (iter 13) | No (truncated) |
| Returned answer | No | Yes | No | Yes |
| Cell accuracy | N/A | ~90% | N/A | 98.9% |
| Score | 0 | 0 | 0 | 0 |

**Best accuracy:** Run-004's 98.9% accuracy is the best across all runs. Only 9 cells wrong out of 841. The remaining errors are all fixable with a tile-period cap.

## Recommendations

### 1. Increase output token limit for Opus (critical)

The current limit causes every Opus response to truncate. Either:
- Set a model-specific output limit (2-3x higher for Opus)
- Or enforce one-block-per-iteration at the harness level (execute only the first code block, discard the rest)

### 2. Enforce one-block-per-iteration at execution level

The driver is configured but not enforced. The harness should:
- Parse the model's response for code blocks
- Execute only the first code block
- Return its output as context for the next iteration
- This forces Opus to plan one step at a time, preserving iteration budget

### 3. Rewrite delegation instructions for Opus

Opus's planning style is incompatible with the current delegation protocol. For Opus, the protocol should:
- Explicitly say: "Do NOT write solution code in iteration 1. Only write exploration code."
- Require delegation calls to appear as the ONLY code in an iteration
- Provide a concrete template: "Your iteration 2 code should be EXACTLY: `const results = await Promise.all([rlm(...), rlm(...), rlm(...)]);`"

### 4. Add tile-period cap to arc-solver helper library

Add a utility function like:
```javascript
function findRepeatingTile(content, maxPeriod) {
  maxPeriod = maxPeriod || Math.floor(content.length / 3);
  // ... only search periods up to maxPeriod ...
}
```

This would have prevented the tile-period selection bug in arc-135a2760.

### 5. Re-run with output limit fix

Run-004 demonstrates that Opus 4.6 can solve these ARC tasks given sufficient output budget. Both tasks were on track for solution when truncation intervened. A re-run with 2x output limit and enforced one-block-per-iteration would likely produce the first non-zero scores on this task pair.

## Summary

Run-004 is paradoxically both the **most impressive** and **most frustrating** run in the series. Opus 4.6 demonstrated dramatically higher per-iteration insight density than Sonnet 4.5:
- Found reconstruction rules in 2-3 iterations (vs 5-21 for Sonnet)
- Achieved 98.9% cell accuracy on arc-135a2760 (best ever)
- Compressed 15 Sonnet-iterations of work into 4 Opus-iterations

But the output truncation problem turned these capabilities into a liability:
- Every response hit the token cap, cutting off analysis mid-stream
- arc-0934a4d8 timed out before completing its analysis
- arc-135a2760 returned a near-miss answer with a fixable bug

**No delegation occurred** despite identical configuration to run-003 (which delegated successfully). Opus's self-contained planning style -- solving entire problems in single responses -- is fundamentally incompatible with the multi-turn delegation protocol. The model doesn't delegate because it doesn't need to delegate within a single response; but it can't fit the full solution in a single response because of token limits.

The central lesson: **Opus needs a different harness configuration than Sonnet.** Higher output limits, enforced single-block iterations, and a rewritten delegation protocol that accounts for Opus's planning style. With these changes, Opus 4.6 is likely the strongest model for ARC tasks in this framework.
