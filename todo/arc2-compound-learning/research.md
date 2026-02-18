# ARC-AGI-2 Compound Learning: Research & Design

## 1. Current Architecture

### How ARC-2 Tasks Flow Through the System

**Loading.** `eval/datasets/arc.ts` (`loadArcTasks`) reads the evaluation challenges and solutions JSON files from `eval/data/arc/`. For each task ID, it constructs an `EvalTask` with:

- `id`: `arc-{taskId}` (e.g., `arc-0934a4d8`)
- `query`: A static prompt instructing the model to analyze training examples, discover the transformation rule, and return the output as JSON
- `context`: The full task data (train pairs + test inputs) as a JSON string
- `expected`: The ground truth solution as JSON

**Harness execution.** `eval/harness.ts` (`runEval`) receives the array of `EvalTask[]` and runs them through a concurrency pool. For each task, `runSingleTask` is called, which:

1. Optionally sets up per-task sandbox globals via `setupSandbox(task)`
2. Calls `rlm(task.query, task.context, options)` -- this is the core engine invocation
3. The RLM creates a **fresh** `JsEnvironment` (VM sandbox), a fresh message history, and enters the REPL loop
4. The model iterates up to `maxIterations` times, writing/executing JavaScript, until it calls `return(answer)`
5. The returned answer is scored via `arcGridMatch` (exact grid comparison)
6. Result is saved incrementally to the results JSON file

**Scoring.** `eval/scoring.ts` (`arcGridMatch`) parses the predicted answer as a JSON grid and performs deep equality comparison against the expected grid. Binary scoring: 1.0 for exact match, 0.0 otherwise.

**Key isolation boundary:** Each task gets its own `rlm()` invocation, which means:

