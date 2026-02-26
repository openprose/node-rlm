# Standard Library Catalog

Quick reference for all proposed `lib/` components. Each is a `.md` program node with `kind: program-node` frontmatter. Domain-agnostic. Slot-based. Composable.

---

## Composites (`lib/composites/`)

Multi-agent structural patterns. The composing parent calls a composite as one component. The composite manages internal multi-polar dynamics. Children never know they are part of a composite.

| Name | Description | Slots | Use When |
|------|-------------|-------|----------|
| `worker-critic` | Work, evaluate, retry until accepted | `worker`, `critic` | Quality matters more than speed; task has checkable success criteria |
| `proposer-adversary` | Propose, then attack the proposal; parent decides | `proposer`, `adversary` | Stress-testing solutions; adversarial structure (security, robustness) |
| `observer-actor-arbiter` | Actor acts, observer watches independently, arbiter decides next step | `actor`, `observer`, `arbiter` | Actor's self-assessment is unreliable; actions have side effects needing independent verification |
| `ensemble-synthesizer` | K agents work independently, synthesizer merges by reasoning about disagreements | `ensemble_member`, `synthesizer` | Ambiguous tasks with multiple valid interpretations; distinguishing uncertainty from difficulty |
| `dialectic` | Thesis and antithesis argue; disagreement IS the output | `thesis`, `antithesis` | Genuinely two-sided questions; premature consensus is dangerous; design space exploration |
| `witness` | Two agents independently observe same data; discrepancies flag ambiguity | `witness_a`, `witness_b` | Unreliable perception (noisy data, visual parsing); distinguishing "objectively unclear" from "misread" |
| `ratchet` | Advancer proposes, ratchet certifies; certified progress is never rolled back | `advancer`, `ratchet` | Irreversible consequences; expensive rollbacks; progress must be trustworthy |

---

## Roles (`lib/roles/`)

Single-agent reusable behaviors. Fill slots in composites or stand alone as delegation targets.

| Name | Description | Input (via brief) | Use When |
|------|-------------|-------------------|----------|
| `critic` | Evaluate result against criteria; accept/reject with reasoning | Result, acceptance criteria, original task | Filling `critic` slot; standalone quality gate before returning |
| `summarizer` | Compress large context preserving key information | Content, what to preserve (facts, decisions, questions) | Context too large for brief; curation between delegation rounds |
| `classifier` | Categorize an item given categories and criteria | Item, category set with descriptions, disambiguation rules | Routing decisions; triage; labeling |
| `verifier` | Check result against formal constraints (correctness, not quality) | Result, constraints as assertions or declarative rules | Schema conformance; invariant checks; filling `ratchet` slot with formal criteria |
| `extractor` | Pull structured data from unstructured input given a target schema | Unstructured input, target schema (fields, types) | Parsing tool output; ETL from natural language; filling `&`-state from raw observations |

---

## Controls (`lib/controls/`)

Delegation flow patterns. Wrap other components to add iteration, parallelism, or gating.

| Name | Description | Slots | Use When |
|------|-------------|-------|----------|
| `retry-with-learning` | Retry component with failure analysis passed to each subsequent attempt | `target` | Task likely succeeds with different approach; failures are informative |
| `progressive-refinement` | Iteratively improve through delegation rounds until quality threshold | `refiner`, `evaluator` | Incremental improvement is possible and measurable; first draft unlikely to meet bar |
| `map-reduce` | Split input, delegate chunks, merge results | `mapper`, `reducer` | Naturally partitionable tasks; large input with independent subtasks |
| `pipeline` | Sequential transformation; each stage sees only predecessor's output | `stage_1` ... `stage_N` | Task decomposes into sequential transformations; isolation between stages matters |
| `gate` | Check before delegating; fail-fast | `guard`, `target` | Delegation is expensive; preconditions should be checked cheaply first |

---

## Drivers (`lib/drivers/`) and Profiles (`lib/profiles/`)

Moved from `plugins/drivers/` and `plugins/profiles/`. No new content. See `lib/drivers/` for the full list of 22 model-specific reliability patches and `lib/profiles/` for model-to-driver mappings.

---

## Notes

- **Starting vocabulary.** The judge (BACKPRESSURE.md) evolves this library from empirical evidence. Unused components get retired. Recurring trace patterns get promoted.
- **Program-local shadows library.** If `programs/arc3/critic.md` exists, it overrides `lib/roles/critic.md` for that program.
- **Slots are filled by the parent.** The composing parent writes component names to `&compositeState` before delegating to a composite. The composite reads slot assignments and delegates accordingly.
- **Not a closed set.** A model that invents a structural pattern not in this library is doing the right thing. The library is a seed, not a cage.
