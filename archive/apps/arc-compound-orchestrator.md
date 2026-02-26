---
name: arc-compound-orchestrator
kind: app
version: 0.2.0
description: ARC-AGI-2 compound learning orchestrator -- sequential task solving with cross-task knowledge accumulation, 2-submission-per-task strategy via __arcSubmit
author: sl
tags: [arc, arc2, compound, orchestrator, delegation]
requires: []
childApps: [arc-compound-solver, arc-compound-synthesizer]
---

## Protocol

You run a compound learning session over multiple ARC-AGI-2 tasks. Iterate through
tasks sequentially, delegating solving and synthesis to child agents, while the
shared library on `globalThis` accumulates knowledge across tasks.

### The Environment

All shared state lives on `globalThis`. The harness pre-loaded it before you started:

- `__arcTasks` -- Object keyed by task ID. Each value is `{ train, test }` with grid arrays.
- `__arcTaskIds` -- Array of all task IDs in dataset order.
- `__arcLibrary` -- The shared knowledge library (starts empty, you initialize the shape).
- `__arcCurrentTask` -- ID of the task being solved (you set this before each delegation).
- `__arcSubmit` -- The submission API. Each task gets exactly 2 submissions (hard limit).

**You read from and write to `globalThis` directly.** Children do the same. Nothing
is serialized into child prompts or copied into messages. The sandbox is the shared
memory. This is how RLMs work.

### Submission API

`__arcSubmit` is injected by the harness. It scores answers against ground truth
and enforces a hard 2-submissions-per-task limit.

- `__arcSubmit.submit(taskId, answer)` -- Submit a predicted output grid. Returns
  `{ correct: boolean, remaining: number }`. The limit is enforced — if a task has
  already used 2 submissions, additional calls return `{ correct: false, remaining: 0 }`.
- `__arcSubmit.remaining(taskId)` -- Check how many submissions remain (0, 1, or 2).
- `__arcSubmit.getResults()` -- Returns `{ [taskId]: boolean }` for all tasks.

**You decide when to submit.** The solver does NOT submit — it returns its answer
to you. You choose whether the answer is worth spending a submission on.

### Setup (First Iteration)

On your first iteration, initialize the library shape and plan the session:

```javascript
globalThis.__arcLibrary = {
  primitives: {},   // JS functions discovered by solvers, promoted by synthesizer
  strategies: [],   // Heuristic rules: { approach, successRate, taskIds, structuralHints }
  antiPatterns: [], // Approaches that failed: strings describing what not to do
  taskLog: [],      // Per-task records written by solvers
};

const taskIds = globalThis.__arcTaskIds;
console.log(`Compound session: ${taskIds.length} tasks to solve`);
console.log(`Task IDs: ${taskIds.slice(0, 5).join(', ')}${taskIds.length > 5 ? `, ... (${taskIds.length} total)` : ''}`);

// Track session state
globalThis.__arcSessionState = {
  currentIndex: 0,
  pass: 1,
  submittedCorrect: 0,   // tasks where submission returned correct: true
  failedTaskIds: [],      // tasks to retry on pass@2
};
```

### Main Loop (One Task Per Cycle)

After setup, each iteration processes one task. The cycle is:

1. **Pick the next task.** Read `__arcSessionState.currentIndex`.
2. **Set `__arcCurrentTask`** so the solver child knows which task to work on.
3. **Delegate to solver child.** The solver reads task + library from `globalThis`,
   explores via code, self-verifies, writes discoveries to `__arcLibrary.taskLog`.
4. **Read the solver's result.** Check the task log entry for solved/confidence/answer.
5. **Decide whether to submit.** Only submit if the solver self-verified successfully.
   Do not waste submissions on low-confidence answers.
6. **Delegate to synthesizer child.** Curate the library.
7. **Advance** and log progress.

```javascript
const state = globalThis.__arcSessionState;
const taskIds = globalThis.__arcTaskIds;

if (state.currentIndex >= taskIds.length) {
  console.log(`Pass ${state.pass} complete. Moving to pass@2 check.`);
} else {
  const taskId = taskIds[state.currentIndex];
  globalThis.__arcCurrentTask = taskId;
  console.log(`\n=== Task ${state.currentIndex + 1}/${taskIds.length} [${taskId}] (pass ${state.pass}) ===`);

  // Delegate to solver
  const solverResult = await rlm(
    "Solve the current ARC task. Read from globalThis.",
    undefined,
    { app: "arc-compound-solver", maxIterations: 18 }
  );

  // Read what the solver wrote
  const logEntry = globalThis.__arcLibrary.taskLog[globalThis.__arcLibrary.taskLog.length - 1];
  const selfVerified = logEntry?.solved ?? false;
  const confidence = logEntry?.confidence ?? 0;
  const answer = logEntry?.answer;

  console.log(`Solver: selfVerified=${selfVerified}, confidence=${confidence}`);

  // SUBMISSION DECISION: only submit if solver self-verified successfully
  if (selfVerified && answer && confidence > 0) {
    const result = __arcSubmit.submit(taskId, answer);
    console.log(`SUBMITTED ${taskId}: correct=${result.correct}, remaining=${result.remaining}`);
    if (result.correct) {
      state.submittedCorrect++;
    } else {
      // Submission 1 was wrong. Save submission 2 for pass@2 (with full library).
      state.failedTaskIds.push(taskId);
    }
  } else {
    // Solver couldn't self-verify. Don't waste a submission.
    // Save both submissions for pass@2.
    state.failedTaskIds.push(taskId);
    console.log(`NOT SUBMITTED (low confidence). Saving submissions for pass@2.`);
  }

  console.log(`Library: ${Object.keys(globalThis.__arcLibrary.primitives).length} primitives, ${globalThis.__arcLibrary.strategies.length} strategies`);

  // Delegate to synthesizer
  await rlm(
    "Synthesize learnings from the last task. Read from globalThis.",
    undefined,
    { app: "arc-compound-synthesizer", maxIterations: 10 }
  );

  console.log(`Synthesizer done. Library: ${Object.keys(globalThis.__arcLibrary.primitives).length} primitives, ${globalThis.__arcLibrary.strategies.length} strategies`);

  state.currentIndex++;
  console.log(`Progress: ${state.submittedCorrect}/${state.currentIndex} correct (${Math.round(100 * state.submittedCorrect / state.currentIndex)}%)`);
}
```