- Fresh `JsEnvironment` (new `vm.Context` -- clean sandbox)
- Fresh message history (empty `messages` array)
- Fresh iteration counter (starts at 0)
- Fresh context store (`__ctx.shared.data` = this task's data)
- No carry-over of variables, functions, or learned patterns from previous tasks

This isolation is fundamental to the current design. The harness treats tasks as independent, embarrassingly parallel work items.

### System Prompt and Plugins

The root agent receives:

- `SYSTEM_PROMPT` (from `src/system-prompt.ts`) -- general REPL instructions
- `globalDocs` section (if provided by benchmark config)
- Model alias table (if models are configured)
- `pluginBodies` -- concatenated driver and app plugin markdown

For ARC, the best known configuration uses 9 drivers (`one-block-per-iteration`, `deadline-return`, `verify-all-examples`, `verify-before-return`, `hypothesis-budget`, `exploration-budget`, `arc-helper-library`, `overlap-testing`, `json-stringify-return`) with no app plugin. These inject ~4KB of strategy guidance into the system prompt.

### Performance Baseline

Best known: **65% (13/20)** on a selected 20-task subset (run-026), using Opus 4.6 with 20 iterations, depth 2, 9 drivers. On the full 120-task evaluation set, our best run scored roughly 45-50%. ARCgentica (the state-of-the-art reference implementation) achieves 85.3% using Opus 4.6 with hierarchical sub-agents and pass@2.

---

## 2. What Needs to Change

### 2.1 The Isolation Boundary

The fundamental change is breaking the per-task isolation. Currently:

- `harness.ts:runSingleTask()` calls `rlm()` once per task
- `rlm()` creates a fresh `JsEnvironment` per invocation
- No state carries between tasks

For compound learning, we need some mechanism for state to persist across task boundaries. The options for where this state lives are analyzed in Section 3.

### 2.2 Files That Would Need Modification (by approach)

#### Approach-independent changes (needed regardless of design):

- **`eval/datasets/arc.ts`**: Add a loader variant that returns tasks with ordering metadata and supports batching. The current loader returns a flat array; compound learning needs to control task ordering.
- **`eval/scoring.ts`**: No changes needed. Scoring remains per-task (grid exact match). The compound learning layer is above the scoring layer.
- **`eval/types.ts`**: Add types for compound learning results (per-task scores + aggregate, with metadata about which tasks were solved with what accumulated knowledge).
- **`eval/run.ts`**: Add `--benchmark arc-compound` or a `--compound` flag. Wire up the new harness mode. Add CLI args for batch size, task ordering strategy, etc.
- **`.github/workflows/eval.yml`**: Add the new benchmark option and any new parameters.

#### Approach-specific changes (detailed in Section 3):

- **`eval/harness.ts`**: Major changes for Approach A (sequential single-RLM mode). Minor changes for Approach B (delegation mode). No changes for Approach C (plugin-only).
- **`src/rlm.ts`**: Changes for Approach A (multi-query mode within single invocation). No changes for B/C.
- **`src/environment.ts`**: No changes -- the sandbox already persists state within a single `rlm()` invocation.
- **Plugin files**: New app plugin for compound learning (all approaches).

### 2.3 How Iteration Budgets Would Scale

The current budget: 20 iterations per task, at ~$0.67/task for Opus. For N tasks:

| Tasks | Independent (current)  | Compound (sequential)  | Compound (delegation)                 |
| ----- | ---------------------- | ---------------------- | ------------------------------------- |
| 20    | 20 \* 20 = 400 iters   | 1 session, ~400 iters  | Outer: ~60 iters, inner: ~340 iters   |
| 120   | 120 \* 20 = 2400 iters | 1 session, ~2400 iters | Outer: ~360 iters, inner: ~2040 iters |

The compound approach doesn't save iterations -- it redistributes them. The hypothesis is that later tasks benefit from accumulated knowledge and can solve faster (fewer iterations), compensating for the overhead of knowledge management.

### 2.4 Context Window Constraints

This is the critical bottleneck. Claude Opus 4.6 has a 200K token context window. Each ARC task's context + system prompt + message history consumes roughly:

- System prompt: ~4K tokens
- Task context (train + test data): ~1-5K tokens per task (varies widely)
- Per-iteration message pair: ~500-2000 tokens (code + output)
- 20 iterations: ~10-40K tokens of conversation history

For a single task, the context is ~15-45K tokens. For 20 tasks in sequence within one session, the conversation history would grow to ~300-900K tokens -- far exceeding the 200K context window.

**This means a naive "put all tasks in one conversation" approach is impossible.** Any viable design must handle context management: summarization, checkpointing, or externalization of the knowledge library.

---

## 3. Design Options

### Option A: Modified Harness -- Sequential Tasks in One RLM

**Concept:** Modify `harness.ts` to run tasks sequentially within a single `rlm()` invocation. After each task is solved (or times out), inject the next task's data as a new user message, without resetting the sandbox.

**How it would work:**

1. Call `rlm()` once with a meta-query: "You will solve ARC tasks sequentially. After each task, I will give you the next one."
2. The harness injects each task as a user message: "TASK 2/20: Here is the task data: {...}. Apply your accumulated knowledge."
3. The model solves the task, calls `return(answer)` -- but instead of ending the session, the harness captures the answer, scores it, and continues.
4. The sandbox persists -- all variables, helper functions, and code from previous tasks remain available.
5. The model's conversation history grows with each task.

**Required changes:**

- `src/rlm.ts`: Major refactor. The current `rlm()` function has a single query/context pair and terminates on `return()`. Need a `rlmSequential()` variant or a callback mechanism where `return()` signals "task complete" rather than "session complete."
- `eval/harness.ts`: New `runCompoundEval()` function that feeds tasks one at a time to a single RLM session.
- New app plugin: Instructions for the meta-solver behavior.

**Tradeoffs:**

- (+) Sandbox persistence is automatic -- variables, functions, and state carry forward naturally
- (+) The model can write a growing toolkit file in the sandbox and reuse it
- (-) Context window explosion: conversation history grows linearly with tasks. After ~5-10 tasks, the context will be full
- (-) Requires significant changes to the core `rlm()` function, which is shared across all benchmarks
- (-) Single point of failure: if the session crashes, all progress is lost
- (-) Cannot parallelize at all -- strictly sequential
- (-) The model must manage its own knowledge amid a massive conversation history

**Context management sub-option:** Between tasks, the harness could truncate the conversation history (keeping only the system prompt, the accumulated library code, and the most recent N messages). This is a form of "sliding window" that preserves the sandbox state while managing context growth. The model would need to externalize its knowledge into sandbox variables rather than relying on conversation history.

### Option B: Delegation -- Outer RLM Orchestrates, Inner RLMs Solve

**Concept:** A single outer RLM (the "meta-solver") receives all tasks and delegates each one to a child RLM via `rlm()`. The outer RLM maintains a knowledge library and passes it to each child. After each child returns, the outer RLM updates the library.

**How it would work:**

1. The harness calls `rlm()` once with a meta-query: "You have 20 ARC tasks to solve. Build a library of primitives and delegate each task to a child solver."
2. The outer RLM maintains a `library` variable in the sandbox -- a growing collection of discovered transformation patterns, helper functions, and heuristics.
3. For each task, the outer RLM calls `await rlm(taskQuery, taskContext, { systemPrompt: libraryPrompt })`, passing the accumulated library as part of the child's system prompt.
4. The child solves the task, returns the answer (and optionally, new discoveries).
5. The outer RLM parses the child's return value, scores it (or receives scoring feedback), updates the library, and moves to the next task.

**Required changes:**

- `eval/harness.ts`: New `runCompoundEval()` that creates a single RLM session with all tasks injected as sandbox data. Need a mechanism to capture per-task answers from within the session.
- `eval/run.ts`: New benchmark mode `arc-compound` or `--compound` flag.
- New app plugin: Orchestrator instructions (similar to `arc3-orchestrator.md` but for ARC-2).
- New child app plugin: Solver instructions (similar to `arc-solver.md` but aware of the library).
- `eval/datasets/arc.ts`: Variant loader that returns all tasks as a single bundle.

**Tradeoffs:**

- (+) Clean separation: outer manages knowledge, inner solves tasks
- (+) Context management is natural: each child gets a fresh conversation with just the library + task
- (+) Close analogue to `arc3-orchestrator.md` which already works
- (+) Children can run with different models (cheap model for easy tasks, expensive for hard ones)
- (+) Partial failure is contained: a child crashing doesn't kill the session
- (-) Knowledge transfer overhead: the library must be serialized into the child's system prompt, which consumes tokens
- (-) Library size grows: after 20 tasks, the library could be 10-20K tokens, eating into the child's context budget
- (-) The outer RLM's conversation also grows (one delegation + result per task)
- (-) Children start with clean sandboxes -- no code reuse across tasks
- (-) Double the API calls per task (outer + inner)

**This is the most natural fit for the existing architecture.** The `arc3-orchestrator.md` + `arc3-player.md` pattern is exactly this: an outer agent accumulates knowledge (`__knowledge`) and delegates levels to children, passing knowledge via `__level_task.knowledge`. The child returns a structured JSON report with discoveries. The only difference is that ARC-2 tasks are independent puzzles rather than levels of the same game.

### Option C: Plugin-Only -- Meta-Solver App with All Tasks in Context

**Concept:** Create an app plugin that instructs the model to process multiple tasks within a single standard `rlm()` invocation. All tasks are loaded into `context` as a single JSON bundle. The model manages everything: task ordering, library building, solving, and returning results.

**How it would work:**

1. `loadArcTasks` returns a single "meta-task" whose `context` is all 20 tasks bundled together.
2. The model receives instructions: "You have 20 tasks. Solve them in any order. Build a library of primitives as you go."
3. The model manages its own iteration budget across all tasks.
4. The model calls `return(JSON.stringify(allAnswers))` when done.
5. Scoring parses the returned object and scores each task individually.

**Required changes:**

- `eval/datasets/arc.ts`: New `loadArcCompoundTask()` that bundles tasks into one meta-task.
- `eval/scoring.ts`: New `arcCompoundScore()` that parses a multi-task answer object.
- New app plugin: Full compound learning instructions.
- `eval/run.ts`: New benchmark mode.

**Tradeoffs:**

- (+) Zero changes to `rlm()` or `harness.ts` -- purely a data format + plugin change
- (+) Model has full autonomy over task ordering and iteration allocation
- (+) Can be tested immediately with existing infrastructure
- (-) All tasks must fit in context (20 tasks \* ~3K tokens = ~60K tokens just for data, plus system prompt and conversation -- tight but feasible for 20 tasks)
- (-) 120 tasks would NOT fit (~360K tokens of task data alone)
- (-) Single iteration budget for all tasks: 20 tasks \* 15 iters = 300 iterations needed, far exceeding any reasonable max
- (-) No parallelism at all
- (-) The model must track all state in conversation history
- (-) Context window fills rapidly as the model works through tasks

### Option D: Hybrid -- Batched Compound Sessions with Persistent Library File

**Concept:** Combine elements of A, B, and C. Run tasks in batches (e.g., 10 tasks per batch). Within each batch, use delegation (Option B). Between batches, persist the library to a file (or sandbox variable) that is loaded into the next batch's session.

**How it would work:**

1. Partition 120 tasks into 12 batches of 10.
2. For batch 1: run an orchestrator RLM that delegates each task to a child, accumulating a library.
3. At the end of batch 1: serialize the library to a structured format.
4. For batch 2: start a new orchestrator RLM, pre-loaded with the batch-1 library in the system prompt or sandbox.
5. Repeat until all batches are processed.

**Required changes:**

- Everything from Option B, plus:
- `eval/harness.ts`: Batch management, library serialization/deserialization between batches.
- Library format specification (how primitives are stored, how they are injected into new sessions).

**Tradeoffs:**

- (+) Scales to 120+ tasks (batches handle context limits)
- (+) Library persists across batches
- (+) Each batch can run independently (resumability)
- (+) Context growth is bounded within each batch
- (-) Most complex implementation
- (-) Library format must be carefully designed to be both machine-readable and LLM-readable
- (-) Inter-batch transitions lose sandbox state (unlike Option A)
- (-) Diminishing returns: later batches have a larger library but the library may become noise

### Recommendation

**Option B (Delegation)** is the strongest starting point. It requires the least change to the core engine, has a proven analogue in the ARC-3 orchestrator pattern, and handles context management naturally. It can be extended to Option D (batched) for the full 120-task set.

Option C (plugin-only) is the easiest to prototype and could serve as a quick experiment to test the hypothesis before committing to full infrastructure changes.

---

## 4. The "Library" Artifact

### What the Library Contains

Based on ARC task analysis, the library would accumulate:

1. **Transformation primitives**: Reusable functions like `rotate90`, `reflectH`, `tileGrid`, `floodFill`, `extractComponents`, `applyColorMap`, etc. Many of these already exist in the `arc-helper-library` driver, but the compound learning library would grow organically based on which primitives prove useful.

2. **Discovered patterns**: Higher-level observations like "when the input has a repeating tile structure, extract the tile period using modular arithmetic," or "when objects have different sizes, try sorting by area." These are heuristic rules, not code.

3. **Task taxonomy**: After solving several tasks, the model builds a classification of task types (symmetry, tiling, path-following, assembly, etc.) and associates each type with proven solving strategies.

4. **Anti-patterns**: Failed approaches that should not be repeated. "Do not attempt to solve X-type tasks by doing Y; it wastes iterations."

### How the Library is Stored and Accessed

**Option 1: Growing code string in the sandbox**

The orchestrator maintains a `library` variable in the sandbox that is a JavaScript string. After each task, it appends new functions and heuristics. When delegating, it passes `library` as part of the child's context or system prompt.

```javascript
// In the orchestrator sandbox:
let library = `
// === ARC Compound Library v3 (after solving 5 tasks) ===

// Primitives
function rotate90(grid) { ... }
function tileDetect(grid) { ... }

// Heuristics
// - If input/output have same dimensions, likely a per-cell transform
// - If output is smaller, likely extraction or summarization
// - If divider lines exist, split into regions first
`;

// When delegating:
const answer = await rlm(
  "Solve this ARC task. The library variable contains useful primitives.",
  taskData,
  {
    systemPrompt: `Use these pre-built functions:\n${library}\n\nSolve the task.`,
  },
);
```

_Pros:_ Simple, natural, the model can read and extend it freely.
_Cons:_ Grows unboundedly, eventually fills the child's context window.

**Option 2: Structured JSON knowledge base**

Similar to `arc3-orchestrator.md`'s `__knowledge` object:

```javascript
let knowledge = {
  primitives: {
    gridOps: ["rotate90", "reflectH", "tileGrid", ...],
    analysis: ["findDividers", "extractComponents", ...],
  },
  strategies: [
    { type: "symmetry", approach: "testAllSymmetries first", successRate: "3/4" },
    { type: "tiling", approach: "find repeating period with modular arithmetic", successRate: "2/2" },
  ],
  antiPatterns: [
    "Do not try brute-force color mapping for spatial tasks",
  ],
  taskLog: [
    { id: "0934a4d8", type: "symmetry", solved: true, iterations: 8, notes: "point symmetry at center" },
  ],
};
```

_Pros:_ Structured, queryable, can be pruned/summarized.
_Cons:_ Requires the model to maintain a structured format, which may be fragile.

**Option 3: Code file that children `eval()`**

The orchestrator writes a library.js file to the sandbox's global scope. Children inherit it automatically because the sandbox is shared.

```javascript
// Orchestrator writes to sandbox:
globalThis.arcLibrary = {
  rotate90: function(grid) { ... },
  tileDetect: function(grid) { ... },
  // ... growing library
};
```

_Pros:_ Children can immediately call `arcLibrary.rotate90(grid)` without parsing strings. The sandbox IS shared across depths in the current architecture.
_Cons:_ Requires the orchestrator to actually define the functions in code, not just describe them. The functions must be correct. Sandbox globals persist within a single `rlm()` invocation but the child gets a separate local store for `context`.

**Recommendation:** Option 3 (sandbox globals) for code primitives, combined with Option 2 (structured JSON) for heuristic knowledge. The code lives in the shared sandbox; the heuristics are passed as a string in the child's system prompt.

The key insight is that the sandbox is already shared across all depths within a single `rlm()` invocation (see `src/rlm.ts` line 152: `const env = new JsEnvironment()` is created once for the entire invocation tree). Functions defined by the orchestrator are immediately available to children. This is the most efficient transfer mechanism and already works.

---

## 5. Benchmark Fairness

### ARC Prize Rules

The ARC Prize evaluates submissions by:

1. Each task is scored independently (binary: correct or incorrect grid)
2. The score is correct_tasks / total_tasks
3. There is a time limit per task (not per session)
4. The official competition allows 2 attempts per task (pass@2)

### Is Compound Learning "Fair"?

**By the letter of the rules:** There is no explicit prohibition on cross-task information sharing during evaluation. The ARC Prize is about whether a system can solve tasks, not about how it solves them. If a system processes tasks sequentially and builds knowledge, that is a valid approach.

**By the spirit of the rules:** This is more nuanced. ARC's thesis (from Chollet's "On the Measure of Intelligence") is that the test measures fluid intelligence -- the ability to generalize from few examples on novel tasks. If a system "memorizes" task patterns from the evaluation set itself, that arguably reduces the novelty of later tasks. However:

