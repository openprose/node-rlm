# Analysis 002: ARC-AGI-2 Benchmark

Evaluation of RLM agent performance on ARC-AGI-2 abstract reasoning tasks.

## Runs

| Run | Model | Iters | Plugins | Tasks | Score | Key Finding |
| --- | ----- | ----- | ------- | ----- | ----- | ----------- |
| [001](run-001/) | Sonnet 4.5 | 25 | None | 5 | 0/5 | return() problem: 4/5 timeout |
| [002](run-002/) | Sonnet 4.5 | 50 | arc-solver + 5 drivers | 2 | 0/2 | Drivers loaded but ignored; harness String() bug |
| [003](run-003/) | Sonnet 4.5 | 15 | arc-solver v0.2.0 (recursive) | 2 | 0/2 | First successful delegation; net-negative due to budget + alias bug |
| [005](run-005/) | Opus 4.6 | 30 | arc-solver v0.2.0 + 2 drivers (linear) | 1 | 0/1 | Multi-block violation: 2 of 30 iters used; Opus ignores one-block-per-iteration |
| [006](run-006/) | Opus 4.6 | 15 | arc-solver v0.2.0 + single-block enforcement + maxTokens=8192 | 2 | **1/2** | **FIRST PERFECT SCORE** on arc-0934a4d8; arc-135a2760 API timeout (209s > 120s limit) |

## Cross-Run Findings

### BREAKTHROUGH: First perfect score (run-006)
Run-006 achieved score=1 on arc-0934a4d8 — the first perfect score across 6 runs and 12+ task attempts. The enabling changes:
1. **Single-block enforcement (harness-level):** `maxBlocksPerIteration=1` in `src/rlm.ts` extracts only the first code block per response. This gave Opus 15 proper REPL turns instead of 2 bloated responses (run-005).
2. **Increased max_tokens (8192):** Prevented finish=length truncation that killed every run-004/005 response.
3. **Increased API timeout (120s):** Gave Opus time to generate full responses.

The model's approach was elegant: systematic exploration of grid structure → discovery of 180° rotational symmetry → verification on all 4 training examples → application to test input → correct return with JSON.stringify. Single-block enforcement was the decisive factor — it transformed Opus from a model that couldn't complete a single iteration (run-005) into one that could sustain a 15-iteration problem-solving dialogue.

### The delegation architecture works mechanically but not strategically
Run 003 is the first test of recursive delegation (`maxDepth=2`, `arc-solver` v0.2.0). The machinery functioned: child RLMs were spawned via `rlm()`, received HELPER_LIBRARY in system prompts, ran their own REPL loops, tested hypotheses against training data, and returned structured `{score, code}` results. `Promise.all` for parallel hypothesis testing worked on arc-135a2760 (3 children, all returned).

However, delegation was **net-negative on both tasks:**
- arc-0934a4d8: orchestrator alias bug crashed the first batch; fast children scored 0/4
- arc-135a2760: all 3 fast children scored 0/2; delegation added 2 iterations of overhead, pushing the solution past the budget boundary

**Root cause:** The strategist delegated generic hypotheses before completing structural analysis. Children need to know about frame structure, color roles, and grid organization -- not just "try tiling." The arc-solver protocol's explore-then-delegate sequence is correct but the exploration phase needs to produce deeper structural insights.

### The driver compliance problem
Run 002 loaded 17K chars of driver instructions (deadline-return, verify-all-examples, hypothesis-budget, arc-helper-library, one-block-per-iteration) plus the arc-solver app. The model showed **zero evidence of following any driver protocol** except one-block-per-iteration. No scoreboards, no hypothesis tracking, no deadline awareness, no helper library usage.

Run 003 showed improvement: the model passed HELPER_LIBRARY to children (first time), generated numbered hypotheses (first time), and showed faint budget awareness ("entering deadline mode soon" at iter 9 of arc-0934a4d8). But it still never produced formal HYPOTHESIS COMPARISON blocks, never delegated refinement, and never called return().

Run 005 (Opus 4.6) showed **regression** on driver compliance: even one-block-per-iteration (which Sonnet obeyed) was completely ignored. Opus wrote 6 and 8+ code blocks per response, treating the response as an extended reasoning scratchpad rather than a single REPL step. The deadline-return driver's "Iteration X of N" format was present but narrated within a single response covering multiple self-hallucinated iterations.

