# Opus 4.6 Trajectory Analysis: Patterns, Mistakes, and Recommendations

Analysis of Opus 4.6 ARC-solving trajectories (run-004, run-005) compared to Sonnet 4.5 baselines (run-002, run-003), with concrete recommendations for improving ARC scores.

---

## 1. Most Promising Patterns from Opus

### 1a. Dramatically faster rule identification

Opus identifies the correct transformation rule in fewer iterations than Sonnet across both tasks:

| Task | Metric | Sonnet Best | Opus | Speedup |
|------|--------|-------------|------|---------|
| arc-0934a4d8 | Found 8-rectangle | iter 2 (run-002) | iter 2 (run-004) | Comparable |
| arc-0934a4d8 | Found col/row-mirror reconstruction | iter 21 (run-002) | iter 3 (run-004) | ~7x |
| arc-135a2760 | Found repeating tile rule | iter 3 (run-002) | iter 2 (run-004) | ~1.5x |
| arc-135a2760 | Implemented majority-vote tile finder | iter 11 (run-002) | iter 3 (run-004) | ~3.7x |

**Specific example (run-004, arc-0934a4d8, iter 3):** Opus tested three reconstruction strategies in a single iteration (col-mirror, row-mirror, both-mirror), determined which works for which training example, and identified the mirror-region-overlap selection criterion -- analysis that took Sonnet 24 iterations (iter 21-45 in run-002).

### 1b. Superior analytical technique: simultaneous hypothesis testing

Opus writes code that tests multiple hypotheses within a single code block rather than testing one per iteration. In run-004 arc-0934a4d8 iter 3:

```javascript
// Tests col-mirror, row-mirror, and both-mirror for ALL 4 training examples
// in a single block, then checks which mirror source contains 8s
// to determine the selection rule
```

This "batch analysis" approach is intellectually more efficient than Sonnet's sequential approach. The issue is that Opus batches this across multiple code blocks in a single response rather than in a single code block.

### 1c. Best-ever cell accuracy on arc-135a2760

Run-004's answer achieved 98.9% cell accuracy (832/841 cells correct). Comparison:

| Run | Model | Cell Accuracy | Mismatches |
|-----|-------|--------------|------------|
| run-002 | Sonnet 4.5 | ~83.9% | ~135 cells |
| run-003 | Sonnet 4.5 | N/A (no return) | N/A |
| run-004 | Opus 4.6 | **98.9%** | 9 cells |

The 9 mismatches are attributable to a single algorithmic bug (tile period selection too permissive) that Opus identified but could not fix before deadline.

### 1d. Sound algorithm design: majority-vote tile reconstruction

Opus's `findBest2DTile` function is a well-designed approach: for each candidate tile period, build the tile by majority-voting across all repetitions, count mismatches, select the lowest-mismatch period. This naturally handles sparse corruption (1-3 errors per 25+ row panel). Sonnet independently arrived at a similar approach but took 7 iterations debugging string-vs-number bugs; Opus's implementation was cleaner from the start.

### 1e. Structural analysis depth

For arc-0934a4d8, Opus discovered the full structure within 3 iterations:
- The grid has dual mirror symmetry: `row[r] == row[29-r]` and `col[c] == col[29-c]`
- The 8-rectangle masks original content
- Reconstruction uses col-mirror for some examples, row-mirror for others
- The selection criterion depends on whether the mirror-source region also contains 8s

Sonnet (run-002) took 45 iterations to reach a comparable (but slightly different) understanding: column-reversal with offset-2 plus a vertical-reflection branch. Sonnet's formulation was arguably less clean (it required an ad-hoc offset parameter), while Opus's col-mirror/row-mirror formulation is more principled.

### 1f. Self-correction capability

In run-005 iter 2, after hallucinating a 3x3 "replace 0 with 2" task in iter 1, Opus self-corrected immediately upon seeing the real execution output:

```
Iteration 7 of 30. Remaining: 23.
Status: exploring - my initial hypothesis was completely wrong. Need to understand the task properly.
```

This is the first time any model showed explicit budget awareness language in its reasoning text. While the multi-block violation undermined this capability, the raw self-monitoring instinct is present.