1. The system is not trained on the evaluation data in any ML sense. It is doing **in-context learning** at test time, which is closer to human cognitive strategies.
2. Humans solving ARC tasks sequentially DO build up intuitions about "the kind of thing ARC tasks ask for." This is natural transfer learning.
3. The ARC-AGI evaluation set has 400+ tasks specifically to resist memorization. Knowledge that transfers is, by definition, genuine understanding of the Core Knowledge priors (objectness, geometry, numerics, etc.).
4. The discovered primitives (rotation, symmetry, tiling) are not task-specific -- they are the universal building blocks of spatial reasoning that ARC was designed to test.

**Comparison to ARCgentica (85.3%):** ARCgentica uses sub-agents within each task but does NOT share knowledge across tasks. Each of their 120 tasks is independent. Our compound learning approach would be methodologically different from the current state-of-the-art.

**Verdict:** Compound learning is fair and arguably more aligned with ARC's intent. ARC tests whether a system can discover and apply Core Knowledge priors. A system that explicitly discovers these priors through experience and encodes them as reusable abstractions is demonstrating exactly the kind of intelligence ARC was designed to measure. The key constraint is that the knowledge must be DISCOVERED at test time, not pre-loaded from training data.

### Reporting Considerations

For scientific integrity, compound learning results should be reported separately from standard independent-task results, with clear labeling:

