# ARC-AGI-2 Compound Learning: Implementation Plan

## Thesis

Instead of running each ARC-AGI-2 task as an independent fresh RLM, a single
orchestrator RLM processes all tasks sequentially, accumulating a library of
discovered primitives, strategies, and anti-patterns. Knowledge compounds --
task N benefits from learnings on tasks 1..N-1. This is test-time cross-task
transfer learning in-context.

This is what an RLM IS: an intelligent computer that programs itself. Each
task is an opportunity to discover and encode new primitives through execution.
The compound session is one long computation where the machine builds its own
instruction set, and the trace of that session is the research artifact
showing knowledge accumulation over time.

---

## Core Design Principle: Pass by Reference, Not by Value

The sandbox IS the shared memory. The conversation is the control plane.

The orchestrator maintains all shared state on `globalThis` -- the library,
the task data, the task log. Children read what they need from the environment
at the start of their execution. Nothing is serialized into child system
prompts or copied into messages.

```javascript
// Orchestrator sets up the environment (once, at the start):
globalThis.__arcLibrary = { primitives: {}, strategies: [], antiPatterns: [], taskLog: [] };
globalThis.__arcTasks = {};         // keyed by task ID
globalThis.__arcCurrentTask = null; // ID of the task being solved

// Child reads from the environment (at the start of its execution):
const library = globalThis.__arcLibrary;
const task = globalThis.__arcTasks[globalThis.__arcCurrentTask];
const priorResults = library.taskLog;
```

This saves enormous context. The orchestrator's conversation history stays
thin because it is pointing at environment objects, not copying their contents
into messages. The orchestrator's job is to maintain the "object scaffold" --
keeping track of WHERE things are in the environment, not carrying the entire
VALUE of all learnings in its own context.

This is a direct application of the tenet "The Sandbox IS the Tool": the
shared sandbox is the knowledge base, the communication channel, AND the
execution environment. No external tools needed.

---

## Architecture: Delegation (Orchestrator + Solver + Synthesizer)

Three plugins at two depth levels:

```
Orchestrator (depth 0)  -- plugins/apps/arc-compound-orchestrator.md
  |-- Solver Child (depth 1)      -- plugins/apps/arc-compound-solver.md
  +-- Synthesis Child (depth 1)   -- plugins/apps/arc-compound-synthesizer.md
```

The three plugin files ARE the compound learning algorithm, expressed in
natural language. This is the tenet "Plugins are Programs Written in Prose" --
complex control flow, state management, and composition are all expressed in
prose, and the model self-configures into the structures these programs
describe.

### Flow

The orchestrator plugin describes this entire flow. The harness does NOT
encode any of it.

```
SETUP (orchestrator, iteration 0):
  - Read all task IDs from globalThis.__arcTasks (pre-loaded by harness)
  - Initialize globalThis.__arcLibrary with empty shape
  - Plan task ordering (default: dataset order; later: easy-first)

MAIN LOOP (orchestrator, one task per cycle):
  for each task T:
    1. Set globalThis.__arcCurrentTask = T.id
    2. Delegate to Solver Child:
       await rlm("Solve the current ARC task", undefined, {
         app: "arc-compound-solver",
         maxIterations: 18
       })
       - Solver reads task + library from globalThis (by reference)
       - Solver writes discoveries back to globalThis.__arcLibrary.taskLog
       - Returns: { solved, confidence, answer }
    3. Read solver's result and task log entry from globalThis
    4. Delegate to Synthesis Child:
       await rlm("Synthesize learnings from the last task", undefined, {
         app: "arc-compound-synthesizer",
         maxIterations: 4
       })
       - Synthesizer reads taskLog + library from globalThis (by reference)
       - Synthesizer mutates globalThis.__arcLibrary in place
       - Returns: summary of changes
    5. Log outcome, advance to next task

PASS@2 (orchestrator, after all tasks):
  - Collect task IDs where self-verification FAILED
  - For each failed task, repeat steps 1-4 with the full accumulated library
  - Best answer per task (across both passes) is the final submission

RETURN:
  - Build answer object: { [taskId]: answer }
  - return(JSON.stringify(answers))
```

### Why Delegation

- **Context isolation.** Each child gets a fresh conversation history. The
  solver's 18 iterations of reasoning about one task don't pollute the
  orchestrator's context or the next task's solver.
