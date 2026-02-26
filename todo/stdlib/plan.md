# Standard Library Plan

Three workstreams. The first two are mechanical refactors. The third is the real work.

## Workstream 1: Directory Restructure

### Current layout

```
plugins/
  drivers/          -- model-specific reliability patches (22 files)
  apps/             -- task architectures, legacy flat files (16 files)
  profiles/         -- model-to-driver mappings (1 file)
  programs/         -- multi-file compositions
    arc3/           -- root.md + 3 nodes
    arc2-compound/  -- root.md + 2 nodes
```

`apps/` is dead weight. It holds the pre-program era's flat task architectures -- single .md files that predate the composition model. The program system (`programs/`) superseded them. Nothing in the engine requires `apps/` except `loadPlugins()` and `loadStack()`, which are themselves legacy paths used only by non-program eval runs and the CLI's `--app` flag.

`drivers/` and `profiles/` are reusable infrastructure. They belong in `lib/` alongside the new standard library components.

### New layout

```
programs/               -- domain-specific compositions (what you RUN)
  arc3/
  arc2-compound/
  judge/                -- (future: the backpressure judge from BACKPRESSURE.md)

lib/                    -- reusable components (what you BUILD WITH)
  composites/           -- multi-agent structural patterns
  roles/                -- single-agent reusable behaviors
  controls/             -- delegation flow patterns
  drivers/              -- model-specific patches (moved from plugins/drivers/)
  profiles/             -- model-to-driver mappings (moved from plugins/profiles/)
```

`plugins/apps/` is archived, not moved. These files are historical artifacts.

### What moves where

| Source | Destination | Notes |
|--------|-------------|-------|
| `plugins/programs/arc3/` | `programs/arc3/` | Direct move |
| `plugins/programs/arc2-compound/` | `programs/arc2-compound/` | Direct move |
| `plugins/drivers/*.md` | `lib/drivers/*.md` | Direct move, all 22 files |
| `plugins/profiles/*.md` | `lib/profiles/*.md` | Direct move |
| `plugins/apps/*.md` | `archive/apps/*.md` | Dead code. Archive, don't delete. |

After the move, `plugins/` is deleted entirely.

### Code changes

**`src/plugins.ts`** -- The central file. Every path constant and directory reference changes.

```
DEFAULT_PLUGINS_DIR  ->  split into DEFAULT_LIB_DIR and DEFAULT_PROGRAMS_DIR
                         DEFAULT_LIB_DIR = resolve(..., "../../lib")
                         DEFAULT_PROGRAMS_DIR = resolve(..., "../../programs")
```

Affected functions:

- `loadPlugins(names, subdir, pluginsDir)` -- `subdir` is "drivers" or "apps". After restructure, "drivers" resolves to `lib/drivers/`. The "apps" subdir is removed (legacy path deleted or throws with a migration message).
- `loadProfile(name, pluginsDir)` -- resolves to `lib/profiles/`.
- `detectProfile(model, pluginsDir)` -- resolves to `lib/profiles/`.
- `loadProgram(name, pluginsDir)` -- resolves to `programs/{name}/`.
- `loadStack(options)` -- references both `loadPlugins` (drivers) and `loadPlugins` (apps). The `app` option on `loadStack` is removed; programs are the only path now.

The `pluginsDir` optional parameter on every function becomes `libDir` or `programsDir` as appropriate. This is a breaking change to the public API of `plugins.ts`, but nothing outside this repo consumes it.

**`src/cli.ts`** -- Does not reference plugins paths directly (delegates to `loadStack`). No path changes needed. But if the `--app` CLI flag is removed (see workstream 2), the CLI simplifies.

**`src/rlm.ts`** -- No path references. Only touches `childApps` (see workstream 2).

**`src/system-prompt.ts`** -- No path references. Documents `app` in the system prompt (see workstream 2).

**`eval/run.ts`** -- Heavy consumer.
- Line 39: `import { loadStack, loadPlugins, loadProgram } from "../src/plugins.js"` -- import paths don't change (same module), but function signatures change.
- Line 113: `--program <name>` help text says `plugins/programs/<name>/` -- update to `programs/<name>/`.
- Lines 685-690: `loadProgram(args.program)` -- works if `loadProgram` internals change.
- Lines 700-702: `loadStack({ app: ... })` -- see workstream 2.
- Lines 727-731: `loadPlugins([name], "apps")` -- the legacy `--child-apps` CLI path. Remove or migrate.

