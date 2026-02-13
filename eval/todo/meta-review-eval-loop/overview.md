# Meta-Review: Executive Summary

## What the Loop Does Well Today

1. **The trajectory distillation spec (`TRAJECTORY_FORMAT.md`) is excellent.** The vocabulary of patterns, failure modes, phases, and verdicts is well-designed, extensible ("coin a new term"), and produces genuinely useful annotations. The run-022 and run-023 trajectory files demonstrate that LLM annotators following this spec produce high-quality, actionable analysis.

2. **The `.prose/analyze-trajectories.prose` pipeline is well-structured.** The sampler -> annotator -> reviewer -> synthesizer -> summary pipeline is a sound architecture. Stratified sampling, adversarial review, and synthesis with evidence requirements are all correct design choices.

3. **Incremental harness improvements are data-driven.** The progression documented in `eval/analyses/002-arc-benchmark/README.md` (runs 001-006) shows concrete learnings driving concrete fixes: String() serialization bug found via trajectory analysis, multi-block enforcement added after observing Opus behavior, maxTokens increased after observing finish=length truncation. Each run's README documents the hypothesis tested and outcome observed.

4. **Plugin system provides clean prompt composition.** The drivers/apps/profiles architecture in `src/plugins.ts` cleanly separates model-specific reliability patches from task-specific strategies from profile auto-detection. This is the right abstraction for systematic prompt iteration.

5. **The eval harness is production-quality.** Resumability (`loadPartialResults`), concurrent execution with pool pattern, incremental JSON saves, rate limiting, cost estimation, CI integration via GITHUB_STEP_SUMMARY -- these are all mature engineering choices that reduce friction for running experiments.

## Top 5 Highest-Leverage Improvements

### 1. Structured trajectory data alongside markdown (estimated +30% analysis velocity)

Currently, trajectory distillation produces markdown files with YAML frontmatter. This is great for human reading but terrible for programmatic analysis. The frontmatter fields (`patterns`, `failureMode`, `verdict`) are the only structured data, and they are scattered across individual files. There is no machine-readable cross-run comparison.

**Fix:** Emit a `trajectories.jsonl` alongside the markdown files, where each line is a JSON object with all frontmatter fields plus computed metrics (iteration efficiency, code volume, error rate). This enables `analyze.ts` to consume trajectory-level annotations programmatically.

### 2. Automated cross-run comparison with diff-to-config mapping (estimated +40% insight per run)

Today, cross-run comparison is entirely manual and ad-hoc. The `eval/analyses/003-opus-arc-feb13/` directory has two run directories and two `analysis.txt` files, but no cross-run comparison file. Comparing run-022 (with arc-solver.md) to run-023 (without) requires manually reading both sets of trajectories and mentally diffing them.

**Fix:** Build a `cross-analyze.ts` that takes two or more result JSON files, matches tasks by ID, and produces a structured comparison: per-task score deltas, aggregate metric changes, shifted failure modes, and new/lost patterns. Output both a markdown report and a JSON artifact.

### 3. Close the loop: analysis -> prompt/config diffs (estimated +50% iteration speed)

The loop currently ends at "Recommend changes" with prose recommendations in synthesis.md or README.md files. The human must then manually interpret recommendations and edit prompt files. There is no structured mapping from "failure mode X observed in N tasks" to "change line Y of plugin Z."

**Fix:** The synthesizer agent should output a `recommendations.json` with entries like `{ "type": "prompt-edit", "file": "plugins/apps/arc-solver.md", "section": "Iteration guide", "change": "Add explicit deadline return enforcement at iter N-3 instead of N-2", "evidence": ["arc-0934a4d8 (run-022)", "arc-0934a4d8 (run-023)"], "expectedImpact": "prevent 2/20 timeouts" }`. This makes recommendations testable and trackable.

### 4. Per-iteration telemetry in trace data (estimated +25% diagnosis quality)

The `TraceEntry` type (`src/rlm.ts:35-40`) records `reasoning`, `code[]`, `output`, and `error` per iteration. It does **not** record: wall time per iteration, input/output token counts per LLM call, whether the first-iteration return guard fired, whether blocks were discarded, or delegation tree structure. This telemetry gap means trajectory annotators must infer timing and cost from aggregate numbers.

**Fix:** Extend `TraceEntry` to include `wallTimeMs`, `inputChars`, `outputChars`, `blocksDiscarded`, `returnIntercepted`, and optionally `childTraces` for delegation. This is a surgical change to `src/rlm.ts` lines 35-40 and the exec loop at lines 307-441.

### 5. Failure mode regression tracking across runs

There is no mechanism to track whether a specific failure mode (e.g., `timeout-on-edge-case`, `incorrect-tile-detection`) persists, improves, or regresses across runs. The `eval/analyses/` directory structure stores runs independently, and the only cross-run tracking is the manual table in `README.md` files.

**Fix:** Maintain a `failure-registry.json` that maps `(taskId, failureMode)` tuples to the runs where they were observed. When a new run is analyzed, automatically flag: (a) regressions (failure modes that appeared in tasks that previously passed), (b) fixes (tasks that now pass where they previously failed with mode X), (c) persistent failures (same mode across 3+ runs).

## Proposed Target State

The eval-and-improve loop should converge toward a CI-driven continuous improvement cycle:

```
1. Run evals (automated, CI-triggered)
   |
   v
2. Auto-distill trajectories (prose pipeline, triggered post-eval)
   |
   v
3. Emit structured data (trajectories.jsonl, per-task metrics)
   |
   v
4. Cross-run analysis (automated comparison to previous runs)
   |
   v
5. Failure regression check (flag regressions, celebrate fixes)
   |
   v
6. Generate prompt/config diff candidates (structured recommendations)
   |
   v
7. Human review + merge (the only manual step)
   |
   v
8. Repeat
```

The key shift: steps 2-6 should be automated. Today, steps 2-5 are manual, and step 6 is prose-only. The human should only need to review and approve changes, not discover or write them.

The target latency: under 30 minutes from "eval run completes" to "diff PR ready for review." Today this takes hours of manual analysis.