- "ARC-AGI-2 (compound, 20 tasks, sequential ordering)"
- Report both per-task scores and the accumulated library state
- Compare against the same tasks run independently as a control
- Report the ordering of tasks (since order affects knowledge accumulation)

---

## 6. Implementation Sketch

### Phase 1: Quick Prototype (Option C -- plugin-only, ~1 day)

Goal: Test the hypothesis with minimal infrastructure changes.

1. **Create `loadArcCompoundTask()`** in `eval/datasets/arc.ts`:

   - Takes 10-20 selected tasks
   - Returns a single `EvalTask` with all tasks bundled in `context`
   - Query instructs the model to solve tasks sequentially and return all answers

2. **Create `arcCompoundScore()`** in `eval/scoring.ts`:

   - Parses a JSON object like `{ "0934a4d8": [[1,2],[3,4]], "135a2760": [[5,6]] }`
   - Scores each task independently using `arcGridMatch`
   - Returns the mean score

3. **Create `plugins/apps/arc-compound-solver.md`**:

   - Instructions for the meta-solver: process tasks sequentially, build a library, solve each task, return all answers
   - Include the helper library as a starting point
   - Emphasize that the model should extract reusable patterns after each solve

4. **Wire up in `eval/run.ts`** as `--benchmark arc-compound`

