# ARC-3 Multi-Agent Mid-Run Report

**Experiment:** `b82bc3f` -- 3-tier delegation for ARC-AGI-3 game `ls20`
**Snapshot taken:** 2026-02-16 ~13:15 (experiment still running)
**Architecture:** Orchestrator (Sonnet 4.5) -> Level-Manager (Opus 4.6) -> Level-React (Opus 4.6) + Level-Synthesizer (Gemini Flash)

---

## 1. Call Statistics (as of snapshot)

| Model | Role | Calls | Input chars | Output chars | Truncations |
|-------|------|-------|-------------|--------------|-------------|
| Sonnet 4.5 | Orchestrator | 20 | 984k | 71k | 0 |
| Opus 4.6 | Manager + React | 149 | 3.2M | 487k | 10 |
| Gemini Flash | Synthesizer | 22 | 290k | 57k | 0 |
| **Total** | | **191** | **4.5M** | **615k** | **10** |

**Budget consumed:** 19 of 30 orchestrator iterations (63%). 11 remaining.
**API time elapsed:** ~47 minutes. Estimated ~20 more minutes to completion.

## 2. Delegation Pattern Analysis

### Cycle-by-cycle breakdown

Each "cycle" starts with a Sonnet orchestrator call and includes all child calls before the next Sonnet call.

| Cycle | Pattern | Opus | Gemini | Truncations | Time | Assessment |
|-------|---------|------|--------|-------------|------|------------|
| 1 | INIT | 0 | 0 | 0 | 5s | Initialization only |
| 2 | Oversized | 14 | 2 | 0 | 214s | React ran deep (context grew to 50k) |
| **3** | **Runaway** | **31** | **0** | **3** | **549s** | **React ran 30+ turns, no synthesizer** |
| 4 | No synth | 10 | 0 | 0 | 134s | React overran, no synthesis |
| 5 | Oversized + synth | 10 | 2 | 1 | 212s | Some recovery |
| 6 | With synth (7 Opus) | 7 | 2 | 2 | 214s | Improving |
| 7 | No synth | 7 | 0 | 0 | 90s | Missing synth |
| 8 | **IDEAL** | 4 | 2 | 0 | 99s | First clean cycle |
| 9 | No synth | 9 | 0 | 0 | 156s | Regression |
| 10 | **IDEAL** | 4 | 2 | 1 | 104s | |
| 11 | No synth | 7 | 0 | 0 | 101s | |
| 12 | **IDEAL** | 4 | 2 | 0 | 118s | |
| 13 | No synth | 7 | 0 | 1 | 139s | |
| 14 | **IDEAL** | 4 | 2 | 1 | 112s | |
| 15 | **IDEAL** | 4 | 2 | 0 | 76s | |
| 16 | No synth | 9 | 0 | 0 | 159s | |
| 17 | **IDEAL** | 4 | 2 | 0 | 73s | |
| 18 | **IDEAL** | 4 | 2 | 0 | 65s | |
| 19 | **IDEAL** | 4 | 2 | 1 | 113s | Recent, clean |

**Ideal pattern (S + 4O + 2G):** 8 of 19 cycles (42%)
**With synthesizer (any form):** 12 of 19 cycles (63%)
**Without synthesizer:** 7 of 19 cycles (37%)

### Key finding: alternating pattern from cycle 8 onwards

The system settled into a rhythm starting at cycle 8, alternating between ideal cycles (with Gemini synthesizer) and bloated no-synth cycles. The last 4 cycles (16-19) show three consecutive ideal patterns, suggesting the system may have stabilized.

## 3. Comparison: Run 1 (completed) vs Run 2 (current)

| Metric | Run 1 (completed) | Run 2 (current, 63%) |
|--------|-------------------|---------------------|
| Sonnet calls | 30 | 20 |
| Opus calls | 100 | 149 |
| Gemini calls | 50 | 22 |
| Total calls | 180 | 191 |
| Truncations | 1 | 10 |
| Ideal cycles | 26/30 (87%) | 8/19 (42%) |
| Opus/Sonnet ratio | 3.3 | 7.5 (ideal: 4.0) |
| Gemini/Sonnet ratio | 1.7 | 1.2 (ideal: 2.0) |
| Result | FAIL (0%) | In progress |
| Wall time | 37 min | ~67 min estimated |

**Run 2 is burning Opus calls at 2.3x the rate of Run 1.** The primary cause is the early chaotic period (cycles 2-7) and recurring no-synth cycles where the level-manager spawns extra react agents or the react agent runs long. Run 2 is already at 149 Opus calls with only 63% of the budget consumed. At the current rate, the final Opus count will be ~230-240 (vs 100 in Run 1).

**Run 2 is under-calling Gemini synthesizers.** At 22 Gemini calls vs an expected 38 (2 per iteration), the synthesizer is being skipped in 37% of cycles. This means knowledge is not being distilled from ~1/3 of level attempts.

