# Run 005: Opus 4.6 Linear (No Delegation)

## Configuration

| Parameter       | Value                            |
| --------------- | -------------------------------- |
| Model           | `anthropic/claude-opus-4.6`      |
| Max Iterations  | 30                               |
| Max Depth       | 1 (no delegation)                |
| Concurrency     | 1                                |
| App             | `arc-solver` v0.2.0              |
| Drivers         | `one-block-per-iteration`, `deadline-return` |
| Tasks           | 1 (`arc-0934a4d8`)               |
| Timestamp       | 2026-02-13T11:44:31Z             |
| Total Wall Time | 127s (~2 min)                    |
| Est. Cost       | $0.15                            |

## Results

| Task ID        | Score | Iters Used | Iters Available | Wall Time | Verdict |
| -------------- | ----- | ---------- | --------------- | --------- | ------- |
| arc-0934a4d8   | 0     | 2          | 30              | 127s      | timeout |

**Aggregate: 0/1 (0%)**

## The Central Question: Why Only 2 Iterations of 30?

Opus 4.6 used **2 harness iterations** but wrote **15 self-narrated "iterations"** within those 2 LLM responses. Both responses hit `finish=length` (output token cap at 4096 default `max_tokens`).

The model completely ignored the `one-block-per-iteration` driver:
- **Response 1:** 6 code blocks, narrating "iterations 1-6"
- **Response 2:** 8 complete + 1 truncated code block, narrating "iterations 7-15"

The harness executed all code blocks from each response within a single iteration, then recorded the trace as 2 entries. After response 2 was truncated and timed out, the run ended with an empty answer and 28 unused iterations.

## What Happened: Three-Stage Failure Cascade

### Stage 1: Hallucinated Simple Task (Response 1)

Opus wrote 6 code blocks in a single response. The first 3 blocks ran correctly against the real data (showing 30x30 grids, 4 training examples, etc.), but the model had already written blocks 4-6 based on a **hallucinated task** -- it fabricated a simple 3x3 "replace 0 with 2" pattern:

```javascript
// Train 0: 3x3 -> 3x3
// Pattern is very clear: replace all 0s with 2s. That's it!
```

The actual task has 30x30 inputs with 8-colored corruption regions and symmetry-based reconstruction. Code block 3's verification loop ran against the real data and produced hundreds of mismatches, but the model never saw them (all blocks were already written).

Code block 6 called `return()` with a wrong 30x30 grid, but this was **intercepted by the iteration-0 early-return guard** (the harness blocks `return()` on the first iteration to force verification).

### Stage 2: Self-Correction and Genuine Progress (Response 2)

After receiving the combined output from response 1 (including the mismatches and early-return interception), Opus self-corrected and began genuine analysis:

- Identified the 8-region concept ("rectangular region of 8s... related to what should be behind them")
- Confirmed 8-rect dimensions match output dimensions for all 4 training examples
- Tested horizontal-flip, vertical-flip, and 180-degree rotation symmetry
- Found that H-flip works for Train 0 and 2 but fails for Train 1 and 3
- Was investigating multi-axis symmetry when the response was truncated

This analysis was on a productive trajectory -- the model had correctly identified the problem structure (find and reconstruct the 8-corruption region) and was systematically testing symmetry operations.

### Stage 3: Truncation and Timeout

Response 2 was cut off at 10,191 chars (`finish=length`), mid-code:
```javascript
console.log("\nCorresponding values
```

The harness received a partial code block, executed the 8 complete blocks (which produced legitimate analytical output), hit a `ReferenceError: process is not defined` from one block, and then the operation timed out.

## Key Findings

### 1. Opus 4.6 does not comply with one-block-per-iteration

Sonnet 4.5 in runs 002-003 mostly obeyed the one-block-per-iteration driver. Opus 4.6 shows **zero compliance**. It writes multi-step reasoning with interleaved code blocks, treating the LLM response as a scratchpad for an entire reasoning chain rather than a single REPL step.

This is the fundamental mismatch: the harness expects a REPL dialogue (model writes code, harness runs it, model sees output, repeat). Opus 4.6 expects to solve the problem in extended reasoning within a single response, hallucinating the intermediate states.

### 2. The output token cap is a hard wall

With `max_tokens=4096` (the default), Opus 4.6 gets roughly 10K characters of output per response. When writing multi-block reasoning, this is consumed quickly. Response 2 was producing genuinely useful analysis when truncated.

