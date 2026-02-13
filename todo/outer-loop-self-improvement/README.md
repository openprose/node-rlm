# Outer-Loop Self-Improvement

## The Concept

The RLM's inner loop is: **write code → observe output → refine → return**. An agent iterating toward a correct answer.

What we've been doing in this session — and across the last dozen commits — is the **same loop, one level up**:

**Run eval → distill trajectories → analyze patterns → synthesize recommendations → implement changes → run eval again**

This is the RLM optimizing itself. The "code" is the system prompt, driver plugins, and harness configuration. The "output" is eval scores, trajectory annotations, and failure mode taxonomies. The "refinement" is writing new drivers, removing harmful helpers, tuning timeouts. The "return" is the next eval run.

The inner loop operates over a single task in 15-20 iterations. The outer loop operates over the RLM's own behavior across eval runs. Both follow the same structure:

```
┌─────────────────────────────────────────────────────────┐
│  INNER LOOP (one task, 15-20 iterations)                │
│                                                         │
│  observe → hypothesize → implement → verify → return    │
│                                                         │
│  Substrate: JavaScript in a REPL sandbox                │
│  Artifacts: console.log output, variables, return value │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  OUTER LOOP (one eval cycle, hours)                     │
│                                                         │
│  run eval → distill → analyze → recommend → implement   │
│                                                         │
│  Substrate: prompts, drivers, harness code              │
│  Artifacts: trajectory annotations, classification      │
│             taxonomies, visualizations, new drivers      │
└─────────────────────────────────────────────────────────┘
```

The key insight: **the outer loop could itself be an RLM**. It has all the same components — a persistent environment (the codebase), tools (eval harness, git, CI), iteration capability (run after run), and a clear objective (maximize eval score while minimizing cost). The human currently provides the judgment layer ("drop arc-solver, add these drivers, run again"), but every decision we made was grounded in quantitative evidence from the analysis agents.

## The Process We Followed

Reconstructed from git history and this session's thread.

### Phase 0: Infrastructure (main branch, early commits)

Built the eval harness, dataset loaders, scoring functions, CI pipeline.

- `378a912` Initial commit: core RLM, eval harness, plugins
- `ff5dd91`→`9880973` Seven commits fixing OOLONG data pipeline (OOM, streaming, caching)
- `f833b96` Trajectory analysis pipeline and TRAJECTORY_FORMAT.md
- `fb4e0ec` ARC-AGI-2 benchmark support
- `e52f0f5` Align defaults with RLM paper config

### Phase 1: First ARC Runs (main branch, runs 001-006)

Ran Opus on ARC, discovered the multi-block hallucination problem, iterated to first perfect score.

- `72ca832` Experiment 001: Sonnet 4.5 plugin comparison (OOLONG)
- `008cf27` Add model selection for child delegation
- `a8527c9` Default model aliases
- `18cd2cb` **Single-block enforcement** — the breakthrough. Also Opus optimizations, ARC plugins
- `d768c50` Trajectory analyses for runs 001-006
- `6045907` Run-006 distillations (first perfect score on arc-0934a4d8)
- `c05a490` Front-load single-block enforcement in system prompt

**Outer-loop observation**: Multi-block hallucination was the dominant failure mode. Single-block enforcement was the fix. This was the first complete outer-loop cycle.

### Phase 2: Streaming + Arc-Solver Rewrite (main branch)

Applied trajectory analysis findings to the harness and plugins.

- `6bf78ae` Streaming early-termination (abort at second code fence), Opus timeout 120→180s, arc-solver v0.3.0 rewrite

**Outer-loop observation**: Even with single-block enforcement, Opus spent 80%+ of generation time on discarded blocks. Streaming abort was the harness-level fix.

### Phase 3: Matched-Pair A/B Test (this branch, runs 022-023)

The first controlled experiment: same 20 tasks, with vs without arc-solver plugin.

