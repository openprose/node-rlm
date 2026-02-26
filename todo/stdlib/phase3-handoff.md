# Phase 3 Handoff: Standard Library Components

## What was done

Wrote 17 `.md` program-node files across three directories:

### lib/composites/ (7 files)

| File | Slots | Pattern |
|------|-------|---------|
| `worker-critic.md` | worker, critic | Work-evaluate retry loop |
| `proposer-adversary.md` | proposer, adversary | Propose-attack, parent decides |
| `observer-actor-arbiter.md` | actor, observer, arbiter | Independent observation of actor's outcomes |
| `ensemble-synthesizer.md` | ensemble_member, synthesizer | K independent agents, merge by disagreement reasoning |
| `dialectic.md` | thesis, antithesis | Multi-round argument, tension is the output |
| `witness.md` | witness_a, witness_b | Dual independent observation, discrepancies flag ambiguity |
| `ratchet.md` | advancer, ratchet | Monotonic certified progress |

### lib/roles/ (5 files)

| File | Role | Contract |
|------|------|----------|
| `critic.md` | leaf | Accept/reject with structured reasoning |
| `summarizer.md` | leaf | Compress preserving specified information |
| `classifier.md` | leaf | Categorize given categories and criteria |
| `verifier.md` | leaf | Check formal constraints (correctness, not quality) |
| `extractor.md` | leaf | Structured data from unstructured input |

### lib/controls/ (5 files)

| File | Slots | Pattern |
|------|-------|---------|
| `retry-with-learning.md` | target | Retry with full failure history in each brief |
| `progressive-refinement.md` | refiner, evaluator | Iterative improvement until score threshold |
| `map-reduce.md` | mapper, reducer | Split, fan-out, merge |
| `pipeline.md` | (stages array) | Sequential transformation, stage isolation |
| `gate.md` | guard, target | Binary proceed/block before expensive delegation |

## Design decisions

1. **Composites and controls use `&compositeState` / `&controlState`.** The parent writes slot assignments and configuration to shared state before delegating to the library component. The component reads slot names from state and delegates to the named components.

2. **Illustrative JavaScript in delegation patterns.** Each composite and control includes a delegation loop in JavaScript showing the structural flow. This is illustrative — the model may rewrite it. But the structure (who delegates to whom, what information flows where) is the contract.

3. **Roles have no `&`-state.** They receive everything via the brief and return everything via `return()`. Stateless by design — the parent manages state.

4. **Witness composite performs its own diff.** Rather than delegating the diff to a third component, the coordinator compares the two reports itself. This keeps the pattern at two slots. A parent that wants a more sophisticated diff can use a pipeline: witness -> extractor.

5. **Pipeline uses a `stages` array instead of named slots.** The number of stages varies per use. The parent provides an ordered array of component names rather than fixed slot names.

6. **Progressive-refinement vs. worker-critic.** Explicitly differentiated in the notes of both files. Progressive-refinement accumulates improvement with a continuous score. Worker-critic is binary accept/reject. Both are useful; they solve different problems.

## What was NOT done

- **No engine changes.** These files are prose programs. The engine does not need to know about `slots` or `&compositeState`. The model reads the program and does what it says.

- **No `loadLib()` function yet.** Workstream 1 (directory restructure) must land the engine-side name resolution that scans `lib/` and registers components. These files are ready for that integration.

- **No integration tests.** These components need a non-ARC program that composes them to validate the pattern. A simple test program (e.g., "research a question using worker-critic with summarizer") would be the right first exercise.

## Removed

- `.gitkeep` files from `lib/composites/`, `lib/roles/`, `lib/controls/`.

## Verified

- `npx tsc --noEmit` passes (these are .md files, no TS impact).

## Next steps

1. **Workstream 1** (directory restructure) — lands `loadLib()` and the name resolution pipeline so these components are actually discoverable at runtime.
2. **Workstream 2** (rename app to use) — these files already use `{ use: "name" }` syntax throughout.
3. **Integration test** — write a small program that composes library components to solve a task. Validates that the slot-filling convention works and the contracts are satisfiable.
4. **Judge evaluation** — once the judge program exists, run it against traces from library-composed programs to see which components are actually useful and which need revision.