### New: Multi-block violation as a model-specific failure mode
Run 005 reveals that one-block-per-iteration compliance is **model-dependent**: Sonnet 4.5 respects it, Opus 4.6 does not. This means the driver must be enforced at the harness level (extract only the first code block per response) rather than relying on system-prompt instructions. Without harness enforcement, Opus 4.6 hallucinated intermediate outputs between code blocks, producing a completely fictional task understanding.

### The return() problem: improving (6 runs, 12 tasks, 2 returns)
| Run | Task | Best Score | Returned? |
|-----|------|-----------|-----------|
| 001 | arc-0934a4d8 | Unknown | No |
| 001 | arc-135a2760 | Unknown | No |
| 002 | arc-0934a4d8 | 3/4 (iter 45) | No |
| 002 | arc-135a2760 | 2/2 (iter 11) | Yes (format destroyed by String() bug) |
| 003 | arc-0934a4d8 | 0/4 | No |
| 003 | arc-135a2760 | 2/2 (iter 13) | No (budget exhausted) |
| 005 | arc-0934a4d8 | N/A | Blocked by iter-0 guard |
| **006** | **arc-0934a4d8** | **4/4** | **Yes (PERFECT SCORE)** |
| 006 | arc-135a2760 | N/A | API timeout on iter 1 |

Run-006 achieved the first successful return with correct answer. Opus 4.6 with single-block enforcement returned JSON.stringify'd 2D array at iteration 15. The combination of proper REPL iteration + JSON.stringify fix enabled this.

### Harness bug: String() serialization
`src/rlm.ts:378` uses `String(returnValue)` which destroys 2D array structure. Must be fixed to `JSON.stringify()` before any ARC run can succeed. Discovered in run-002 when arc-135a2760 returned a correct-format 2D array that was flattened.

### New: Model alias bug (orchestrator)
The `orchestrator` alias resolved to `anthropic/claude-sonnet-4-5-20250929` which is not a valid LiteLLM model ID. This caused a 400 error in run-003 that destroyed arc-0934a4d8's most promising delegation attempt. Must fix the alias mapping before any run uses `model: "orchestrator"`.

### Budget sizing problem
Run-003 used 15 iterations (down from 50 in run-002) on the theory that delegation would offload work. In practice, delegation adds 3-4 iterations of overhead, leaving only 11-12 for actual work. For arc-135a2760, this meant the 2/2 solution was found at iter 13 with 0 iterations left to return.

### Progress signal across runs

**arc-135a2760** (the "easier" task):
- Run 001: 25 iters, timeout, never returned
- Run 002: 13 iters, found rule at iter 3, verified 2/2, returned (wrong answer due to algorithm + format bug)
- Run 003: 15 iters, delegation failed, found rule at iter 5, verified 2/2 at iter 13, no return (budget exhausted)

**arc-0934a4d8** (the "harder" task):
- Run 001: 25 iters, timeout, no rule found
- Run 002: 50 iters, found pattern at iter 21, 3/4 at iter 45, no return
- Run 003: 15 iters, delegation failed, no rule found, no return
- Run 005: 2 iters (of 30), found 8-region in resp2 but multi-block violation + token cap halted progress

## Open Issues

1. ~~**Fix String() serialization** in `src/rlm.ts:378`~~ — **FIXED** in run-006 prep (`JSON.stringify` for objects)
2. ~~**Fix orchestrator alias**~~ — **FIXED** (`anthropic/claude-sonnet-4.5` in `src/models.ts`)
3. **Fix Promise.all error handling** — one child crash kills entire batch; need individual catch
4. **Budget sizing** — 15 worked for the perfect score but may be tight for harder tasks
5. **Delegation timing** — strategist must complete structural analysis before delegating
6. **Driver compliance** — improved with single-block enforcement; further driver compliance TBD
7. **The return() crisis** — run-006 successfully returned (2/12 total). Opus returns more reliably than Sonnet
8. ~~**Enforce one-block-per-iteration at harness level**~~ — **FIXED** in run-006 (`maxBlocksPerIteration` in `src/rlm.ts`)
9. ~~**Increase max_tokens for Opus**~~ — **FIXED** in run-006 (8192 via `modelOverrides()`)
10. **Handle finish=length** — still relevant for edge cases; Opus occasionally hits 8192 limit
11. **API timeout for large tasks** (new from run-006) — arc-135a2760's first call took 209s, exceeding 120s limit. Need longer timeout or task-specific config
12. **Iter-1 token waste** (new from run-006) — Opus writes 8 code blocks on iter 1 (7 discarded). The wasted output tokens add latency and cost