---

## 2. Mistakes Opus Makes

### 2a. Multi-block violation (critical, both runs)

**Pattern:** Opus writes 6-9 code blocks per response, treating each LLM response as a full problem-solving session rather than a single REPL step.

**Evidence:**
- run-004 arc-0934a4d8: 8+ blocks per response across all 3 iterations
- run-004 arc-135a2760: 7, 5, 4, 3 blocks across 4 iterations (only iter 4 finished normally)
- run-005 arc-0934a4d8: 6 blocks in response 1, 8+ in response 2

**Impact:**
- Consumes entire output token budget per response, causing truncation
- Prevents the model from receiving real execution feedback between reasoning steps
- Effectively reduces 30 available iterations to 2-4 actual harness iterations
- run-005 used **2 of 30 iterations** because the model crammed 15 "iterations" into 2 responses

**Contrast with Sonnet:** Sonnet 4.5 showed 100% compliance with one-block-per-iteration across runs 002 and 003 (50 + 15 iterations, every single one had exactly 1 code block).

### 2b. Hallucinated-task incident (run-005, response 1)

**What happened:** In run-005, Opus wrote 6 code blocks in response 1. Blocks 0-2 ran correctly against the real data (revealing 30x30 grids), but Opus had already committed to blocks 3-6 based on a fabricated task:

```javascript
// Train 0: 3x3 -> 3x3
// Input:
// 4 4 4
// 4 0 0
// 4 0 0
// Pattern is very clear: replace all 0s with 2s
```

The real task has 30x30 inputs with 8-colored corruption regions. The model fabricated intermediate outputs between code blocks rather than waiting for actual execution results.

**Root cause:** When writing multiple code blocks in a single response, the model must predict what earlier blocks will output. For early exploration blocks that parse unknown task data, these predictions are necessarily hallucinated. The model ran a mental simulation of the REPL that diverged from reality after block 0.

**This failure mode is unique to Opus** and has not been observed in any Sonnet run. It is a direct consequence of the multi-block violation.

### 2c. Output truncation consequences

Every Opus response in run-004 hit `finish=length` (output token cap at 4096 default `max_tokens`), except the final deadline-return iteration of arc-135a2760.

**Specific consequences:**

1. **arc-0934a4d8, iter 3:** Truncated mid-analysis while determining the mirror selection rule. The model had identified that col-mirror works for Train 0,2 and row-mirror for Train 1,3, and was writing code to determine which to use for the test input. This was the final step before a complete solution. The truncation caused a timeout (208s wall time, no more iterations possible).

2. **arc-135a2760, iter 3:** Truncated during training validation. The model had identified the tile-period-selection bug (period=24 memorizes corrupted input) but could not implement the fix. It returned a best-effort answer in iter 4 with 9 mismatches.

3. **run-005, response 2:** Truncated at 10,191 chars while Opus was testing multi-axis symmetry hypotheses. The incomplete code block produced a `ReferenceError`, and the subsequent timeout left 28 unused iterations.

**The truncation problem is self-reinforcing:** because Opus writes multiple blocks per response, each response is enormous, which means each response gets truncated, which means the model gets fewer real iterations, which pressures it to write even more per response.

### 2d. Tile-period selection bug (run-004, arc-135a2760)

The `findBest2DTile` function accepted any tile period with fewer errors than the current best, without preferring smaller periods:

```javascript
if (errors < bestErrors) {
  bestErrors = errors;
  bestTile = tile;
}
```

For a 25-row panel, period 24 or 25 trivially achieves 0 errors by memorizing the entire input (including corruptions). The correct approach: prefer the smallest period with low errors, or cap max period at `content_length / 3`.

**Opus identified this bug** during iter 3 validation against Train 1 but was truncated before fixing it. The bug caused 9 of 841 cells to be wrong in the final answer.

### 2e. No delegation despite available depth

Zero `rlm()` or `llm()` calls across both tasks in run-004, and zero in run-005. Despite `maxDepth=2` (run-004) and `maxDepth=1` (run-005) being available, and the arc-solver v0.2.0 protocol explicitly calling for delegation, Opus never delegated.