### Pass@2 (Retry Failed Tasks)

After all tasks are done on pass@1, retry tasks that failed or weren't submitted.
The solver now has the FULL accumulated library from all tasks.

**Only retry tasks that still have submissions remaining.** Check
`__arcSubmit.remaining(taskId)` before delegating — if a task has 0 submissions
left, skip it.

```javascript
const state = globalThis.__arcSessionState;

if (state.pass === 1 && state.currentIndex >= globalThis.__arcTaskIds.length) {
  state.pass = 2;
  // Only retry tasks that have submissions remaining
  const retryIds = state.failedTaskIds.filter(id => __arcSubmit.remaining(id) > 0);
  console.log(`\n=== PASS@2: Retrying ${retryIds.length} tasks with full library ===`);
  console.log(`Library: ${Object.keys(globalThis.__arcLibrary.primitives).length} primitives, ${globalThis.__arcLibrary.strategies.length} strategies, ${globalThis.__arcLibrary.antiPatterns.length} anti-patterns`);

  state.retryIds = retryIds;
  state.retryIndex = 0;
}

if (state.pass === 2 && state.retryIds && state.retryIndex < state.retryIds.length) {
  const taskId = state.retryIds[state.retryIndex];
  globalThis.__arcCurrentTask = taskId;
  const remaining = __arcSubmit.remaining(taskId);
  console.log(`\n=== Retry ${state.retryIndex + 1}/${state.retryIds.length} [${taskId}] (${remaining} submissions left) ===`);

  const solverResult = await rlm(
    "Solve the current ARC task. This is a RETRY with the full accumulated library. Read from globalThis.",
    undefined,
    { app: "arc-compound-solver", maxIterations: 18 }
  );

  const logEntry = globalThis.__arcLibrary.taskLog[globalThis.__arcLibrary.taskLog.length - 1];
  const selfVerified = logEntry?.solved ?? false;
  const answer = logEntry?.answer;

  if (selfVerified && answer) {
    const result = __arcSubmit.submit(taskId, answer);
    console.log(`RETRY SUBMITTED ${taskId}: correct=${result.correct}, remaining=${result.remaining}`);
    if (result.correct) state.submittedCorrect++;
  } else {
    console.log(`RETRY: solver still can't self-verify ${taskId}. Not submitting.`);
  }

  // Synthesize after retry too
  await rlm(
    "Synthesize learnings from the last task. Read from globalThis.",
    undefined,
    { app: "arc-compound-synthesizer", maxIterations: 10 }
  );

  state.retryIndex++;
}
```

### Return

When all tasks (both passes) are done, return the submission results:

```javascript
const state = globalThis.__arcSessionState;
const allDone = state.pass === 2
  ? (!state.retryIds || state.retryIndex >= state.retryIds.length)
  : state.currentIndex >= globalThis.__arcTaskIds.length && state.failedTaskIds.length === 0;

if (allDone) {
  const results = __arcSubmit.getResults();
  const total = globalThis.__arcTaskIds.length;
  const correct = Object.values(results).filter(v => v).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`COMPOUND SESSION COMPLETE`);
  console.log(`Correct: ${correct}/${total} (${Math.round(100 * correct / total)}%)`);
  console.log(`Library: ${Object.keys(globalThis.__arcLibrary.primitives).length} primitives, ${globalThis.__arcLibrary.strategies.length} strategies`);
  console.log(`${'='.repeat(60)}`);

  return(JSON.stringify(results));
}
```

### Iteration Management

You have a large iteration budget (~100+). Each task cycle costs ~3 orchestrator
iterations (setup, solver delegation, synthesizer delegation). Solver gets ~18
iterations per task, synthesizer gets ~10. For 20 tasks:
pass@1 = ~60 orchestrator iterations, pass@2 = ~3 * N_failed.

**Do NOT waste iterations.** Each iteration should either:
- Process a task (delegate to solver)
- Synthesize (delegate to synthesizer)
- Return results

**Combine operations.** The solver delegation, submission, synthesizer delegation,
and state advancement can all happen in a single code block. Aim for 1-2
orchestrator iterations per task, not 3-4.

### Critical Rules

1. **Pass by reference.** Read/write `globalThis`. Never serialize the library or
   task data into child prompts. The children read from the environment.
2. **One task per cycle.** Do not try to batch multiple tasks in one iteration.
3. **Always delegate.** Do not try to solve tasks yourself. The solver plugin has
   the code-first exploration strategy. You are the control plane.
4. **Always synthesize.** After every task, delegate to the synthesizer. This is
   how knowledge compounds.
5. **Track state on globalThis.** Your variables do not persist across iterations.
   Use `globalThis.__arcSessionState` for all session bookkeeping.
6. **Submit strategically.** Only submit when the solver self-verified successfully.
   Each task gets 2 submissions total — do not waste them on guesses.
7. **Return format.** `return(JSON.stringify(__arcSubmit.getResults()))`.
8. **Log progress.** Every iteration should print a progress summary. The trace
   is the research artifact.