- **Pass by reference.** Children read from and write to `globalThis`. The
  orchestrator's conversation only contains lightweight delegation calls and
  result summaries -- never the full library or task data.
- **Cost-aware budgets.** The orchestrator calibrates iteration budgets to the
  subtask: solver gets 15-20 iterations (the hard work), synthesizer gets 3-5
  iterations (quick distillation). This is the tenet "Cost-Aware Delegation."
- **Partial failure containment.** A child crashing doesn't kill the session.
  The orchestrator catches the error, logs it, and moves on.
- **Model flexibility.** Children can use different models if needed (cheaper
  model for synthesis, stronger model for hard tasks).

---

## The Library Artifact

### Structure

The library starts with **shape only** -- keys that tell the model what types
of knowledge to look for, but no pre-seeded content. The model discovers
everything through execution.

```javascript
globalThis.__arcLibrary = {
  // Code primitives: actual JS functions the solver can call directly.
  // These are discovered by solvers and promoted by the synthesizer.
  primitives: {},
  // e.g., { rotate90: function(grid){...}, floodFill: function(grid, r, c){...} }

  // Strategies: heuristic rules discovered from solving tasks.
  strategies: [],
  // e.g., [{ type: "tiling", approach: "find period with modular arithmetic", successRate: "3/4" }]

  // Anti-patterns: approaches that were tried and failed.
  antiPatterns: [],
  // e.g., ["brute-force color mapping wastes iterations on spatial tasks"]

  // Task log: what was tried on each task, what worked, what was discovered.
  // Solvers WRITE to this. Synthesizers READ from this.
  taskLog: [],
  // e.g., [{ id: "0934a4d8", solved: true, iters: 8, approach: "symmetry detection",
  //          codePaths: ["tested all 8 symmetries via compose(reflect, rotate)"],
  //          discoveries: [{ name: "reflectH", code: "...", generalized: true }] }]
};
```

### How It's Shared

The sandbox (`JsEnvironment`) is shared across all depths within a single
`rlm()` invocation tree. Functions defined on `globalThis` by the
orchestrator or a child are immediately available to all subsequent children.
No serialization. No copying. This already works -- it is the core mechanism.

The solver calls `globalThis.__arcLibrary.primitives.rotate90(grid)` directly.
The synthesizer reads `globalThis.__arcLibrary.taskLog` and rewrites the
library in place. The orchestrator never touches the library contents -- it
only manages the control flow.

### Library Growth Management

The Synthesis Child is responsible for pruning. After each task:
- Promote discoveries that generalize (used successfully on 2+ tasks)
- Demote/remove task-specific hacks that didn't transfer
- Merge similar primitives (e.g., two rotation functions into one parameterized version)
- Keep the library under a size budget (~50 primitives, ~20 strategies)
- The budget is expressed in the synthesizer plugin, not hardcoded in the harness

---

## The Solver Child: Code-First Explorer

The solver is the workhorse. It should be HEAVILY oriented toward using
JavaScript to search for patterns -- not just reasoning about the grid
visually, but writing functions that statistically analyze grid properties.

This is a core competency of RLMs: write code, execute it, observe results,
compound learnings. The solver should spend its iteration budget running
experiments in code, not reasoning in prose.

### Solver Behavior (described in the plugin)

1. **Read the environment.** At the start of execution, read the current task
   and library from `globalThis`. Check if any library primitives or strategies
   are relevant.

2. **Analyze via code.** Write functions that:
   - Test all 8 symmetries (4 rotations x 2 reflections) on training pairs
   - Find repeating tile periods via modular arithmetic
   - Extract connected components and measure their properties
   - Compute color frequency histograms across input/output pairs
   - Diff input/output grids to isolate the transformation region
   - Test whether the transformation is a function of local neighborhoods

3. **Search across problems.** The solver doesn't just analyze its own task.
   It reads the task log from the environment to see what patterns appeared in
   prior tasks. If task 7 used "connected component extraction" and task 12
   looks structurally similar, the solver tries that approach first.

4. **Self-verify against ALL training pairs.** Before returning, apply the
   discovered transformation to every training input and compare against the
   expected output. This is the correctness signal -- no ground truth from the
   harness.

