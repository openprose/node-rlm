# Run 001 — ARC-2 Compound Learning Initial Run

**Date:** 2026-02-16
**Status:** Killed mid-pass@2 (context spiral)
**Branch:** feat/arc3-benchmark
**Model:** anthropic/claude-opus-4-6 (via OpenRouter)
**Cost:** ~$30-40 estimated (64 Opus API calls + 6 Flash calls, killed before completion)

## Configuration

| Param | Value |
|---|---|
| benchmark | arc-compound |
| model | anthropic/claude-opus-4-6 |
| max-iterations | 100 |
| max-depth | 2 |
| trace-full | yes |
| selected-problems | 0934a4d8, 135a2760, 136b0064 |
| app | arc-compound-orchestrator |

## What Happened

The run was killed during pass@2 after retry solvers entered a `finish=length` truncation spiral.
No result file was saved (harness writes on completion). Analysis is from the API call log.

### Timeline (reconstructed from API call log)

| Phase | API Calls | Iters | Context Range | Model | Notes |
|---|---|---|---|---|---|
| Orchestrator setup | #1-#2 | 2 | 19k-23k | Opus | Library init, first task delegation |
| **Solver: task 1** (0934a4d8) | child #1-#18 | 18 | 10k→86k | Opus | Full 18-iter budget consumed |
| **Synth: task 1** | Flash #1-#2 | 2 | 13k→18k | **Gemini Flash** | Orchestrator chose `model: "fast"` |
| Orchestrator | #3 | 1 | 25k | Opus | Read results, advance to task 2 |
| **Solver: task 2** (135a2760) | child #19-#34 | 16 | 10k→63k | Opus | 16 iterations |
| **Synth: task 2** | Flash #3-#4 | 2 | 13k→17k | **Gemini Flash** | Same pattern |
| Orchestrator | #4 | 1 | 27k | Opus | Advance to task 3 |
| **Solver: task 3** (136b0064) | child #35-#49 | 15 | 10k→66k | Opus | 15 iterations |
| **Synth: task 3** | Flash #5-#6 | 2 | 13k→18k | **Gemini Flash** | Same pattern |
| Orchestrator | #5-#6 | 2 | 29k→30k | Opus | Pass@1 complete, start pass@2 |
| **Retry solver 1** | child #50-#60 | 11 | 11k→120k | Opus | **5 of 11 calls truncated** |
| Orchestrator | #7-#8 | 2 | 33k→35k | Opus | Advance to retry 2 |
| **Retry solver 2** | child #61-#64 | 4+ | 11k→148k | Opus | **All 4 calls truncated. KILLED.** |

### Total API calls: 70 (64 Opus + 6 Gemini Flash)

## Key Findings

### 1. Pass@1 Architecture Works

The three-phase cycle (solver → synthesizer → advance) executed cleanly for all 3 tasks:
- Solvers used 15-18 iterations each (near the 18-iter budget)
- Synthesizers completed in 2 iterations (well under the 10-iter budget)
- Orchestrator used 1-2 iterations per task transition
- Total pass@1: ~55 API calls across 3 tasks

**Verdict:** The orchestrator correctly follows the plugin's control flow. Delegation, submission, and state advancement all worked.

### 2. `finish=length` Truncation Spiral in Pass@2

The dominant failure mode. During retries, the solver generates massive code blocks (10-12k chars output) that hit the max_tokens limit:

```
#52: 11379c output, finish=length
#53: 10962c output, finish=length  (context: 40k → 57k)
#54: 11105c output, finish=length  (context: 57k → 68k)
#55: 11738c output, finish=length  (context: 68k → 81k)
#56: 11045c output, finish=length  (context: 81k → 94k)
```

**Root cause:** On pass@2, the solver has the full accumulated library from pass@1. It appears to write comprehensive code that incorporates all accumulated knowledge in a single code block. This produces output that exceeds the max_tokens limit (~4k tokens ≈ ~11k chars). The truncated code creates syntax errors, the error output is appended to context, and the model tries again with even more context.

**Impact:** The first retry used 11 iterations and consumed ~90k of context on mostly truncated code. The second retry was killed after 4 iterations at 148k context — all truncated.

### 3. Model Autonomously Chose Gemini Flash for Synthesis

The orchestrator plugin code templates don't specify a model for the synthesizer:
```javascript
await rlm("Synthesize learnings...", undefined, { app: "arc-compound-synthesizer", maxIterations: 10 });
```

But the model rewrote this to use `model: "fast"` (Gemini Flash), indicating it made an autonomous cost-efficiency decision. This happened consistently for all 3 synthesis phases.

**Observation:** This is interesting emergent behavior but conflicts with the "Opus at every depth" test goal. The synthesizer may underperform on Flash vs Opus for complex pattern extraction.

### 4. Solver Context Growth Pattern

Pass@1 solvers follow a healthy growth pattern:
- Start: ~10k chars (system prompt + app plugin + globalDocs)
- Growth: ~3-4k per iteration (reasoning + code + output)
- End: 63-86k after 15-18 iterations

This is within normal Opus context limits. No truncation occurred during pass@1.

### 5. We Don't Know Pass@1 Accuracy

The run was killed before results were written. We don't know:
- How many of the 3 tasks were correctly solved on pass@1
- What the submission log shows
- Whether the library accumulated useful knowledge

**Next time:** The harness should write incremental results after each task, not just at the end.

## Recommendations for v0.3.0 Plugins

### P0: Fix `finish=length` truncation spiral

Two complementary approaches:

**A. Increase max_tokens for OpenRouter.** The harness or driver should set a higher `max_tokens` parameter (e.g., 16384 tokens) to avoid truncation. Check if OpenRouter passes this through.

**B. Add a "one-block-per-iteration" instruction to the solver plugin.** The existing `one-block-per-iteration` driver enforces this at the prompt level. Either:
- Apply it as a driver for arc-compound runs
- Or add to the solver plugin's Critical Rules: "Keep each code block under 100 lines. Break large explorations into multiple iterations."

**C. Add truncation detection to the harness.** If `finish=length`, the harness could inject a warning message: "Your last output was truncated. Write shorter code blocks." This exists as a driver pattern already (`one-block-per-iteration`).

### P1: Prevent autonomous model selection for synthesis

Either:
- Have the orchestrator plugin explicitly set `model: undefined` (inherit parent) in the rlm() call
- Or document in the plugin: "Do NOT override the model. Use the inherited model for all delegations."
- Or accept this as useful cost optimization and test whether Flash synthesis is adequate

### P2: Consider reducing solver budget on retries

On pass@2, the solver has the full library. It shouldn't need 18 iterations again. Consider:
- `maxIterations: 12` for retries (the plugin code shows 18)
- Or add to the retry prompt: "You have the full library. Use it efficiently."

### P3: Incremental result saves

The harness should save partial results after each task completion, not just at the end. This way:
- Killed runs still produce analyzable data
- We can see pass@1 accuracy before pass@2 starts

## Raw API Call Log

See `run-001-api-log.txt` in this directory.