5. **Run with:** `--max-iterations 200 --max-depth 1 --max-tasks 10`

**Expected outcome:** The model will likely run out of context or iterations before finishing all tasks. But we will learn:

- Does the model naturally build a library?
- Does knowledge from early tasks help later tasks?
- Where does the context window become a bottleneck?

### Phase 2: Delegation Approach (Option B, ~3-5 days)

Goal: Build the production-quality compound learning pipeline.

1. **Create `plugins/apps/arc-compound-orchestrator.md`**:

   - Modeled on `arc3-orchestrator.md`
   - Receives all task data in `__ctx.shared.data`
   - Maintains `__library` (code primitives) and `__knowledge` (heuristic patterns)
   - Delegates each task via `rlm()` with `app: "arc-compound-solver"`
   - Updates library after each child returns

2. **Create `plugins/apps/arc-compound-solver.md`** (child app):

   - Modeled on existing `arc-solver.md` + `arc-helper-library` driver
   - Reads the parent's library from `__ctx.shared.data` or sandbox globals
   - Solves one task, returns the answer + any new discoveries
   - Return format: `{ answer: [...], discoveries: { primitives: [...], patterns: [...] } }`

3. **Modify `eval/harness.ts`**:

   - Add `runCompoundEval()` that creates one RLM session with all tasks as shared data
   - The outer RLM iterates through tasks, delegating each one
   - After each delegation, the harness captures the answer and scores it
   - Results are saved incrementally (same as current behavior)
   - Add a `setupSandbox` that injects all task data and a scoring function