5. **Write discoveries to the environment.** Before returning, append a
   detailed entry to `globalThis.__arcLibrary.taskLog` with:
   - What approach worked (or didn't)
   - Any code that generalized
   - Structural properties of the task (symmetry type, grid dimensions, color count)

6. **Return the answer.** `return(JSON.stringify({ solved, confidence, answer }))`

### What the Solver Does NOT Do

- Spend iterations reasoning in prose about what the grid "looks like"
- Ask the harness for ground-truth feedback
- Serialize the library into its own context (it reads from `globalThis`)
- Manage the library (that's the synthesizer's job)

---

## The Synthesizer Child: Library Curator

The synthesizer runs after each task with a small budget (3-5 iterations).
Its job is to identify which of the solver's code-first explorations
generalized and save them to the environment for future children to reuse.

### Synthesizer Behavior (described in the plugin)

1. **Read the latest task log entry** from `globalThis.__arcLibrary.taskLog`.
2. **Evaluate discoveries for generality:**
   - Does this function apply to more than one task? (Check task log history)
   - Is this a special case of an existing primitive? (Merge)
   - Is this approach already in the anti-patterns? (Skip)
3. **Mutate the library in place** on `globalThis.__arcLibrary`:
   - Add new primitives as callable functions
   - Add new strategies as heuristic entries
   - Add new anti-patterns for approaches that failed
   - Prune entries that are subsumed or redundant
4. **Return a summary** of what changed (for the orchestrator's log).

The synthesizer does NOT solve tasks. It is a librarian, not a researcher.

---

## Scoring & Self-Verification

**No ground-truth feedback.** The orchestrator never learns the correct answer
from the harness. The harness scores answers after the entire compound session
returns -- the same way it scores independent tasks.

**Self-verification is the correctness signal.** The Solver Child must verify
its candidate answer against ALL training input/output pairs before returning.
If the discovered transformation maps every training input to its expected
output, the answer is very likely correct. If not, the child knows it failed
and reports `solved: false`.

**Pass@1 -> Pass@2 flow:**
1. Pass@1: attempt all tasks in order, building the library
2. Tasks where self-verification succeeded -> answer is final
3. Tasks where self-verification failed -> retry on pass@2 with the full
   accumulated library
4. Best answer per task (across both passes) is the final submission

This aligns with the ARC Prize rules (pass@2 allowed) and requires no
ground-truth feedback at any point. The model trusts itself to self-verify
and self-report -- per the tenet "Trust the Model."

---

## Iteration & Depth Budgets

### Per-Task Budget (Cost-Aware Delegation)

| Agent | Iterations | Rationale |
|-------|-----------|-----------|
| Solver Child | 15-20 | Full budget -- this is the hard work |
| Synthesis Child | 3-5 | Quick distillation -- read, evaluate, mutate |

### Orchestrator Budget

The orchestrator needs ~3 iterations per task (set up, delegate solver,
delegate synthesizer). For 20 tasks:

- Pass@1: ~60 orchestrator iterations + 20 solver + 20 synthesis delegations
- Pass@2: ~3 * N_failed orchestrator iterations + N_failed solver + synthesis
- Total orchestrator iterations: ~80-100

Because the orchestrator passes by reference (not by value), its per-iteration
context stays small regardless of library size. The orchestrator's
conversation is lightweight control flow, not data.

### Depth

- Start at **max-depth 2** (orchestrator=0, children=1)
- If per-task solve rate drops significantly vs. independent baseline,
  increase to max-depth 3 to allow solver sub-delegation

---

## What Needs to Change

### Harness Stays Clean

Per the tenet "Trust the Model": push complexity into the plugins, not the
engine. The harness changes are MINIMAL. The harness loads tasks into the
sandbox and wires up the benchmark mode. ALL the interesting logic -- task
ordering, library management, pass@1-to-pass@2 flow, synthesis -- lives in
the plugin markdown files.

If something can be expressed as a plugin instruction rather than a harness
feature, it MUST be a plugin instruction.

### New Files

| File | Purpose |
|------|---------|
| `plugins/apps/arc-compound-orchestrator.md` | The program. Task loop, library scaffold setup, pass@1/pass@2 flow, delegation calls. All in prose. |
| `plugins/apps/arc-compound-solver.md` | Solve one task via code-first exploration. Read library from env, self-verify, write discoveries to env. |
| `plugins/apps/arc-compound-synthesizer.md` | Curate the library. Read task log from env, promote/prune/merge, mutate library in place. |

### Modified Files

| File | Change |
|------|--------|
| `eval/datasets/arc.ts` | Add `loadArcCompoundBundle()` -- returns a SINGLE meta-task whose context is minimal (just a task-count note). All real task data is loaded into the sandbox via `setupSandbox`. |
| `eval/scoring.ts` | Add `arcCompoundScore()` -- parse the multi-task answer object, score each sub-task individually via `arcGridMatch`, return mean score. |
| `eval/run.ts` | Add `arc-compound` benchmark case. Wire: loader, scorer, `setupSandbox` (loads all tasks onto `globalThis.__arcTasks`), `globalDocs` (documents the sandbox shape). |
| `.github/workflows/eval.yml` | Add `arc-compound` to benchmark choices. |

### `setupSandbox` Implementation

This is the ONE piece of harness logic that is specific to compound mode.
It loads all task data onto `globalThis` so the orchestrator and children
can read it by reference:

```typescript
// In eval/run.ts, inside the arc-compound benchmark config:
setupSandbox: (metaTask) => {
  // metaTask.metadata.tasks contains all individual ARC tasks
  const tasks: Record<string, object> = {};
  for (const t of metaTask.metadata.tasks) {
    tasks[t.id] = JSON.parse(t.context);  // { train, test }
  }
  return {
    __arcTasks: tasks,
    __arcTaskIds: Object.keys(tasks),
    __arcLibrary: { primitives: {}, strategies: [], antiPatterns: [], taskLog: [] },
    __arcCurrentTask: null,
    __arcAnswers: {},  // orchestrator writes answers here
  };
},
```

The `globalDocs` string documents these globals so every agent at every depth
knows the sandbox shape:

```markdown
## ARC Compound Learning Environment

The following globals are available on `globalThis`:

- `__arcTasks` — Object keyed by task ID. Each value is `{ train, test }`.
- `__arcTaskIds` — Array of all task IDs in dataset order.
- `__arcLibrary` — The shared knowledge library: `{ primitives, strategies, antiPatterns, taskLog }`.
- `__arcCurrentTask` — ID of the task currently being solved (set by orchestrator).
- `__arcAnswers` — Object keyed by task ID, values are the predicted output grids.

Read from these. Write to `__arcLibrary` and `__arcAnswers`. Do not overwrite the task data.
```

### No Changes Needed

| File | Why |
|------|-----|
| `src/rlm.ts` | Delegation already works via `rlm()` calls within the sandbox |
| `src/environment.ts` | Sandbox sharing across depths already works |
| Core engine | No structural changes -- this is a harness + plugin effort |

---

## Plugin Composition Note

The current pattern for child delegation uses the `app` option on `rlm()`:

```javascript
await rlm("Solve the current ARC task", undefined, {
  app: "arc-compound-solver",
  maxIterations: 18,
});
```

This requires the child app to be pre-loaded via `--child-app` on the CLI
(or `childApps` in the harness config). The orchestrator plugin references
child apps by name; the harness ensures they're available.

This works but creates an implicit coupling: the orchestrator plugin mentions
app names that must be registered externally. A more elegant mechanism might
be for plugins to declare their child dependencies in frontmatter:

```yaml
---
name: arc-compound-orchestrator
kind: app
childApps: [arc-compound-solver, arc-compound-synthesizer]
---
```

And have the plugin loader auto-resolve them. This is NOT a prerequisite for
the compound learning feature -- flag it as a future improvement to the plugin
system.

---

## Context Window Arithmetic

Opus 4.6: 200K token context window.

**Orchestrator context growth per task (~1-2K tokens):**

Because the orchestrator passes by reference, it does NOT carry task data or
library contents in its conversation. Each task cycle adds only:
- Delegation call: ~200 tokens (just the `rlm()` call)
- Solver return value: ~200-400 tokens (solved/confidence/answer summary)
- Synthesis delegation: ~200 tokens
- Synthesis return: ~200-400 tokens (change summary)

This is dramatically smaller than the "pass by value" alternative, where
the orchestrator would serialize the entire library into each delegation.

**For 20 tasks:** ~20-40K tokens of orchestrator conversation history
+ ~5K system prompt = ~25-45K tokens. Comfortably within 200K.

**For 120 tasks:** ~120-240K tokens of conversation history. This pushes
against the limit. Batching (serialize library, start fresh orchestrator
session) may be needed. But 20 tasks fits easily.

**Each child conversation:** ~15-45K tokens (independent of orchestrator
context). Same as independent mode. The child reads task data from
`globalThis`, not from its system prompt.

---

## Benchmark Fairness

**Fair.** The system discovers reusable abstractions at test time, not from
pre-training. Humans solving ARC tasks sequentially build up the same kind of
transfer -- recognizing "this is another symmetry task" after seeing a few.
ARC's thesis is that the test measures fluid intelligence and Core Knowledge
prior discovery. A system that explicitly discovers these priors through
experience is demonstrating exactly what ARC was designed to measure.

This IS the RLM thesis: an intelligent computer that programs itself,
discovering and encoding primitives through execution. The compound session
is the machine bootstrapping its own capabilities in real time.

**Reporting:** Results should be labeled distinctly:
- "ARC-AGI-2 (compound, N tasks, dataset ordering, pass@2)"
- Include per-task scores + library state snapshots at each point
- Compare against same tasks run independently as control
- The trace of the compound session IS the research artifact

---

## Prototype Plan

### Phase 1: 20-Task Prototype

**Task set:** The 20-task subset from run-026 (65% baseline).

**Steps:**
1. Write the three plugin files (orchestrator, solver, synthesizer)
   - This is the bulk of the work. The plugins ARE the algorithm.
   - The orchestrator plugin describes the full control flow in prose.
   - The solver plugin describes the code-first exploration strategy.
   - The synthesizer plugin describes the library curation rules.
2. Add `loadArcCompoundBundle()` to `eval/datasets/arc.ts`
   - Returns a single meta-task. Minimal harness change.
3. Add `arcCompoundScore()` to `eval/scoring.ts`
   - Parse multi-task answer object, score each via existing `arcGridMatch`.
4. Wire `arc-compound` benchmark in `eval/run.ts`
   - `setupSandbox`, `globalDocs`, `childApps` config.
5. Run locally, analyze trajectory
   - Read the trace. The trace IS the record.
6. Compare per-task scores vs. independent baseline

**CLI:**
```bash
npx tsx eval/run.ts \
  --benchmark arc-compound \
  --model anthropic/claude-opus-4-6 \
  --app arc-compound-orchestrator \
  --child-app arc-compound-solver \
  --child-app arc-compound-synthesizer \
  --max-iterations 100 \
  --max-depth 2 \
  --max-tasks 1
```

Note: `--max-tasks 1` because the compound benchmark is ONE meta-task
containing all sub-tasks. The orchestrator plugin handles the inner loop.

### Phase 2: Scale to 120 Tasks

After Phase 1 validates the approach:
- Run on full 120-task eval set
- If orchestrator context grows too large, batch into 20-task windows
  with library serialization between batches
- Experiment with task ordering (easy-first, cluster by type)
- Batching is a plugin-level concern -- the orchestrator plugin can be
  updated to support batch boundaries without harness changes

---

## Open Questions (Remaining)

### To Validate Empirically

1. **Library quality vs. noise.** Will the library actually help on ARC-2's
   diverse tasks, or become a noisy collection of task-specific hacks? ARC-2
   tasks are much more heterogeneous than ARC-3 levels. The prototype will
   answer this. The synthesizer is the key -- its pruning discipline
   determines whether the library compounds or decays.

2. **Code-first solver effectiveness.** Will the solver actually write and
   run exploratory code, or fall back to prose reasoning? The plugin
   instructions must be emphatic about this. If needed, the plugin can
   include a "no prose reasoning" rule or require every iteration to contain
   a code block that executes something.

3. **Context window validation.** The arithmetic above is theoretical (and
   optimistic given pass-by-reference). Need to validate with actual runs
   that 20 tasks fit in one orchestrator session without context truncation.

4. **Ordering effects.** Dataset order may not be optimal. After the
   prototype, experiment with easy-first ordering (based on Phase 1 results)
   as a plugin-level optimization.

### Deferred Decisions

5. **Solver sub-delegation.** Start at depth 2. If per-task solve rate drops
   vs. baseline, increase to 3. This is a tuning knob, not an architectural
   decision.

6. **Batch boundaries for 120 tasks.** Design the batching mechanism after
   Phase 1 validates the core loop. Batching logic lives in the orchestrator
   plugin -- it serializes the library to `globalThis`, the harness starts a
   new session, the new orchestrator reads the library back.

7. **Cross-task pattern search scope.** How aggressively should the solver
   search prior task logs? Start with "check the last 5 tasks" and tune
   based on observed value vs. iteration cost.
