# Backpressure

How the RLM system evaluates itself. A post-hoc judge that measures program adherence, critiques the language itself, and evolves the composition vocabulary from empirical evidence.

## The problem

The RLM programming language (LANGUAGE.md) and container model (CONTAINER.md) describe how programs should work: contracts, shapes, delegation discipline, curation, composition vocabulary. Models don't reliably follow these programs. The system prompt and program structure need iteration, but you can't iterate effectively without knowing where and how the model deviates.

## The judge

The judge is an RLM program. It takes a completed execution trace (events from the observer) and the program files that governed the run, and produces a structured adherence assessment. Same language, same container model, same tenets. If the judge can't follow its own program, that's signal about the language's expressiveness.

### Two evaluation targets

1. **Prompt/program iteration.** Hold the model constant, change the prompt or program, compare adherence. Did the change help?
2. **Model comparison.** Hold the program constant, change the model, compare adherence. Which model follows programs better?

### Two levels of judgment

**Level 1 -- Program adherence.** Did the model follow the program it was given?

- **Shape adherence.** Did it respect `prohibited` APIs? Did it delegate to the right children? Did it collapse into leaf work?
- **Delegation discipline.** Brief quality (facts from state vs. parent's own analysis). Curation after delegation (did `given:` blocks execute?). Budget proportionality. Composition style selection.
- **Contract satisfaction.** Were `ensures` postconditions met? Were `requires` preconditions checked before delegation? Did state schemas get populated correctly?
- **Behavioral patterns.** Strategy selection. Invariant maintenance. Observable progress per iteration. Error handling.

**Level 2 -- Spec critique.** Where did the program, language, or container spec itself fail the model?

- Is the `prohibited` construct sufficient to prevent collapse, or does the model need something stronger?
- Are composition principles too abstract to be actionable?
- Is the system prompt making the program legible enough?
- Are there recurring deviation patterns that suggest a missing language construct?
- Would a different program structure have served the model better?

### Evolving the standard library

The standard library (`lib/`) ships with composites, roles, and controls -- reusable program patterns seeded from engineering intuition. The composition vocabulary (`direct`, `coordinated`, `exploratory`, `targeted`) is similarly seeded. All of it is scaffold, not cage. Like SFT before RLHF, useful for bootstrapping, expected to be superseded by empirically-discovered patterns.

The judge's deepest function is to evolve the entire library:

1. **Detect recurring patterns.** Across many traces, identify behaviors that succeed repeatedly -- structural patterns the model discovers on its own that aren't in the current library.
2. **Name and promote.** When a pattern recurs reliably, give it a name and add it to the library as a composite, role, or control. The library grows from evidence, not intuition.
3. **Demote and retire.** When a library component consistently fails or goes unused, remove it. The library shrinks when patterns stop paying for themselves.
4. **Discover missing axes.** The composition vocabulary currently has two axes (topology, brief richness). A third axis -- delegation mode (`observed`, `bounded`, `speculative`, `checkpointed`) -- is emerging. The judge may discover others.
5. **Evaluate stdlib usage.** When a program uses stdlib components, was that effective? When it doesn't, would a stdlib component have helped? This informs both library evolution and program improvement.

The hand-designed library is a starting point. The judge is the feedback loop that turns it into an empirically-grounded standard library.

## Input

The judge receives:

1. **Event trace.** The full event stream from a completed run (14 event types from the observer). This is the raw behavioral record.
2. **Program files.** The `root.md` and node `.md` files that governed the run. These are the contracts the model was supposed to follow.
3. **Spec documents.** LANGUAGE.md, CONTAINER.md, TENETS.md. These give the judge the meta-context for Level 2 critique.
4. **Run metadata.** Model used, benchmark, task ID, result (success/failure), iteration count.

## Output

An `AdherenceReport`:

```
AdherenceReport {
  run: { model, benchmark, taskId, success, iterations }

  shape: {
    violations: [{ event, description, severity }]
    score: 0..1
  }

  delegation: {
    brief_quality: [{ delegation, assessment, issues }]
    curation_present: boolean[]
    composition_style: string        -- what style was used (named or novel)
    budget_proportionality: string   -- assessment
    score: 0..1
  }

  contracts: {
    ensures_met: [{ contract, met: boolean, evidence }]
    requires_checked: [{ contract, checked: boolean }]
    score: 0..1
  }

  behavior: {
    progress_per_iteration: number[] -- did each iteration advance the task?
    strategy_coherence: string       -- did strategy selection match conditions?
    error_handling: string
    score: 0..1
  }

  stdlib: {
    components_used: [{ name, category, effective: boolean, notes }]
    missed_opportunities: string[]   -- where a stdlib component would have helped
    novel_patterns: [{               -- patterns that could become new lib/ components
      description: string
      frequency: string
      candidate_category: "composite" | "role" | "control"
      recommendation: string         -- promote, investigate, ignore
    }]
  }

  meta: {
    spec_issues: [{ location, issue, suggestion }]
    missing_constructs: string[]     -- language constructs that would have helped
    program_improvements: string[]   -- specific changes to the program files
    vocabulary_observations: [{
      pattern: string                -- what the model did
      frequency: string              -- how often
      named: boolean                 -- is this an existing vocabulary term?
      recommendation: string         -- promote, demote, investigate
    }]
  }

  overall_score: 0..1
  summary: string                    -- 2-3 sentence narrative
}
```

## Architecture

The judge is a program in `programs/judge/`:

```
programs/judge/
  root.md              -- component catalog, assessment schema, evaluation principles
  evaluator.md         -- orchestrator: reads trace + program, delegates to specialists
  shape-judge.md       -- shape adherence analysis
  delegation-judge.md  -- delegation discipline analysis
  contract-judge.md    -- contract satisfaction analysis
  meta-critic.md       -- spec critique + vocabulary evolution
```

Each specialist receives the event trace and program files as context, analyzes its domain, and returns structured findings. The evaluator orchestrator curates findings into the final `AdherenceReport`.

The judge architecture is itself multi-polar (TENETS.md: "Multi-Polarity Over Monologue"). The specialists create structural tension -- the shape-judge and delegation-judge may disagree about whether a violation was a shape problem or a delegation problem. The meta-critic disagrees with all of them by design: it asks whether the program itself was wrong, not just whether the model deviated from it. This tension is the judge's strength. A single monolithic evaluator would rationalize its own assessments.

The judge can use stdlib composites where they fit. The shape-judge + meta-critic relationship resembles `witness` (independent observation, discrepancies are signal). The evaluator's curation of specialist findings is a natural `pipeline`. The judge eating its own dogfood is the ultimate test of the stdlib.

The meta-critic is the most important component. It's the one that looks beyond "did the model follow the program" to "should the program have been different." Its `stdlib` and `vocabulary_observations` fields feed the evolution loop.

## Running the judge

```bash
# After a benchmark run:
npx tsx eval/judge.ts --result eval/results/arc3_opus_task1.json --program arc3

# Compare adherence across models:
npx tsx eval/judge.ts --results-dir eval/results/ --program arc3 --compare-models

# Track vocabulary evolution:
npx tsx eval/judge.ts --result eval/results/arc3_opus_task1.json --program arc3 --vocabulary-report
```

The judge output is JSON, stored alongside the result file. The viewer (eval/viewer.html) can render adherence annotations on the event timeline.

## Toward real-time

The post-hoc judge validates the pattern. The eventual path to real-time backpressure:

### Delegation modes: a third composition axis

The composition vocabulary currently has two axes: topology (direct/coordinated) and brief richness (exploratory/targeted). A third axis is emerging: **delegation mode** -- how the parent relates to the child during execution, not just before (brief) and after (curation).

| Mode | What it does | Engine requirement |
|------|-------------|-------------------|
| `observed` | Parent receives child's event stream in real-time | Observer exposed to sandbox |
| `bounded` | Hard-kill after N iterations or M seconds, return partial result | Cancellation primitive |
| `speculative` | Fan-out K children, take first result, cancel rest | Concurrent execution + cancellation |
| `checkpointed` | Snapshot child state at each iteration, parent can resume from any point | Checkpoint/restore in sandbox |

These are parent-side concerns — the child never knows. They compose with the existing axes: `observed + coordinated + targeted` is a retry with monitoring. `speculative + direct + exploratory` is fan-out discovery.

Delegation modes are engine mechanisms (parameters on `rlm()`), not program patterns. They differ from stdlib composites, which are program-level patterns composed from multiple `rlm()` calls. A composite like `worker-critic` could USE delegation modes internally (e.g., `bounded` on the worker to prevent runaway iterations).

### The path

1. **Expose the observer to the sandbox.** A parent calling `rlm()` with `observed: true` gets a scoped observer that receives the child's events synchronously during execution via `observer.on()` handlers. No new engine primitive needed beyond a sandbox binding.

2. **Oversight-rlm.** The judge program (or a simplified version) runs as an oversight agent alongside the target. It receives events in real-time via the observer binding, writes assessments to shared `&`-state, and the target reads them between iterations. The parent composes both the target and the oversight agent. This could become `lib/composites/oversight.md`.

## Relationship to the language

The judge doesn't require language extensions. It's expressed entirely in existing constructs: contracts, state schemas, delegation patterns, component catalogs. The judge IS the test of whether the language is expressive enough.

If the judge program works well, the language is validated. If it doesn't, the judge's own failures reveal what's missing. This is the self-referential payoff: the system's own programs evaluate the system's programs.

The vocabulary evolution loop is the mechanism by which the language improves itself: run programs, judge adherence, discover patterns, promote to vocabulary, run again. The language evolves from empirical evidence, seeded by engineering intuition.