**`eval/harness.ts`** -- References `childApps` in its config interface. No direct path references.

**`test/plugins.test.ts`** -- Tests `loadPlugins`, `loadProfile`, `detectProfile`, `loadStack`. Every test that passes a subdir or expects a path structure needs updating. This is the most tedious file.

**Documentation** -- `LANGUAGE.md` line 429 says programs live in `plugins/programs/{name}/`. Update to `programs/{name}/`. `CONTAINER.md` lines 103, 107, 109, 111 reference `plugins/programs/` and `src/plugins.ts` function names. Update all. `README.md` line 171 references `app:`.

### Execution order

1. Create `programs/` and `lib/` directories.
2. Move files (git mv to preserve history).
3. Update `src/plugins.ts` paths and function signatures.
4. Update `eval/run.ts` and `eval/harness.ts`.
5. Update `test/plugins.test.ts`.
6. Update documentation (LANGUAGE.md, CONTAINER.md, README.md).
7. Delete `plugins/`.
8. Run tests, run one eval to verify.

### Name resolution: program-local then lib

After the restructure, when an agent calls `rlm("query", ctx, { use: "worker-critic" })`, the engine resolves the name in this order:

1. **Current program's `childApps` dictionary** -- components declared in the program's own directory (e.g., `programs/arc3/oha.md`). These are loaded by `loadProgram()` and registered by both full name and short filename.
2. **`lib/` standard library** -- components in `lib/composites/`, `lib/roles/`, `lib/controls/`. The engine scans these directories at startup and registers them as a fallback dictionary.

Program-local components shadow library components. If `programs/arc3/` has a `critic.md`, it overrides `lib/roles/critic.md` for that program. This is the same resolution principle as local imports shadowing global packages.

Implementation: `loadProgram()` returns `childApps` as today. A new `loadLib()` function returns `libComponents`. The engine merges them: `{ ...libComponents, ...childApps }`. Program-local wins.

---

## Workstream 2: Rename `app` to `use`

### Rationale

`app` is a vestige of the pre-program era when "apps" were standalone task architectures. In the composition model, these are components. The call `rlm("query", ctx, { app: "oha" })` reads as "run the oha application." The call `rlm("query", ctx, { use: "oha" })` reads as "use the oha component." `use` is shorter, clearer, and matches the composition vocabulary: you USE components, you don't RUN applications.

### Backwards compatibility

Accept both `app` and `use` for one release cycle. If both are provided, `use` wins and a console warning fires. After one release, `app` becomes a hard error.

```typescript
// In the rlm sandbox function:
const componentName = rlmOpts?.use ?? rlmOpts?.app;
if (rlmOpts?.app && !rlmOpts?.use) {
  console.warn('[node-rlm] { app: "..." } is deprecated. Use { use: "..." } instead.');
}
```

### Touchpoints

**`src/rlm.ts`**

The sandbox `rlm()` function (line 538) accepts `rlmOpts?: { systemPrompt?, model?, maxIterations?, app? }`. Changes:
- Add `use?: string` to the options type.
- Resolve `componentName = rlmOpts?.use ?? rlmOpts?.app`.
- Replace all `rlmOpts.app` / `rlmOpts?.app` references with `componentName`.
- The `appName` field in the `delegation:spawn` event (line 599) becomes `componentName`.

The `RlmOptions` interface (line 26) has `childApps?: Record<string, string>`. Rename to `childComponents`. Accept both during transition:
```typescript
childComponents?: Record<string, string>;
/** @deprecated Use childComponents */
childApps?: Record<string, string>;
```

Internal resolution: `const components = opts.childComponents ?? opts.childApps ?? {}`.

**`src/system-prompt.ts`**

Line 79: the system prompt documents `{ systemPrompt?, model?, maxIterations?, app? }`. Change to `{ systemPrompt?, model?, maxIterations?, use? }`.

Line 80: `app loads a named program for the child.` becomes `use loads a named component for the child.`

**`src/plugins.ts`**

- `ProgramDefinition.childApps` becomes `ProgramDefinition.childComponents`. The `loadProgram` return type changes.
- `loadStack` options: `app?: string` becomes `use?: string` (or removed entirely -- see workstream 1).

**`eval/run.ts`**