4. **Modify `eval/run.ts`**:

   - Add `arc-compound` benchmark case
   - Add `--task-order` flag (sequential, random, easy-first, hard-first)
   - Add `--batch-size` flag for Option D batching

5. **Modify `eval/datasets/arc.ts`**:

   - Add `loadArcCompoundBundle()` that returns a single task containing all sub-tasks
   - Include difficulty metadata if available (based on prior run results)

6. **Scoring integration**:
   - The orchestrator needs to know whether each child's answer was correct
   - Option 1: The harness scores each answer and injects the result back into the conversation
   - Option 2: The orchestrator includes training verification (already standard in ARC solving) as a proxy for correctness
   - Recommendation: Option 2 for the child (verify against training data before returning), plus Option 1 for feedback to the orchestrator (so it knows whether to update the library)

### Phase 3: Batched Compound (Option D, ~2 days after Phase 2)

Goal: Scale to 120 tasks.

1. **Batch management in `harness.ts`**:

   - Partition tasks into batches of 10-20
   - Run each batch as a separate compound session
   - Serialize the library between batches
   - Load the previous batch's library into the next batch's session

2. **Library serialization format**:

   - JSON file with code strings and heuristic patterns
   - Validated at batch boundaries (ensure functions are syntactically correct)
   - Size-bounded (prune low-value entries when the library exceeds N tokens)

