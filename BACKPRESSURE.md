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

### Evolving the vocabulary

The composition vocabulary (`direct`, `coordinated`, `exploratory`, `targeted`) is a scaffold, not a cage. It's a seed -- useful starting patterns based on engineering intuition, like SFT before RLHF. The judge's deepest function is to evolve this vocabulary empirically:

1. **Detect recurring patterns.** Across many traces, identify composition behaviors that succeed repeatedly -- patterns the model discovers on its own that aren't in the current vocabulary.
2. **Name and promote.** When a pattern recurs reliably, give it a name and add it to the vocabulary. The vocabulary grows from evidence, not intuition.
3. **Demote and retire.** When a named pattern consistently fails or goes unused, remove it. The vocabulary shrinks when patterns stop paying for themselves.
4. **Discover missing axes.** The current vocabulary has two axes (topology, brief richness). The judge may discover that successful runs differ on dimensions we haven't named yet -- and those dimensions become new axes.

The hand-designed vocabulary is a starting point. The judge is the feedback loop that turns it into an empirically-grounded vocabulary. This is the bitter-lesson-compatible path: seed with human intuition, refine with data.

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

The meta-critic is the most important component. It's the one that looks beyond "did the model follow the program" to "should the program have been different." Its vocabulary observations feed the evolution loop.

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

1. **Expose the observer to the sandbox.** A parent calling `rlm()` with `observed: true` gets a scoped observer that receives the child's events synchronously during execution. No new engine primitive needed beyond a sandbox binding.

2. **`observed` as a composition modifier.** A third axis on the composition vocabulary: delegation mode. `observed` means the parent monitors the child during execution, not just before (brief) and after (curation). Other delegation modes: `bounded` (hard-kill after budget), `speculative` (fan-out, take first result), `checkpointed` (snapshot at each iteration, resume from any point).

3. **Oversight-rlm.** The judge program (or a simplified version) runs as an oversight agent alongside the target. It receives events in real-time via the observer binding, writes assessments to shared `&`-state, and the target reads them between iterations. The parent composes both the target and the oversight agent.

These are parent-side concerns. The child never knows it's being observed. This preserves "Trust the Model" -- the child runs its program faithfully. The parent manages the composition.

## Relationship to the language

The judge doesn't require language extensions. It's expressed entirely in existing constructs: contracts, state schemas, delegation patterns, component catalogs. The judge IS the test of whether the language is expressive enough.

If the judge program works well, the language is validated. If it doesn't, the judge's own failures reveal what's missing. This is the self-referential payoff: the system's own programs evaluate the system's programs.

The vocabulary evolution loop is the mechanism by which the language improves itself: run programs, judge adherence, discover patterns, promote to vocabulary, run again. The language evolves from empirical evidence, seeded by engineering intuition.