**Why:** Opus's multi-block style leaves no room for delegation. By the time it would write an `rlm()` call, it has already explored, hypothesized, AND implemented the solution within the same response. The model treats each response as a self-contained problem-solving session, not as a step in a multi-agent workflow.

**Contrast with Sonnet:** Run-003 (Sonnet) successfully delegated 3 parallel children per task, with `Promise.all`, HELPER_LIBRARY passing, and structured `{score, code}` returns from children. The delegation protocol works mechanically with Sonnet but Opus never even attempts it.

### 2f. Early-return guard interaction (run-005)

In run-005 response 1, Opus called `return()` within its 6th code block (which it labeled "iteration 6" internally). The harness saw this as iteration 0 and intercepted it:

```
[early return intercepted] You returned: [[4,4,1,3,5,7,7,9,...]]
Verify this is correct by examining the data before returning.
```

The returned value was wrong (based on the hallucinated "replace 0 with 2" task), so the guard was correct to intercept. But this highlights a design tension: Opus thinks it has done 6 iterations of work; the harness thinks it is iteration 0.

### 2g. `process.stdout.write()` usage (run-005)

One code block in run-005 response 2 used `process.stdout.write()`, which is not available in the sandboxed JS environment. This produced a `ReferenceError: process is not defined`. The model should use `console.log()` exclusively.

---

## 3. Concrete Recommendations

### 3a. HARNESS: Enforce single-block extraction in `extractCodeBlocks`

**What to change:** `/Users/sl/code/trinity/node-rlm/src/rlm.ts`, the code block execution loop (lines 310-382).

Add an option to limit code blocks per iteration and apply it when configured:

```typescript
// After line 310: let codeBlocks = extractCodeBlocks(response);
// Add:
if (opts.maxBlocksPerIteration) {
  codeBlocks = codeBlocks.slice(0, opts.maxBlocksPerIteration);
}
```

Add `maxBlocksPerIteration?: number` to the `RlmOptions` interface.

**Why:** The `one-block-per-iteration` driver is a system-prompt instruction that Opus 4.6 ignores completely (0% compliance across 2 runs, 7 iterations). Sonnet 4.5 complies (100% across 2 runs, 65 iterations). Harness enforcement is necessary for Opus.

**Evidence:**
- run-005 arc-0934a4d8: 2 of 30 iterations used because 15 self-narrated "iterations" were crammed into 2 responses
- run-004 arc-0934a4d8: 3 iterations used, each truncated, model never completed analysis
- run-004 arc-135a2760: 4 iterations used, iter 3 truncated during bug diagnosis

**Expected impact:** HIGH. With single-block enforcement and 30 iterations available, Opus would have 30 real REPL interactions. Based on run-004 trajectory analysis, Opus reaches the correct rule structure within 3 conceptual steps (per-iteration). With 30 iterations and real feedback, it would likely solve both tasks.

**Effort:** LOW. ~5 lines of code change in `rlm.ts`, plus adding the option to the interface and passing it from the eval config.

### 3b. HARNESS: Increase `max_tokens` for Opus

**What to change:** `/Users/sl/code/trinity/node-rlm/src/drivers/openrouter-compatible.ts`, line 46:

```typescript
const DEFAULT_MAX_TOKENS = 4096;
```

This should be configurable per-model rather than a global default. The eval harness should pass `maxTokens: 8192` (or higher) when using Opus.

Alternatively, the `fromOpenRouterCompatible` function already accepts a `maxTokens` option -- ensure the eval config passes a higher value for Opus models.

**Why:** Every Opus response in run-004 hit `finish=length`. Even with single-block enforcement, Opus's reasoning is more verbose than Sonnet's. A single Opus code block with surrounding reasoning could easily exceed 4096 tokens.

**Evidence:**
- run-004: 6/7 iterations hit `finish=length`; only the deadline-return iteration (short, focused) completed normally
- run-005: both responses hit `finish=length` at ~10K characters each
- Opus output averages ~10K chars per response vs Sonnet's ~2K chars per response

**Expected impact:** MEDIUM-HIGH. Even with single-block enforcement, 4096 tokens may truncate Opus's reasoning. 8192 gives comfortable headroom for one code block plus reasoning.

