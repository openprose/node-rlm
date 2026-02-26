---
name: arc2-compound-solver
kind: program
version: 1.3.0
description: Solve ARC-AGI-2 tasks through compound learning with cross-task knowledge accumulation
nodes: [session-orchestrator, task-solver]
---

# ARC-2 Compound Learning Solver

## Components

### session-orchestrator

```
role: orchestrator
app: "arc2-orchestrator"
api: [__arcSubmit.submit, __arcSubmit.remaining, __arcSubmit.getResults]
prohibited: [solving tasks directly — no grid analysis, no transform writing]

good at:
  - managing the session lifecycle across all tasks
  - curating &Library between delegations (promote strategies, record anti-patterns)
  - sanity-checking answers before spending submissions
  - building diagnostic retry briefs from prior failure context

bad at:
  - pattern discovery (too far from the grid level)
  - writing transforms (prohibited — delegate to solver)

requires from caller:
  - arc2 harness sandbox globals available (__arcTasks, __arcTaskIds, __arcSubmit, __arcLibrary)

produces for caller:
  - __arcSubmit.getResults()

state:
  reads: &Library (strategies, taskLog, antiPatterns)
  writes: &Library (curation after each solver return — promote, prune, record)
```

### task-solver

```
role: leaf
app: "arc2-solver"
api: []
prohibited: [__arcSubmit.submit, __arcSubmit.remaining, __arcSubmit.getResults]

good at:
  - hypothesis-driven pattern discovery through code execution
  - writing and testing transformation functions
  - leave-one-out cross-validation to catch overfitting
  - composing library primitives for novel tasks
  - storing reusable general-purpose primitives

bad at:
  - submission decisions (sees only one task, no session context)
  - strategic planning across tasks (no cross-task visibility)

requires from caller:
  - __arcCurrentTask set to a valid task ID
  - __arcTasks[__arcCurrentTask] has train and test data
  - __arcLibrary exists with primitives, strategies, antiPatterns, taskLog

produces for caller:
  - &Library.taskLog entry: { solved, confidence, answer, approach, keyInsight, structuralProps, newPrimitives }
  - &Library.primitives: new general-purpose functions (with source and doc)
  - return string: JSON { solved, confidence, answer }

does NOT produce:
  - submission decisions (orchestrator submits)
  - strategy promotions (orchestrator promotes based on ground truth)
  - anti-pattern records (orchestrator records based on submission correctness)

state:
  reads: &Library (primitives, strategies, antiPatterns)
  writes: &Library (taskLog entry, new primitives)
```

## Composition Principles

```
principles:

  1. CURATION IS THE RETURN ON COMPOSITION
     A flat architecture (one agent does everything) is simpler.
     Composition only pays off if knowledge flows upward after each delegation.
     If you delegate without curating the return, you paid the cost of
     composition without getting the benefit.

     After EVERY delegation:
       - Read &Library.taskLog for the solver's result
       - Promote strategies ONLY when submission is actually correct
       - Record anti-patterns ONLY from ground truth (submission result)
       - Verify new primitives are callable
       - Preserve the solver's keyInsight for diagnostic retries

  2. COLLAPSE IS THE DEFAULT FAILURE MODE
     Without deliberate effort, the orchestrator absorbs the solver's work.
     An orchestrator that "just analyzes this one grid" will analyze them all.
     Delegation is a commitment to abstraction separation.

     Observable symptom: if the orchestrator wrote a transform function,
     called findComponents, or analyzed grid colors — it has collapsed.

  3. DIAGNOSTIC RETRIES
     Retry briefs contain what was tried and what failed.
     A generic "try again" wastes the solver's budget rediscovering failure.
     A diagnostic brief — "previous attempt tried X and failed because Y,
     try a DIFFERENT approach" — lets the solver start from a higher floor.

     The brief includes available library primitives with doc strings.
     The solver composes existing primitives rather than rewriting from scratch.

  4. BRIEFS ARE INTERFACES
     When you delegate, pass the child facts from &Library — not your own
     analysis. The solver has its own program that teaches it how to observe
     and analyze grids. The brief provides context; the program provides
     methodology.

     A brief contains:
       - The goal (solve the current task)
       - Matching strategies from &Library (structural hints)
       - If retry: what failed and what to try differently

     A brief NEVER contains:
       - Grid analysis ("the input has 3 components")
       - Transform suggestions ("try rotating the grid")
       - Tactical advice that overrides the solver's exploration strategy
```

## Shared State

### &Library

The shared knowledge library. Persists across all tasks in the session. Pre-initialized by the harness as `__arcLibrary`.

