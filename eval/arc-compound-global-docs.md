### ARC Compound Learning Sandbox

#### Task Data

- `__arcTasks` -- Object keyed by task ID. Each value: `{ train: [{ input, output }], test: [{ input }] }`.
- `__arcTaskIds` -- Array of all task IDs in dataset order.
- `__arcCurrentTask` -- ID of the task currently being solved (set by orchestrator before delegation).

#### Shared Library

- `__arcLibrary` -- The shared knowledge library. Shape:
  - `primitives` -- Object of named JS functions (live callables, stored by solver/synthesizer).
  - `strategies` -- Array of heuristic rules: `{ approach, successRate, taskIds, structuralHints }`.
  - `antiPatterns` -- Array of warning strings for approaches that failed.
  - `taskLog` -- Array of per-task records written by solvers.

Read from these. Write to `__arcLibrary`. Do not overwrite task data.

#### Submission API

`__arcSubmit` manages answer submissions. **Each task gets exactly 2 submissions.** This is a hard limit enforced by the harness — extra submissions are rejected.

- `__arcSubmit.submit(taskId, answer)` -- Submit a predicted output grid for a task. Returns `{ correct: boolean, remaining: number }`. The `answer` should be the predicted output grid (2D array of integers for single-test-input tasks, or array of grids for multi-test-input tasks). **Once a task has a correct submission, do not submit again — it wastes an attempt.**
- `__arcSubmit.remaining(taskId)` -- Returns number of submissions remaining for this task (0, 1, or 2).
- `__arcSubmit.getResults()` -- Returns `{ [taskId]: boolean }` indicating which tasks have been solved correctly. Use this to build the final return value.

#### Submission Strategy

You have 2 submissions per task. Use them wisely:

- **Submission 1 (pass@1):** Submit when the solver self-verifies successfully against all training pairs. If it passes, the task is done — do not use submission 2.
- **Submission 2 (pass@2):** After ALL tasks have been attempted and the library is fully built, retry failed tasks. The solver now has more primitives and strategies. Submit only if the retry produces a new answer.

**Do not submit speculatively.** Only submit when the solver reports high confidence from self-verification. A wasted submission cannot be recovered.

#### Return Protocol

When all tasks are done (both passes), return a JSON object with the final answers:

```javascript
return(JSON.stringify(__arcSubmit.getResults()));
```