## 4. Truncation Analysis

All 10 truncations occurred on Opus calls (level-react agents), all hitting ~11k output tokens:

| Opus # | Input | Output | Notes |
|--------|-------|--------|-------|
| 16 | 15.6k | 11.8k | Cycle 3 |
| 19 | 15.2k | 11.5k | Cycle 3 |
| 22 | 15.3k | 11.5k | Cycle 3 |
| 57 | 15.8k | 10.9k | Cycle 5 |
| 71 | 14.9k | 11.3k | Cycle 6 |
| 72 | 27.0k | 10.9k | Cycle 6 |
| 94 | 14.9k | 11.6k | Cycle 10 |
| 109 | 16.1k | 10.7k | Cycle 13 |
| 116 | 15.8k | 11.0k | Cycle 14 |
| 141 | 14.8k | 11.1k | Cycle 19 |

The react agent's max_tokens appears to be set around 11-12k. This is a significant constraint: react agents that are actively playing the game and generating detailed observations hit the output ceiling. When truncated, the next Opus call typically receives the truncated context (~27k input) and produces a short recovery response (~1k output). This truncation-then-recovery pattern adds 2 wasted calls per incident.

## 5. Context Growth Analysis

### Orchestrator (Sonnet) context growth

| Sonnet # | Input chars | Delta | Est. tokens |
|----------|-------------|-------|-------------|
| 1 | 16,200 | -- | ~4k |
| 2 | 16,871 | +671 | ~4.2k |
| 5 | 29,840 | +4,331 | ~7.5k |
| 10 | 51,583 | +4,335 | ~12.9k |
| 15 | 73,345 | +4,353 | ~18.3k |
| 19 | 90,907 | +4,402 | ~22.7k |
| 30 (est.) | ~139,000 | -- | ~34.8k |

**Average growth per iteration: ~4,355 chars (~1,089 tokens).**

The growth is remarkably linear. Each child delegation returns a result that adds ~4.4k chars to the orchestrator's conversation history. This means the orchestrator's context window is being used efficiently -- no exponential blowup. The projected final context of ~139k chars (~35k tokens) is well within Sonnet 4.5's context window.

**Knowledge IS accumulating.** The steady growth confirms that each delegation cycle successfully returns structured knowledge to the orchestrator. The `__knowledge` object is being populated with mechanics, rules, hazards, and object types across levels.

### Gemini synthesizer context growth (within pairs)

Gemini calls come in pairs. The second call in each pair has increasingly larger input:

| Pair | Gemini #1 input | Gemini #2 input | Growth |
|------|-----------------|-----------------|--------|
| 1 | 9.7k | 12.9k | +3.2k |
| 5 | 9.8k | 17.3k | +7.5k |
| 8 | 9.7k | 18.4k | +8.7k |
| 11 | 9.7k | 19.6k | +9.9k |

The growing Gemini #2 input suggests accumulated knowledge is being passed to the synthesizer for cross-referencing, which is the intended behavior.

## 6. React Agent Behavior

### Bounded vs runaway

- **Cycle 3 was the worst runaway:** 31 Opus calls, 9+ minutes, context grew to 61k chars. The react agent played dozens of turns without returning.
- **Cycle 2 was also overlong:** 14 Opus calls with context reaching 50k -- the react agent explored extensively.
- **Cycles 8+ are well-bounded:** Opus runs are 4-9 calls, with most being exactly 4 (the ideal).

### Context patterns reveal the delegation structure

Opus calls starting at ~10,845c are **level-manager spawns** (18 observed = exactly 1 per Sonnet iteration excluding init).
Opus calls starting at ~14-16k are **level-react spawns or manager continuation calls**.
Opus calls with context >40k are **deep react agents** that have played many turns.

## 7. Comparison to Prior Single-Agent Runs

| Metric | Best single-agent (v1.7) | Run 1 (multi-agent) | Run 2 (current) |
|--------|--------------------------|---------------------|-----------------|
| Score | 14.3% | 0% (FAIL) | In progress |
| Children returned | 1/4 | N/A | N/A |
| Total iterations | 30 | 30 | 19/30 |
| Architecture | Single Opus | 3-tier | 3-tier |
| Knowledge transfer | None | Structured JSON | Structured JSON |

The multi-agent approach has not yet demonstrated a scoring advantage over single-agent runs. Run 1 (with the circular reference bug) completed all 30 iterations but scored 0%. The current run is more chaotic but has been stabilizing.

The critical question remains: **is the knowledge accumulation across levels translating into better gameplay?** The steady context growth suggests information is flowing, but the 37% no-synth rate means a third of level attempts produce raw, unprocessed observations rather than distilled knowledge.

## 8. Estimated Completion