```
Library {
  primitives: {
    [name]: {
      fn: Function                 -- live callable JS function
      source: string               -- fn.toString() for cross-task discoverability
      doc: string                  -- one-line description of what it does
    }
  }

  strategies: {
    approach: string               -- e.g. "connected components + color mapping"
    structuralHints: {             -- when to try this approach
      sameSize?: boolean           -- input/output same dimensions?
      colorCount?: number          -- distinct colors in input
      hasSymmetry?: boolean        -- rotational/reflective symmetry detected?
    }
    taskIds: string[]              -- tasks where this approach succeeded
    successCount: number
  }[]

  antiPatterns: string[]           -- failed approaches (avoid repeating)
                                   -- e.g. "color replacement failed on 0934a4d8"

  taskLog: {
    id: string
    solved: boolean
    confidence: number             -- 0..1, calibrated by leave-one-out validation
    approach: string               -- natural language: what was tried
    keyInsight: string             -- what worked, or why it failed
    answer: number[][][] | null    -- predicted test output(s)
    structuralProps: {             -- template: fields populated through analysis
      sameSize?: boolean
      inputDims?: [number, number]
      outputDims?: [number, number]
      colorCount?: number
      hasBackground?: boolean      -- is color 0 a dominant background?
      [custom]: any                -- solver may add task-specific observations
    }
    newPrimitives: string[]        -- names of functions stored on primitives
  }[]
}
```

### Harness-Injected Globals

These are injected by the eval harness, not by the program. Listed here for reference.

```
__arcTasks: { [taskId]: { train: [{ input, output }], test: [{ input }] } }
__arcTaskIds: string[]             -- all task IDs in dataset order
__arcCurrentTask: string | null    -- set by orchestrator before each delegation
__arcSubmit: {
  submit(taskId, answer): { correct: boolean, remaining: number }
  remaining(taskId): number        -- 0, 1, or 2
  getResults(): { [taskId]: boolean }
}
```

#### Task Data

- `__arcTasks` -- Object keyed by task ID. Each value: `{ train: [{ input, output }], test: [{ input }] }`.
- `__arcTaskIds` -- Array of all task IDs in dataset order.
- `__arcCurrentTask` -- ID of the task currently being solved (set by orchestrator before delegation).

#### Shared Library

- `__arcLibrary` -- The shared knowledge library. Shape:
  - `primitives` -- Object of named JS functions (live callables, stored by solver).
  - `strategies` -- Array of heuristic rules: `{ approach, successRate, taskIds, structuralHints }`.
  - `antiPatterns` -- Array of warning strings for approaches that failed.
  - `taskLog` -- Array of per-task records written by solvers.

Read from these. Write to `__arcLibrary`. Do not overwrite task data.

#### Submission API

`__arcSubmit` manages answer submissions. **Each task gets exactly 2 submissions.** This is a hard limit enforced by the harness -- extra submissions are rejected.

- `__arcSubmit.submit(taskId, answer)` -- Submit a predicted output grid for a task. Returns `{ correct: boolean, remaining: number }`. The `answer` should be the predicted output grid (2D array of integers for single-test-input tasks, or array of grids for multi-test-input tasks). **Once a task has a correct submission, do not submit again -- it wastes an attempt.**
- `__arcSubmit.remaining(taskId)` -- Returns number of submissions remaining for this task (0, 1, or 2).
- `__arcSubmit.getResults()` -- Returns `{ [taskId]: boolean }` indicating which tasks have been solved correctly. Use this to build the final return value.

#### Submission Strategy

You have 2 submissions per task. Use them wisely:

- **Submission 1 (pass@1):** Submit when the solver self-verifies successfully against all training pairs. If it passes, the task is done -- do not use submission 2.
- **Submission 2 (pass@2):** After ALL tasks have been attempted and the library is fully built, retry failed tasks. The solver now has more primitives and strategies. Submit only if the retry produces a new answer.

**Do not submit speculatively.** Only submit when the solver reports high confidence from self-verification. A wasted submission cannot be recovered.

#### Return Protocol

When all tasks are done (both passes), return a JSON object with the final answers:

```javascript
return(JSON.stringify(__arcSubmit.getResults()));
```

## Invariants

```
invariants:

  - SANDBOX IS SHARED: All state passes through __arcLibrary on globalThis.
    Never serialize the library into child prompts. Children read it directly.

  - 2 SUBMISSIONS PER TASK: Hard limit enforced by harness. The orchestrator
    decides when to submit. The solver NEVER calls __arcSubmit.

  - KNOWLEDGE ONLY GROWS: Working primitives are never deleted from &Library.
    New tasks may add primitives, strategies, and taskLog entries. The orchestrator
    may prune anti-patterns to stay under budget, but never working code.

  - LEAVE-ONE-OUT BEFORE SUBMIT: The solver must validate its transform via
    leave-one-out cross-validation (when >= 3 training pairs) before returning
    solved=true. The orchestrator must run sanity checks before submitting.
    Two independent validation gates reduce false positives.

  - VERIFY-THEN-RETURN: Verification and return() MUST occur in separate
    iterations. The solver must OBSERVE verification output before deciding
    to return. Writing verification code and return() in the same iteration
    means you return before seeing whether verification passed.

  - ANTI-PATTERNS FROM GROUND TRUTH: Anti-patterns are recorded by the
    orchestrator based on submission correctness (result.correct), not
    solver self-report (logEntry.solved). Strategies are only promoted
    when the submission is actually correct.

  - ONE TASKLOG ENTRY PER DELEGATION: Each solver invocation pushes exactly
    one taskLog entry at the end of its run. No intermediate entries.

  - TRY-CATCH EVERYTHING: The orchestrator wraps every rlm() call in try-catch.
    Child timeouts and errors are recorded in taskLog, not propagated as crashes.
```