- `7d4ef65` Download trajectory data from eval runs #22 and #23
- `3f62847` Deterministic analyze.ts output
- `fdeb295` Reorganize into eval/analyses/003-opus-arc-feb13/
- `6081ad2` Trajectory distillations batch 1 (10 tasks)
- `7df48c8` Trajectory distillations batch 2 + meta-review overview
- `bc1257f` Analysis prompts for 3 parallel Opus investigations

**Outer-loop observation**: The plugin was net-negative (-5%). This was surprising — more guidance hurt performance. The matched-pair design made this measurable.

### Phase 4: Parallel Analysis (this session)

Deployed 3 Opus agents simultaneously to analyze the trajectories from different angles:

1. **Meta-review agent** → Found plugin's harmful eager-return behavior (85% of tasks tried returning in iter 1), buggy findRepeatingTile helper, iteration overhead on shared successes
2. **Cross-run trajectory analysis agent** → Built 10-dimension classification taxonomy, discovered verification-before-return as strongest success predictor (76% vs 17%), produced 14 recommendations
3. **Recursion opportunities agent** → Honest assessment: +1-2 tasks at best, most failures are single-agent problems

### Phase 5: Synthesis → Drivers (this session)

Converted analysis findings into composable driver plugins:

- `targeted-recursion.md` — 3 genuine delegation patterns + 4 anti-patterns
- `shared-context-delegation.md` — Pass data via sandbox variables, not prompts
- `hypothesis-budget.md` — Cap hypotheses, force systematic comparison
- `verify-all-examples.md` v0.2.0 — Added verification gate before return()
- `overlap-testing.md` — Test all orderings when elements overlap
- `json-stringify-return.md` — Stringify structured returns
- `arc-helper-library.md` v0.2.0 — Removed harmful findRepeatingTile, "copy only what you need"
- `arc-solver.md` — Removed eager-return language, softened symmetry mandate

Also: `TRAJECTORY_FORMAT.md` v2 (sub-phases, hypothesis log, outcome markers) and an interactive visualization.

- `5d455ec` exploration-budget and question-first drivers
- `51b06a7` ARC eval integration planning docs
- `57ea7df` All analysis outputs, new drivers, trajectory format v2

### Phase 6: Next Run (pending)

The next eval will drop `arc-solver.md` entirely and use only composable drivers:

```
one-block-per-iteration, deadline-return, verify-all-examples,
verify-before-return, hypothesis-budget, exploration-budget,
arc-helper-library, overlap-testing, json-stringify-return
```

This tests the hypothesis that decomposed, evidence-based drivers outperform a monolithic app plugin.

## What an Automated Outer Loop Would Need

To make this an RLM itself, you'd need:

1. **Eval runner** (exists): `eval/run.ts` + GitHub Actions workflow
2. **Trajectory distiller** (exists): Claude Code action that annotates raw traces
3. **Analysis agents** (exists): The 3 parallel Opus agents we ran this session
4. **Recommendation synthesizer** (partially exists): The agents produce recommendations, but a human currently triages them
5. **Driver writer** (partially exists): The agents wrote drivers, but a human decided which to write
6. **A/B test designer** (doesn't exist): Deciding what to vary in the next run
7. **Regression detector** (doesn't exist): Automatically flagging when a change makes things worse
8. **Convergence criterion** (doesn't exist): Knowing when to stop iterating

The gap is mostly in items 6-8: the judgment about *what to try next* and *when to stop*. Everything else is already automated or automatable.

## Why This Matters

The RLM paper demonstrates that LLMs can iteratively solve tasks by writing and executing code. This outer loop demonstrates that the same pattern applies to improving the LLM's own task-solving behavior. The substrate changes (from JavaScript to prompts/drivers/configs), but the loop structure is identical.

If the outer loop itself were an RLM, it would be an RLM that improves RLMs — a concrete, grounded form of recursive self-improvement that doesn't require modifying weights. The "weights" are the prompt, the drivers, and the harness configuration. The "gradient" is trajectory analysis. The "learning rate" is how aggressively recommendations are implemented.