3. **Task ordering across batches**:
   - Easy tasks first (based on prior independent-run success rates)
   - This front-loads library building with tasks that are likely to succeed

### Estimated Effort

| Phase                           | Effort     | Dependencies     |
| ------------------------------- | ---------- | ---------------- |
| Phase 1 (plugin-only prototype) | 1 day      | None             |
| Phase 2 (delegation pipeline)   | 3-5 days   | Phase 1 insights |
| Phase 3 (batched scaling)       | 2 days     | Phase 2          |
| Analysis and tuning             | 2-3 days   | Phase 2          |
| Total                           | ~8-11 days |                  |

---

## 7. Open Questions

### Architecture Decisions (need alignment before proceeding)

1. **Task ordering strategy:** Should we order tasks easy-to-hard (maximizes library building from successes), hard-to-easy (tests whether the library helps hard tasks), random (most scientific), or let the model choose (most autonomous)? If easy-to-hard, how do we define difficulty -- prior run success rate? Task complexity heuristics? Number of training examples?
   <CEO>Let's just do the tasks in order to start, as they are in the dataset.</CEO>

2. **Task revisiting:** Should the model be allowed to revisit earlier tasks with new knowledge? This fundamentally changes the loop structure. If yes, how many revisit passes are allowed? This could significantly improve scores but also significantly increase cost.
   <CEO>Let's do a pass@1 through the tasks to start, then we loop back around and do a pass@2 through the tasks that were not solved correctly on the first pass.</CEO>

3. **Scoring feedback to the orchestrator:** Should the orchestrator be told whether each task was solved correctly? If yes, this is "cheating" from a benchmark perspective (the system is getting test-time ground truth feedback). If no, the orchestrator can only rely on training-data verification, which is what the model already does. The argument for feedback: it helps the orchestrator learn which library entries are actually useful. The argument against: it makes the benchmark non-comparable to standard independent evaluation.
   <CEO>Given that the rules already allow for pass@2, we should not be told whether each task was solved correctly. As stated above, each one should make one attempt at solving the task. Many of these tasks can be roughly "self-judged correct" once the model finds the pattern anyway. It should always be using a "self-verify" step anyway before "submitting" the answer. Once it submits at pass@1, it will know whether it was correct or not, internalize its learnings, and move on to the next task.</CEO>