Heavy consumer of `childApps`:
- Lines 80, 88, 155, 172, 200, 211, 330, 453, 455, 639-640, 685-690, 727-731, 777-778, 796.
- All `childApps` references become `childComponents`.
- The `--child-apps` CLI flag becomes `--child-components` (or removed if we kill the legacy apps path).

**`eval/harness.ts`**

- Lines 42, 128, 221, 229, 260: `childApps` in config interfaces and function calls. Rename to `childComponents`.

**`src/events.ts`** (if it exists)

The `delegation:spawn` event has `appName`. Rename to `componentName`.

**Program .md files**

Every `{ app: "name" }` in program prose becomes `{ use: "name" }`:
- `plugins/programs/arc3/level-solver.md` line 144: `{ app: "oha" }` -> `{ use: "oha" }`
- `plugins/programs/arc2-compound/orchestrator.md` lines 29, 108: `{ app: "arc2-solver" }` -> `{ use: "arc2-solver" }`
- `plugins/programs/arc3/root.md`: component catalog entries say `app: "game-solver"`, `app: "level-solver"`, `app: "oha"`. These become just `name:` references (they already have `name` -- the `app:` line in the catalog is redundant with the component's frontmatter name).

**Legacy apps .md files** -- in `plugins/apps/`. If archived (workstream 1), no changes needed. If still referenced, update them too.

**Test files**

`test/rlm.test.ts`:
- Lines 569-648: tests for `app:` option. Duplicate these as `use:` tests. Keep `app:` tests to verify backwards compat.
- Line 583, 607, 630, 648: `childApps` in test options. Rename to `childComponents`.

`test/plugins.test.ts`:
- Tests for `loadStack` with `app:` option. Update to `use:`.

**Documentation**

- `CONTAINER.md`: Multiple references to `{ app: "name" }` and `childApps`. Global find-replace.
- `LANGUAGE.md`: Component catalog entries use `app: "level-solver"`. Update.
- `README.md`: Line 171 uses `app:`. Update.
- `BACKPRESSURE.md`: No direct `app:` references (uses program names).

### Execution order

1. Add `use` alongside `app` in `src/rlm.ts` with deprecation warning.
2. Add `childComponents` alongside `childApps` in `RlmOptions`, `ProgramDefinition`, eval interfaces.
3. Update system prompt documentation.
4. Update all program .md files to use `{ use: "name" }`.
5. Update eval harness and run files.
6. Update tests: add `use:` tests, keep `app:` compat tests.
7. Update documentation.
8. In a later release: remove `app` and `childApps` entirely.

---

## Workstream 3: Standard Library -- Initial Contents

### Design principles

1. **These are prose programs, not code.** Every file is a `.md` with `kind: program-node` frontmatter and natural language instructions. The model executes them the same way it executes `oha.md` or `level-solver.md`.

2. **Slots, not hardcoded components.** Library components use slot names like `worker`, `critic`, `proposer` -- not specific component names. The composing parent fills slots by delegating to concrete components (from the program or from the library) with the role described by the slot.

3. **Domain-agnostic.** Library components know nothing about ARC, games, or any specific task. They describe structural patterns. Domain knowledge comes from the program that uses them.

4. **Starting vocabulary, not a closed set.** The judge (BACKPRESSURE.md) will evolve this library based on empirical evidence. Components that don't get used will be retired. Patterns that recur in traces will be promoted to library components. This is the seed.

5. **Composable.** A composite can use a role to fill a slot. A control can wrap a composite. Composition is recursive -- the same principle that makes RLM work at all.

6. **The child never knows it's part of a composite.** Multi-polarity is a parent-side concern. When `worker-critic.md` delegates to a "worker," the worker receives a brief and runs its own program. It does not know it will be critiqued. This preserves the delegation discipline from LANGUAGE.md: briefs are interfaces, not organizational charts.

### Name resolution

When an agent calls `rlm("query", ctx, { use: "worker-critic" })`:

1. Look up `"worker-critic"` in the current program's `childComponents` dictionary.
2. If not found, look up in the `libComponents` dictionary (loaded from `lib/`).
3. If not found, error with available component names.

Program-local components shadow library components. This lets a program override any library component with a domain-specific version while keeping the same name.

Library components are loaded at startup by scanning `lib/composites/`, `lib/roles/`, and `lib/controls/`. Each is registered by its short filename (e.g., `worker-critic` from `lib/composites/worker-critic.md`).

### lib/composites/ -- Multi-agent structural patterns

These are program nodes whose internal behavior is to delegate to N sub-agents in a specific structural relationship. The composing parent calls a composite as a single component. The composite handles the internal multi-polar dynamics.

Each composite declares **slots** -- named roles that must be filled. The composing parent fills slots by providing component names (or inline system prompts) for each role. Slot-filling is done through the brief or through `&`-state conventions.

#### worker-critic.md

One agent works, another evaluates. Retry loop until the critic accepts or budget exhausts.

```
role: coordinator
slots: [worker, critic]
```

- **Worker** receives the task brief and produces a result.
- **Critic** receives the result and the original brief. Returns accept/reject with reasoning.
- If rejected: worker receives the critique and tries again. The critique IS the learning signal.
- Max retries configurable via `&compositeState.max_retries` (default: 3).

Use when: quality matters more than speed. The task has checkable success criteria. A single agent might satisfice instead of optimize.

#### proposer-adversary.md

One agent proposes, another attacks. The composite returns both the proposal and the attack -- the parent decides.

```
role: coordinator
slots: [proposer, adversary]
```

- **Proposer** produces a proposal given the brief.
- **Adversary** receives the proposal and tries to find flaws, edge cases, or counterexamples.
- The composite does NOT resolve the tension. It returns `{ proposal, attack }`. The parent reasons about the disagreement.

Use when: the task has adversarial structure (security, robustness, debate). When you want to stress-test a solution before committing.

#### observer-actor-arbiter.md

Three-role composite. Actor acts, observer watches outcomes, arbiter decides next action based on the observer's report -- not the actor's self-assessment.

```
role: coordinator
slots: [actor, observer, arbiter]
```

- **Actor** executes the current plan.
- **Observer** independently analyzes the outcome (no access to actor's reasoning).
- **Arbiter** reads the observer's report and decides: continue, adjust, or abort.

Use when: the actor's self-assessment is unreliable (the "rationalizing agent" problem from TENETS.md). When actions have side effects that need independent verification.

#### ensemble-synthesizer.md

K agents work independently on the same task, then a synthesizer merges results by reasoning about disagreements.

```
role: coordinator
slots: [ensemble_member, synthesizer]
ensemble_size: K (from &compositeState.ensemble_size, default: 3)
```

- **Ensemble members** each receive the same brief and work independently.
- **Synthesizer** receives all K results. Its job is NOT majority voting -- it reasons about WHY results differ. Disagreements are signal about ambiguity or difficulty.
- Returns the synthesized result plus a confidence assessment.

Use when: the task is ambiguous and multiple valid interpretations exist. When you want to identify what's genuinely uncertain vs. what's just hard.

#### dialectic.md

Thesis and antithesis agents argue positions. Neither owns the answer. The disagreement IS the output.

```
role: coordinator
slots: [thesis, antithesis]
rounds: N (from &compositeState.rounds, default: 2)
```

- **Thesis** argues for a position.
- **Antithesis** argues against it.
- Multiple rounds: each agent sees the other's prior argument.
- The composite returns the full exchange. The parent extracts insight from the tension.

Use when: the question is genuinely two-sided. When premature consensus is more dangerous than unresolved tension. When exploring a design space.

#### witness.md

Two agents independently observe the same data. Discrepancies between their observations are signal about ambiguity.

```
role: coordinator
slots: [witness_a, witness_b]
```

- Both witnesses receive identical input.
- Each produces an independent observation report.
- The composite diffs the reports. Agreements are high-confidence. Discrepancies flag ambiguous or hard-to-interpret data.
- Returns `{ agreed, discrepancies, confidence }`.

Use when: perception is unreliable (noisy data, visual parsing, ambiguous text). When you need to distinguish "this is objectively unclear" from "my single agent misread it."

#### ratchet.md

Advancer proposes the next step, ratchet certifies or rejects. Progress is monotonic -- certified progress is never rolled back.

```
role: coordinator
slots: [advancer, ratchet]
```

- **Advancer** proposes the next incremental step.
- **Ratchet** evaluates: does this step maintain all invariants? Does it advance toward the goal? Is it reversible if needed?
- Certified steps are committed to `&compositeState.certified_progress`. Rejected steps are discarded with the reason.
- The advancer sees the reason for rejection and proposes a different step.

Use when: the task has irreversible consequences or expensive rollbacks. When incremental progress needs to be trustworthy (e.g., multi-step transformations, stateful interactions).

### lib/roles/ -- Single-agent reusable behaviors

These are leaf program nodes. Each defines a single reusable behavior with a clear contract. They fill slots in composites or stand alone as delegation targets.

#### critic.md

Evaluate a result against provided criteria. Returns accept/reject with structured reasoning.

```
role: leaf
```

- Input (via brief): the result to evaluate, the criteria for acceptance, and the original task description.
- Output: `{ verdict: "accept" | "reject", reasoning: string, issues: string[], suggestions: string[] }`.
- The critic does NOT fix the result. It identifies problems. Fixing is the worker's job.

Use when: filling the `critic` slot in `worker-critic`. Standalone quality gate before returning a result.

#### summarizer.md

Compress large context into concise summary preserving key information.

```
role: leaf
```

- Input (via brief): the content to summarize, and what to preserve (key facts, decisions, open questions).
- Output: a summary string. Length proportional to information density, not input length.
- Contract: no information in the output that was not in the input. No fabrication.

Use when: context is too large to pass in a brief. Between delegation rounds where accumulated state needs compacting. Curation step after a long-running child returns.

#### classifier.md

Categorize an item given a set of categories and criteria.

```
role: leaf
```

- Input (via brief): the item to classify, the category set with descriptions, and any disambiguation rules.
- Output: `{ category: string, confidence: 0..1, reasoning: string }`.
- If the item fits multiple categories: returns the best fit with reasoning about why alternatives were rejected.
- If the item fits no category: returns `"uncategorized"` with reasoning.

Use when: routing decisions (which component should handle this subtask?). Triage. Labeling.

#### verifier.md

Check a result against formal constraints. Different from critic: checks correctness, not quality.

```
role: leaf
```

- Input (via brief): the result, and the constraints (as executable assertions or declarative rules).
- Output: `{ valid: boolean, violations: string[], checks_passed: string[] }`.
- The verifier runs checks programmatically where possible (writes code to test assertions).
- Does NOT assess whether the result is "good" -- only whether it satisfies stated constraints.

Use when: the result has formal properties that can be checked (schema conformance, invariant maintenance, mathematical properties). Filling a `ratchet` slot when the certification criteria are formal rather than qualitative.

#### extractor.md

Pull structured data from unstructured input given a target schema.

```
role: leaf
```

- Input (via brief): the unstructured input (text, log output, raw data), and the target schema (field names, types, descriptions).
- Output: the structured data conforming to the schema, plus a confidence assessment per field.
- Fields that cannot be confidently extracted are marked as `null` with a reason, not hallucinated.

Use when: parsing unstructured tool output into state variables. ETL from natural language into data structures. Filling `&`-state schemas from raw observations.

### lib/controls/ -- Delegation flow patterns

These are coordinator program nodes that implement control flow patterns using `rlm()` delegation. They wrap other components, adding iteration, parallelism, or gating logic.

#### retry-with-learning.md

Retry a component, passing failure analysis to each subsequent attempt. Each retry is different because it receives the analysis of all prior failures.

```
role: coordinator
slots: [target]
max_retries: N (from &controlState.max_retries, default: 3)
```

- First attempt: delegate to target with the original brief.
- On failure: analyze what went wrong. Construct an enriched brief with: original task, what was tried, why it failed, what to try differently.
- Each retry receives the full failure history, not just the last attempt.
- Returns on first success or after max retries with the best attempt and failure analysis.

Use when: the task is likely to succeed with a different approach. When failures are informative (not just noise). Wraps any component to add retry semantics.

#### progressive-refinement.md

Iteratively improve a result through multiple delegation rounds until a quality threshold is met.

```
role: coordinator
slots: [refiner, evaluator]
max_rounds: N (from &controlState.max_rounds, default: 3)
threshold: T (from &controlState.threshold, default: 0.8)
```

- Round 1: refiner produces initial result.
- Evaluator scores the result (0..1) and provides specific improvement suggestions.
- If score >= threshold: return.
- Otherwise: refiner receives the result, the score, and the suggestions. Produces improved result.
- Repeat until threshold met or max rounds exhausted.

Use when: incremental improvement is possible and measurable. When the first draft is unlikely to meet quality bar but iterative polishing works. Different from worker-critic: progressive-refinement accumulates improvement; worker-critic is binary accept/reject.

#### map-reduce.md

Split input, delegate chunks in parallel, merge results.

```
role: coordinator
slots: [mapper, reducer]
```

- The map-reduce coordinator splits the input according to a partitioning strategy (described in the brief).
- Delegates each chunk to a mapper instance.
- Collects all mapper outputs, delegates to reducer for merge.
- The reducer reasons about how to combine results, handling conflicts and overlaps.

Use when: the task is naturally partitionable (large input, independent subtasks). When parallelism at the delegation level adds value (note: `rlm()` calls are awaited sequentially today -- true parallelism requires `Promise.all`, which the sandbox supports).

#### pipeline.md

Sequential transformation through multiple components. Each stage sees only its predecessor's output, not the original input.

```
role: coordinator
slots: [stage_1, stage_2, ..., stage_N]
stages: (from &controlState.stages, an ordered list of component names)
```

- Stage 1 receives the original brief.
- Stage 2 receives stage 1's output as its brief.
- Stage N receives stage N-1's output.
- The pipeline coordinator does not curate between stages -- it is a pure pass-through. If curation is needed, insert a role (e.g., summarizer) as an explicit stage.

Use when: the task decomposes into sequential transformations. When isolation between stages is important (each stage operates on a clean interface, not accumulated context).

#### gate.md

Run a check before allowing delegation to proceed. Fail-fast pattern.

```
role: coordinator
slots: [guard, target]
```

- Guard receives the brief and decides: proceed or block.
- If proceed: delegate to target with the original brief.
- If block: return immediately with the guard's reason. No delegation happens.
- The guard's output is a `{ proceed: boolean, reason: string }`. The gate does not modify the brief based on the guard's output -- it is a binary gate, not a filter.

Use when: delegation is expensive and preconditions should be checked cheaply first. When certain inputs should never reach a component (validation, authorization, sanity checks).

### lib/drivers/ and lib/profiles/

These already exist. Move from `plugins/drivers/` and `plugins/profiles/` as described in workstream 1. No new files needed.

---

## Implementation Notes

### Frontmatter conventions for library components

Library components use `kind: program-node` just like program-specific nodes. They differ only in that they are domain-agnostic and declare **slots** instead of hardcoded delegation targets.

```yaml
---
name: worker-critic
kind: program-node
role: coordinator
version: 0.1.0
slots: [worker, critic]
delegates: []           # filled at runtime by the composing parent
prohibited: []
---
```

The `slots` field is new. It declares what the component needs but does not specify which concrete components fill those slots. The composing parent fills slots by passing component names in the brief or in `&compositeState`.

Slot-filling convention:

```javascript
// Parent fills slots before delegating to the composite
__compositeState = {
  worker: "oha",        // use the OHA component as the worker
  critic: "critic",     // use the lib/roles/critic component
  max_retries: 3,
  task_brief: "..."     // the actual task to pass to the worker
};
const result = await rlm("Execute worker-critic pattern", null, { use: "worker-critic" });
```

The composite reads `__compositeState`, delegates to the named components, and manages the multi-polar interaction.

### Ordering

Workstream 2 (rename) should land before workstream 3 (library). The library components will use `{ use: "name" }` from the start. No reason to write them with the deprecated syntax.

Workstream 1 (restructure) can be done in parallel with workstream 2. The restructure moves files and updates paths; the rename changes parameter names. They touch overlapping files but different lines.

Suggested sequence:
1. Workstream 1 + 2 in a single PR (they are both mechanical refactors).
2. Workstream 3 in a follow-up PR (the creative work).

### What success looks like

The restructure is successful when all tests pass and one eval run completes with the new paths.

The rename is successful when `{ use: "oha" }` works, `{ app: "oha" }` works with a deprecation warning, and all program .md files use the new syntax.

The standard library is successful when a NEW program (not arc3, not arc2-compound) can compose library components to solve a task without writing any new structural patterns from scratch. The library provides vocabulary; the program provides domain knowledge.

### What this is NOT

This is not a framework. There is no `CompositeBase` class. No `AbstractRole`. No registration decorators. These are prose files that the model reads and executes. The "framework" is the RLM programming language (LANGUAGE.md). The library is a set of reusable programs written in that language.

The library is also not exhaustive. It is a starting vocabulary. The judge (BACKPRESSURE.md) will prune components that don't get used and promote patterns that recur in traces. If the library has 17 composites that nobody uses, it failed. If it has 4 composites that programs reach for repeatedly, it succeeded.