For single-block-per-iteration compliance, 4096 tokens is likely sufficient (one code block + reasoning = ~500-1500 tokens). The cap only becomes catastrophic when the model writes multiple blocks per response.

### 3. Hallucinated intermediate outputs are a new failure class

This is distinct from previous runs' failure modes. In runs 001-003 (Sonnet 4.5), the model wrote one block per response and received real feedback. In run 005 (Opus 4.6), the model fabricated a complete task narrative between code blocks, including a fictional 3x3 grid task that bears no resemblance to the actual 30x30 input. The model essentially ran a mental simulation of the REPL that diverged from reality after the first code block.

### 4. The early-return guard creates a paradox with multi-block responses

The iteration-0 guard assumes that iteration 0 = the model's first piece of reasoning. But when the model writes 6 "iterations" of reasoning in response 1, the return() call in "iteration 6" is actually the model's considered answer after exploration and verification. The guard blocks this legitimate (if hallucination-based) return and forces the model into response 2, where it starts over.

### 5. Opus identified the 8-region faster than Sonnet

Despite the failures, Opus 4.6 found the 8-corruption-region concept in response 2's first code block ("iteration 7"), equivalent to what took Sonnet 4.5 14 iterations in run-001 and 21 iterations in run-002. The model's raw reasoning capability on spatial patterns appears stronger -- it was bottlenecked by the harness interaction model, not by its analytical ability.

## Cross-Run Comparison (arc-0934a4d8)

| Metric | Run-001 (Sonnet) | Run-002 (Sonnet) | Run-003 (Sonnet) | Run-005 (Opus) |
|--------|------------------|------------------|------------------|----------------|
| Model | Sonnet 4.5 | Sonnet 4.5 | Sonnet 4.5 | Opus 4.6 |
| Max Iters | 25 | 50 | 15 | 30 |
| Iters Used | 25 | 50 | 15 | 2 |
| Found 8-region | Yes (iter 14) | Yes (iter 21) | No | Yes (resp2 block 1) |
| Best train score | Unknown | 3/4 (iter 45) | 0/4 | N/A (never scored) |
| Returned | No | No | No | Blocked by iter-0 guard |
| 1-block compliance | Yes | Yes | Yes | No |
| Failure mode | no-return | no-return | no-return | multi-block-self-hallucination |
| Score | 0 | 0 | 0 | 0 |

## Recommended Fixes (Priority Order)

### 1. Enforce one-block-per-iteration at the harness level (critical)

The system-prompt driver instruction is insufficient for Opus 4.6. The harness (`src/rlm.ts`) should extract only the **first** complete code block from each response and discard subsequent blocks. This would:
- Force the model into the REPL feedback loop
- Prevent hallucinated intermediate outputs
- Make iteration count meaningful again

Implementation: In `extractCodeBlocks()`, return only `[blocks[0]]` instead of all blocks. Or add an option `maxBlocksPerIteration: 1` to the RLM config.

### 2. Increase max_tokens for Opus (high)

The 4096 default is too low for Opus 4.6's verbose output style. Even with one-block enforcement, the model needs tokens for reasoning + one code block. Recommend 8192 for Opus, keeping 4096 for Sonnet/Flash.

### 3. Handle finish=length in the harness (medium)

When the response is truncated (`finish_reason=length`), the harness should:
- Log a warning visible in the trace
- Consider sending a continuation prompt: "Your response was truncated. Write one code block to continue."
- At minimum, extract and execute any complete code blocks from the partial response (this already works, but the truncation should be surfaced)

### 4. Conditional early-return guard (low)

The iteration-0 return guard should be reviewed. Options:
- Remove it when `deadline-return` driver is loaded (the driver handles pacing)
- Allow return on iteration 0 if the response contains N+ complete code blocks
- Log the intercepted value so the trace shows what would have been returned

## Summary

Run 005 reveals a fundamental interaction-model mismatch between Opus 4.6 and the RLM harness. Opus treats each LLM response as an extended reasoning session, writing multiple code blocks with hallucinated intermediate states. The harness expects a REPL dialogue with one block per response.

The model's raw analytical capability is strong -- it identified the 8-region structure faster than Sonnet in any previous run. But this capability is wasted when the model cannot receive real execution feedback between reasoning steps. The fix is straightforward: enforce one code block per iteration at the harness level, not just via a system-prompt instruction that the model ignores.