4. **How to handle the 400-task context limit:** The full ARC-AGI-2 evaluation set has 400 tasks. Even with batching, the library grows. What is the maximum library size we should allow? Should the orchestrator be responsible for pruning, or should the harness enforce a token budget?
   <CEO>I think the orchestrator should delegate learning synthesis and pruning to a "synthesis child" that is at depth 1 that alternates between the "task solver child".</CEO.>

5. **Iteration budget allocation:** Should the orchestrator have a fixed iteration budget for ALL tasks (e.g., 500 iterations total for 20 tasks), or should each child have a fixed budget (e.g., 20 iterations per task, same as independent mode)? The former lets the model allocate more iterations to hard tasks; the latter is fairer for comparison. With delegation, the outer RLM's iterations are separate from children's iterations -- the outer might use ~3 iterations per task (delegate, parse result, update library) while the child uses ~15. Total: ~360 iterations for 20 tasks.

6. **Pass@N and compound learning:** Should each task in the compound session get multiple attempts (like pass@2), or is the compound session itself the "attempt"? Running the entire compound session twice with different orderings could be interesting but doubles cost.

7. **Which tasks to include in the prototype?** The 20-task selected set from run-026 includes tasks that our system already solves at 65%. Should we include harder tasks that we currently fail on, to see if compound learning helps? Or stick with the known set for controlled comparison?

8. **Library seeding:** Should the library start empty (pure discovery) or be pre-seeded with the contents of `arc-helper-library.md` (giving the model a head start)? Pre-seeding is arguably fairer since independent runs already get the helper library via drivers.

### Technical Uncertainties

9. **Context window arithmetic:** With Opus 4.6's 200K context window, how many tasks can fit in one batch? Each child delegation consumes context in the outer RLM's history. If each delegation round takes ~2K tokens (query + answer), 20 tasks use ~40K tokens for delegation alone, plus the system prompt (~10K), plus the library (growing from 0 to ~20K). Total: ~70K tokens at the end of 20 tasks. This should fit within 200K, but the children's context is separate (each child gets ~15-45K). Need to validate with actual runs.

10. **Library quality vs. noise:** Will the library actually help, or will it become a noisy collection of task-specific hacks that confuse later solvers? The ARC-3 orchestrator's knowledge accumulation was mixed in effectiveness. ARC-2 tasks are much more diverse than ARC-3 levels (which are variations on the same game), so knowledge transfer may be weaker.

11. **Sandbox sharing semantics for delegation:** The current `rlm()` delegation creates a shared sandbox (`JsEnvironment`). If the orchestrator defines `globalThis.arcLibrary = { ... }`, do children automatically see it? Based on the code in `src/rlm.ts`, yes -- the `env` is created once per top-level `rlm()` invocation and shared across all depths. But the child's `context` variable is isolated (via `__ctx.local`). Need to confirm this works for library sharing.

12. **Failure modes under compound learning:** If the orchestrator crashes or the session times out at task 15/20, what happens to the first 14 results? The current harness saves results incrementally, but for a single-session approach, we need a mechanism to extract partial results from within the session.

### Scientific Questions

13. **What is the expected improvement?** Based on the trajectory analysis, many ARC failures are due to wrong hypotheses, not lack of primitives. If compound learning primarily provides better primitives but the bottleneck is hypothesis generation, the improvement may be modest. Counter-argument: the library also encodes heuristic strategies ("for tiling tasks, try modular arithmetic"), which could help hypothesis generation.

14. **Ordering effects as confounds:** If we order tasks easy-to-hard, we might see an improvement that is really just "easy tasks are solved first, inflating the early success rate." The scientific control would be to run the same tasks independently AND in compound mode with the same ordering, then compare per-task scores at each position.

15. **Is this test-time training?** Some might argue that building a library from evaluation tasks constitutes test-time training on the evaluation set. The counter-argument is that humans do this naturally (you get better at ARC tasks as you do more of them), and the knowledge being extracted is general (symmetry, tiling, component analysis), not task-specific. This is a philosophical question that affects how we report results.