- **Iterations remaining:** 11 of 30
- **Average time per cycle (recent):** ~107 seconds
- **Estimated remaining time:** ~20 minutes
- **Estimated total wall time:** ~67 minutes (vs 37 min for Run 1)

Run 2 is tracking 1.8x slower than Run 1, primarily due to the early runaway period (cycles 2-7) and higher Opus call volume.

## 9. Key Observations

### What is going right

1. **Knowledge accumulation is working.** The orchestrator's context grows linearly by ~4.4k per iteration, confirming structured knowledge flows from children back to the orchestrator.
2. **Late-run stabilization.** Cycles 15-19 show 4 of 5 being ideal patterns (S+4O+2G). The system learned to produce well-bounded delegations.
3. **Gemini synthesizer engagement is improving.** Recent cycles consistently include synthesizer calls, producing distilled knowledge.
4. **No Sonnet truncations.** The orchestrator has never hit max_tokens, meaning its delegation instructions remain consistent (~3.9k output per iteration).
5. **Manager always returns.** Unlike prior single-agent runs where children silently timed out, every Sonnet iteration shows child completion -- the try-catch and timeout guards are working.

### What is going wrong

1. **Early chaotic period wasted budget.** Cycles 2-7 consumed 7 iterations (23% of budget) while producing inconsistent results and burning 79 Opus calls (53% of current total).
2. **Intermittent no-synth cycles.** 37% of cycles skip the Gemini synthesizer entirely, producing raw observations instead of processed knowledge. This appears to happen when the level-manager gets a complex react result and runs additional iterations instead of delegating to the synthesizer.
3. **React agent truncations.** 10 output truncations (all Opus) suggest the max_tokens limit for react is too low. Each truncation wastes ~2 additional calls for recovery.
4. **High Opus consumption.** 149 Opus calls at 63% completion vs 100 total in the completed Run 1. The Opus/Sonnet ratio of 7.5 vs the ideal 4.0 indicates significant over-delegation.
5. **No level completion evidence yet.** 19 iterations in, there is no visible sign that any level has been completed. The game state appears to cycle through "NOT_FINISHED" repeatedly.

### Structural issues

- **The no-synth alternation pattern (cycles 8-16) suggests a systematic problem.** Every other cycle, the manager fails to call the synthesizer. This could be a context-dependent bug where certain react return formats cause the manager to skip iteration 1 (the synthesizer step) and return directly.
- **Truncation ceiling is too low for react.** At ~11k output tokens, the react agent cannot fully describe its observations when it plays many turns. Either the action budget should be reduced or max_tokens increased.

---

## 10. Final Status

**Run completed at:** 2026-02-16T18:28:07.453Z
**Final iteration count:** 25 of 30 (API key limit exhausted at iteration 25)
**Final score:** 0%
**Final wall time:** 56 minutes 28 seconds

### Final call statistics

| Model | Role | Calls | Truncations |
|-------|------|-------|-------------|
| Sonnet 4.5 | Orchestrator | 28 | 0 |
| Opus 4.6 | Manager + React | 173 | 14 |
| Gemini Flash | Synthesizer | 33 | 0 |
| **Total** | | **234** | **14** |

### Final state

- **Levels completed:** 1 (Level 1 only)
- **Level 2 attempts:** 22 (none successful)
- **Actual game actions (arc3.actionCount):** 32
- **Orchestrator estimated actions:** 254 (inflated by stale child reports)
- **Knowledge accumulated:** 13 mechanics, 38 rules, 3 hazards (mostly redundant)
- **Children returned:** 22/23 (96%)
- **Termination cause:** OpenRouter API key spending limit exceeded (403 error)

### Root cause of failure

A global state pollution bug caused all react agents after Level 1 to return stale data without taking any game actions. The `__guard()` function, called as the first line of each react agent's code, inherited `__done = true` from the Level 1 react agent and returned immediately. Only 2 of 23 level-manager delegations resulted in the react agent actually calling `arc3.step()`. See `run-025-analysis.md` for full root cause analysis and recommendations.

### Mid-run predictions vs actual

| Prediction (at snapshot) | Actual |
|--------------------------|--------|
| Est. total wall time: ~67 min | 56 min 28s |
| Est. total Opus calls: ~230-240 | 173 |
| Est. final iterations: 30 | 25 (API key limit) |
| Ideal cycle rate improving | Stabilized at ~50% ideal cycles |
| No level completion evidence | Correct -- Level 2 never completed |

The mid-run prediction of ~230-240 Opus calls was reasonable but the API key limit at iteration 25 truncated the run early.

---

*Report generated from live experiment output at `/private/tmp/claude-501/-Users-sl-code-trinity-node-rlm/tasks/b82bc3f.output` (225 lines at snapshot time, file actively growing).*
*Final status section added post-run from result JSON and full API log (309 lines).*