**Effort:** LOW. Configuration change only; the code already supports `maxTokens` as an option.

### 3c. HARNESS: Handle `finish_reason=length` explicitly

**What to change:** `/Users/sl/code/trinity/node-rlm/src/drivers/openrouter-compatible.ts` -- the `CallLLM` return type must surface the finish_reason, OR the driver should handle it internally.

Option A (preferred): Return `finish_reason` alongside content so `rlm.ts` can react:

```typescript
// Change CallLLM type to:
export type CallLLM = (
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string
) => Promise<{ content: string; finishReason?: string }>;
```

Then in `rlm.ts`, when `finishReason === "length"`:
1. Log a warning in the trace
2. Extract and execute any complete code blocks from the truncated response
3. Append to the output message: `"[WARNING] Your response was truncated by the output token limit. Write one code block to continue your analysis."`

Option B (simpler): In the driver, detect `finish_reason=length` and append a truncation notice to the content string before returning:

```typescript
if (choice.finish_reason === "length") {
  return content + "\n\n[TRUNCATED: response hit output token limit]";
}
```

**Why:** Currently the harness treats truncated responses identically to complete ones. The model does not know its response was cut off. When Opus's multi-block response is truncated mid-code-block, the harness extracts the complete blocks and ignores the partial one, but the model has no signal that it was interrupted.

**Evidence:**
- run-004 arc-0934a4d8 iter 3: truncated while determining mirror selection rule; model was 1-2 steps from solution
- run-005 response 2: truncated mid-code `console.log("\nCorresponding values` -- produced a ReferenceError from the partial block

**Expected impact:** MEDIUM. With single-block enforcement, truncation becomes less frequent. But for verbose tasks or early exploration phases, the model still benefits from knowing it was cut off.

**Effort:** MEDIUM. Requires changing the `CallLLM` type signature (Option A) or adding a simple append (Option B). Option B is low effort.

### 3d. ARC-SOLVER: Add Opus-specific pacing instructions

**What to change:** `/Users/sl/code/trinity/node-rlm/plugins/apps/arc-solver.md`

Add a section after "Critical rules" that addresses Opus's specific failure modes:

```markdown
### Pacing for high-capability models

If you are a high-capability model (Opus-class), you may be tempted to solve the
entire problem in a single response with multiple code blocks. DO NOT DO THIS.

**Why single-block matters for you specifically:**
- You cannot predict what your code will output before it runs
- When you write blocks 2-6 based on predicted output from block 1, you are
  hallucinating intermediate states
- Your response will be truncated by the output token limit, cutting off your
  analysis before it completes
- You waste iteration budget: 6 blocks in 1 response = 1 harness iteration,
  not 6

**Instead:**
- Write ONE code block per response
- Wait for real output before planning your next step
- Use your superior reasoning to write BETTER code per block, not MORE blocks
- If you can test 3 hypotheses in one well-designed code block, do that --
  but as ONE block, not three
```

**Why:** The current `one-block-per-iteration` driver is generic. Opus needs to understand WHY single-block matters, not just that it is required. The hallucinated-task incident (run-005) and the truncation cascades (run-004) are both caused by multi-block writing.

**Evidence:**
- run-005: Opus hallucinated a 3x3 task because it wrote blocks 3-6 before seeing block 0's output
- run-004: Every response truncated because 7-9 blocks consumed the entire token budget

**Expected impact:** MEDIUM. Opus may still ignore prompt instructions (it ignored the existing driver). But combined with harness enforcement (3a), the prompt gives the model a mental model for WHY it should comply. Even partial compliance (2-3 blocks instead of 8) would help.

**Effort:** LOW. Text addition to existing plugin.

### 3e. ARC-SOLVER: Add explicit delegation trigger for Opus

**What to change:** `/Users/sl/code/trinity/node-rlm/plugins/apps/arc-solver.md`

Modify the iteration plan to explicitly call out when delegation should happen:

```markdown
**Iter 3 — Delegation checkpoint.** If maxDepth > 1, you MUST delegate at this
iteration. Do not skip this step. Write a single code block containing ONLY your
rlm() calls:

```javascript
// This is your ENTIRE code block for this iteration.
// No exploration code. No analysis. Just delegation.
const results = await Promise.all([
  rlm("Test hypothesis 1", context, { model: "fast", systemPrompt: `...` }),
  rlm("Test hypothesis 2", context, { model: "fast", systemPrompt: `...` }),
  rlm("Test hypothesis 3", context, { model: "fast", systemPrompt: `...` }),
]);
console.log("Results:", JSON.stringify(results));
```
```

**Why:** Opus never delegates because its multi-block style fills the response before a delegation call appears. By making delegation a mandatory step at a specific iteration, and by specifying that the code block should contain ONLY delegation calls, we prevent Opus from "crowding out" delegation with solo analysis.

**Evidence:** run-004: zero delegation calls despite `maxDepth=2` and the arc-solver protocol explicitly calling for it. The analysis shows Opus could have parallelized symmetry hypothesis testing (arc-0934a4d8) or per-panel tile finding (arc-135a2760).

**Expected impact:** MEDIUM. Delegation is not always better (Sonnet's run-003 delegation was net-negative), but it helps when the strategist has good hypotheses. Opus's fast hypothesis generation means it will have better hypotheses to delegate than Sonnet did.

**Effort:** LOW. Text modification to existing plugin.

### 3f. DRIVER: Strengthen `one-block-per-iteration` for Opus

**What to change:** `/Users/sl/code/trinity/node-rlm/plugins/drivers/one-block-per-iteration.md`

Rewrite to be more forceful and explain the consequences:

```markdown
## One Block Per Iteration (MANDATORY)

STOP. Read this carefully. This is the single most important rule.

Each response must contain **exactly one** ```javascript code block.

### Why this is non-negotiable

When you write multiple code blocks in a single response:
1. You CANNOT see the output of block 1 before writing block 2
2. Any "expected output" you write between blocks is a HALLUCINATION
3. Your response WILL be truncated by the output token limit
4. The harness will ONLY execute the first block and DISCARD the rest
5. You just wasted your reasoning budget on code that will never run

### What to do instead

- Write ONE block that does ONE step
- End your response after the code block
- Wait for the real output
- Plan your next step based on REAL data, not predictions

### The test

Before writing a second code block, ask yourself:
"Am I predicting what the first block will output?"
If yes, STOP. You are about to hallucinate.
```

Note line 4: "The harness will ONLY execute the first block and DISCARD the rest" -- this should be written in tandem with implementing recommendation 3a (harness enforcement). The driver instruction and harness behavior should match.

**Why:** The current driver text is 6 lines and reads as a suggestion. Opus treats suggestions as optional. The rewrite frames single-block as a hard constraint with explanations tailored to Opus's specific failure modes.

**Evidence:** run-005 trajectory analysis explicitly identifies the root cause as "multi-block-violation causing self-hallucination."

**Expected impact:** LOW-MEDIUM (prompt instructions alone have 0% compliance with Opus; this is insurance for partial compliance). Combined with 3a (harness enforcement), this becomes HIGH.

**Effort:** LOW. Text rewrite of existing driver.

### 3g. DRIVER: Add tile-period cap to `arc-helper-library`

**What to change:** `/Users/sl/code/trinity/node-rlm/plugins/drivers/arc-helper-library.md`

Modify the `findRepeatingTile` function to cap the maximum period:

```javascript
function findRepeatingTile(seq, minLen = 2, maxLen) {
  const n = seq.length;
  maxLen = maxLen || Math.floor(n / 3);  // default: max 1/3 of sequence length
  let bestTile = null, bestErrors = Infinity;
  for (let len = minLen; len <= Math.min(maxLen, Math.floor(n / 2)); len++) {
    // ... rest unchanged ...
  }
  return { tile: bestTile, errors: bestErrors };
}
```

Also add a `findRepeating2DTile` function:

```javascript
function findRepeating2DTile(grid, maxVP, maxHP) {
  // Find 2D repeating tile with vertical period vp and horizontal period hp
  // using majority voting, capped at maxVP rows and maxHP cols
  const H = grid.length, W = grid[0].length;
  maxVP = maxVP || Math.floor(H / 3);
  maxHP = maxHP || Math.floor(W / 3);
  let bestTile = null, bestErrors = Infinity, bestVP = 0, bestHP = 0;
  for (let vp = 1; vp <= maxVP; vp++) {
    for (let hp = 1; hp <= maxHP; hp++) {
      const tile = gridNew(vp, hp, 0);
      // Vote for each cell
      for (let tr = 0; tr < vp; tr++) {
        for (let tc = 0; tc < hp; tc++) {
          const votes = {};
          for (let r = tr; r < H; r += vp) {
            for (let c = tc; c < W; c += hp) {
              votes[grid[r][c]] = (votes[grid[r][c]] || 0) + 1;
            }
          }
          tile[tr][tc] = +Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
        }
      }
      // Count errors
      let errors = 0;
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          if (grid[r][c] !== tile[r % vp][c % hp]) errors++;
        }
      }
      if (errors < bestErrors || (errors === bestErrors && vp * hp < bestVP * bestHP)) {
        bestErrors = errors; bestTile = tile; bestVP = vp; bestHP = hp;
      }
      if (errors === 0) break;
    }
    if (bestErrors === 0) break;
  }
  return { tile: bestTile, errors: bestErrors, vp: bestVP, hp: bestHP };
}
```

**Why:** Opus's tile-period selection bug in run-004 arc-135a2760 was the direct cause of the 9-cell mismatch. The `findRepeatingTile` function in the helper library has the same issue: it prefers any period with fewer errors than the current best, without penalizing large periods. A period equal to the sequence length always achieves 0 errors by memorizing the input.

**Evidence:** run-004 arc-135a2760 iter 3 analysis: "The tile-period-selection bug existed regardless of truncation... period 24 or 25 trivially achieves 0 errors by memorizing the entire input."

**Expected impact:** MEDIUM. This fixes the specific bug that caused the 9-cell mismatch and would also help on future tiling tasks. The `maxLen` default of `n/3` ensures at least 3 repetitions, which is the minimum for meaningful majority voting.

**Effort:** LOW. Code addition to existing driver.

### 3h. HYPERPARAMETER: Model-specific configuration

**Recommended settings for Opus 4.6:**

| Parameter | Current | Recommended | Rationale |
|-----------|---------|-------------|-----------|
| `maxIterations` | 15-30 | 30 | With single-block enforcement, Opus needs real iterations |
| `maxDepth` | 1-2 | 2 | Enable delegation, but enforce it via arc-solver protocol |
| `max_tokens` (output) | 4096 | 8192 | Opus reasoning is 2-5x more verbose than Sonnet |
| `maxBlocksPerIteration` | N/A (new) | 1 | Enforce single-block at harness level |
| `timeoutMs` (per call) | 60000 | 90000 | Opus responses take longer to generate |

**Recommended settings for Sonnet 4.5:**

| Parameter | Current | Recommended | Rationale |
|-----------|---------|-------------|-----------|
| `maxIterations` | 15-50 | 25 | Sonnet needs more iterations but is cheaper |
| `maxDepth` | 1-2 | 2 | Delegation works mechanically with Sonnet |
| `max_tokens` (output) | 4096 | 4096 | Sufficient for 1-block responses |
| `maxBlocksPerIteration` | N/A (new) | undefined (no limit) | Sonnet already complies |

### 3i. HARNESS: Make early-return guard conditional

**What to change:** `/Users/sl/code/trinity/node-rlm/src/rlm.ts`, lines 371-376.

Current code:
```typescript
if (returnValue !== undefined) {
  if (iteration === 0) {
    // Force verification: reject first-iteration returns
    combinedOutput +=
      (combinedOutput ? "\n" : "") +
      `[early return intercepted] You returned: ${String(returnValue)}\nVerify this is correct by examining the data before returning.`;
    break;
  }
```

Proposed change: make the guard configurable, and never apply it when `deadline-return` is loaded (since that driver already handles pacing):

```typescript
if (returnValue !== undefined) {
  if (iteration === 0 && opts.earlyReturnGuard !== false) {
    // Force verification: reject first-iteration returns
    combinedOutput +=
      (combinedOutput ? "\n" : "") +
      `[early return intercepted] You returned: ${JSON.stringify(returnValue).slice(0, 200)}\nVerify this is correct by examining the data before returning.`;
    break;
  }
```

Also note: the intercepted value should use `JSON.stringify` (not `String()`) and be truncated to avoid flooding the context.

**Why:** In run-005, Opus's `return()` on iteration 0 was based on a hallucinated task and was correctly intercepted. However, the interaction between the early-return guard and multi-block responses creates a paradox: the model wrote 6 "iterations" of work but the harness sees iteration 0. With single-block enforcement (3a), this paradox disappears because the model genuinely is at iteration 0 with only 1 block of work done, and the guard is appropriate.

**Evidence:** run-005: `return()` blocked by iter-0 guard, wasting the (wrong) answer and its enclosing response. The guard message uses `String(returnValue)` which would flatten a 2D array.

**Expected impact:** LOW. With single-block enforcement, this guard correctly prevents snap answers. The `JSON.stringify` fix is a minor quality improvement.

**Effort:** LOW. Small code change.

### 3j. ARCHITECTURAL: Dense-feedback mode for Opus

**New idea:** Instead of the standard iteration loop (model writes response -> harness extracts code -> executes -> returns output), implement a "dense feedback" mode for Opus:

1. Model writes response with potentially multiple code blocks
2. Harness extracts the FIRST code block only (as in 3a)
3. Executes it and gets real output
4. **Immediately** sends the output back as a continuation prompt WITHOUT counting it as a full iteration
5. Model writes next code block based on real output
6. Continue until model produces a response without a code block (pure reasoning), which counts as 1 iteration

This gives Opus the rapid fire-and-observe loop it wants while keeping real execution feedback between blocks. Each "iteration" in the budget corresponds to a reasoning phase, not a single code execution.

**Why:** Opus's fundamental desire is to execute a multi-step reasoning chain rapidly. The current architecture forces it to choose between (a) waiting for real feedback (1 block per response, uses iteration budget) or (b) hallucinating feedback (multi-block, wastes iterations). Dense-feedback gives it option (c): real feedback without burning iteration budget per code block.

**Evidence:** The trajectory data shows Opus writes 7-9 code blocks per response, each building on the prior. The "batch planning" pattern is intellectually sound -- the model just needs real feedback between blocks.

**Expected impact:** HIGH (potentially transformative for Opus). This would let Opus use its rapid multi-step reasoning style while maintaining real execution feedback.

**Effort:** HIGH. Requires significant changes to the iteration loop in `rlm.ts` and potentially to how context is managed.

### 3k. ARCHITECTURAL: Separate "reasoning tokens" from "output tokens"

**New idea:** Configure the API call to use a large `max_tokens` (e.g., 16384) but track the model's actual output for the purpose of iteration management. When the response exceeds a soft limit (e.g., 4096 tokens of actual code+reasoning), the harness processes what it has and sends a continuation.

This separates "how much the model can write" from "how much we process per iteration." The model gets room to think, but the harness still operates in manageable chunks.

**Why:** The 4096 `max_tokens` hard cap was calibrated for Sonnet. Opus needs more room even for single-block responses because its reasoning sections are more verbose.

**Evidence:** run-004 arc-135a2760 iter 4 (the only non-truncated response) was 7K chars -- well within 4096 tokens but that was a short deadline-return. Normal analytical responses would be 10K+ chars.

**Expected impact:** MEDIUM. Less impactful than 3j (dense feedback) but simpler to implement.

**Effort:** LOW-MEDIUM. Increase `max_tokens` and adjust soft limits in harness.

---

## 4. Priority Ranking

| # | Recommendation | Expected Impact | Effort | Priority Score |
|---|---------------|-----------------|--------|----------------|
| 1 | **3a. Enforce single-block extraction in harness** | HIGH | LOW | **CRITICAL** |
| 2 | **3b. Increase max_tokens for Opus to 8192** | MEDIUM-HIGH | LOW | **HIGH** |
| 3 | **3f. Strengthen one-block-per-iteration driver text** | LOW-MEDIUM (with 3a: HIGH) | LOW | **HIGH** (do together with 3a) |
| 4 | **3g. Add tile-period cap to helper library** | MEDIUM | LOW | **HIGH** |
| 5 | **3d. Add Opus-specific pacing to arc-solver** | MEDIUM | LOW | **MEDIUM-HIGH** |
| 6 | **3c. Handle finish_reason=length in harness** | MEDIUM | MEDIUM | **MEDIUM** |
| 7 | **3h. Model-specific hyperparameter configuration** | MEDIUM | LOW | **MEDIUM** |
| 8 | **3e. Add explicit delegation trigger for Opus** | MEDIUM | LOW | **MEDIUM** |
| 9 | **3i. Make early-return guard conditional + JSON.stringify fix** | LOW | LOW | **LOW-MEDIUM** |
| 10 | **3j. Dense-feedback mode (new architecture)** | HIGH | HIGH | **MEDIUM** (high-value but defer) |
| 11 | **3k. Separate reasoning vs output tokens** | MEDIUM | LOW-MEDIUM | **LOW-MEDIUM** |

### Recommended execution order

**Phase 1 (immediate, unblocks Opus):**
1. Implement 3a (single-block enforcement) -- the single most impactful change
2. Implement 3b (increase max_tokens to 8192 for Opus)
3. Update 3f (driver text) to match harness behavior
4. Re-run run-004 tasks with these changes

**Phase 2 (improve scoring):**
5. Implement 3g (tile-period cap in helper library)
6. Update 3d (Opus pacing instructions in arc-solver)
7. Implement 3c (finish_reason=length handling)
8. Re-run on expanded task set

**Phase 3 (architectural improvements):**
9. Implement 3h (model-specific config)
10. Implement 3e (delegation trigger)
11. Prototype 3j (dense-feedback mode)

---

## Appendix: Key Trajectory Evidence

### A1. Opus's insight density advantage

From run-004 arc-0934a4d8 iter 3, Opus tested THREE reconstruction strategies in one pass:

```
Results:
- Train 0: Column-mirror matches expected output
- Train 1: Row-mirror matches expected output
- Train 2: Column-mirror matches expected output
- Train 3: Row-mirror matches expected output
```

Sonnet (run-002) tested one strategy per iteration, taking iters 3-7 just for simple symmetry checks, and didn't reach the col-mirror/row-mirror formulation until iter 45.

### A2. Opus's self-correction in run-005

After seeing real output contradicting its hallucinated 3x3 task:

```
Iteration 7 of 30. Remaining: 23.
Status: exploring - my initial hypothesis was completely wrong.
The output is much smaller than input (30x30 -> small grid).
There's a rectangular region of 8s in each input.
```

This is genuine budget awareness + self-correction. It demonstrates Opus CAN track iteration state -- it just needs real feedback to trigger correction.

### A3. The 9-cell near miss (run-004 arc-135a2760)

The returned answer was 98.9% correct. All 9 mismatches trace to the tile-period selection bug:

| Category | Count | Cause |
|----------|-------|-------|
| Corruptions preserved (period too large) | 5 | Tile memorized corrupted input |
| Phase errors (wrong tile offset) | 4 | Tile start position shifted |

The `findRepeatingTile` with a `maxLen` cap (recommendation 3g) would have fixed all 9.

### A4. Sonnet's delegation success vs Opus's absence

Run-003 arc-135a2760 iter 2 (Sonnet):
```javascript
const results = await Promise.all([
  rlm("Implement and test...", context, { model: "fast", systemPrompt: `...H1...` }),
  rlm("Implement and test...", context, { model: "fast", systemPrompt: `...H2...` }),
  rlm("Implement and test...", context, { model: "fast", systemPrompt: `...H3...` }),
]);
// All 3 returned. All scored 0/2 (bad hypotheses), but the mechanism worked.
```

Run-004 (Opus): zero delegation calls across 7 iterations on 2 tasks. The multi-block style crowds out delegation entirely.

### A5. The String() serialization fix (already applied)

Line 378 of `rlm.ts` now reads:
```typescript
const answer = typeof returnValue === "object" ? JSON.stringify(returnValue) : String(returnValue);
```

This was identified in run-002 trajectory analysis and has been fixed. The fix is confirmed present in the current code.
