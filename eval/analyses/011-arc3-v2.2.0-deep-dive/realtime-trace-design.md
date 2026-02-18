# Realtime Trace Streaming: Design Document

## Problem

Currently, the trace (reasoning, code, output, envSnapshots, child traces) is only
available when `rlm()` completes -- either by returning a value or hitting
`maxIterations`. For long runs (30+ minutes, 30 iterations, with child
delegations), there is no way to observe progress in real time. The operator has
to wait for the full run to finish before seeing what happened.

This is especially painful for ARC-3, where a single game can take 20-40 minutes
and cost $3-$10. A failed run produces no observable signal until it is over.

## Goals

1. **RLM-generic.** No ARC-3 code in the engine. The solution works for any
   benchmark: oolong, s-niah, arc, arc3, arc-compound.
2. **Incremental.** After each iteration (and each child delegation), updated
   state is written somewhere observable.
3. **Low overhead.** File I/O is the only cost. No network, no database, no
   polling loop.
4. **Composable.** Works whether tracing is on or off. The callback is optional.
   Existing behavior is unchanged if omitted.
5. **Respects Irreducible Core.** The engine change is a single optional callback
   field on `RlmOptions`. No new dependencies. No new abstractions. The harness
   and CLI own the writing logic.

## Architecture Overview

```
                         rlm.ts (engine)
                              |
                    onIteration callback
                              |
                      harness.ts (eval)
                         /         \
            JSONL writer            benchmark hooks
            (generic)               (arc3-specific state)
```

The design has three layers:

1. **Engine layer** (`rlm.ts`): A single `onIteration` callback in `RlmOptions`.
   Fired after each iteration with the trace entry, iteration metadata, and
   delegation context. This is the only engine change.

2. **Harness layer** (`harness.ts`): Receives the callback, enriches it with
   benchmark-specific state via a new `getIterationMetadata` hook, and writes
   JSONL to a streaming trace file.

3. **Benchmark layer** (`run.ts` benchmark config): Provides
   `getIterationMetadata` to attach game-specific state (ARC-3 action count,
   levels completed, frame hash). No engine coupling.

---

## Layer 1: Engine Change (`rlm.ts`)

### New types

```typescript
/** Payload delivered to the onIteration callback after each iteration. */
export interface IterationEvent {
  /** Invocation ID of the agent that just completed this iteration. */
  invocationId: string;
  /** Parent invocation ID, or null for root. */
  parentId: string | null;
  /** Delegation depth (0 = root). */
  depth: number;
  /** 0-based iteration index that just completed. */
  iteration: number;
  /** Total iteration budget for this invocation. */
  maxIterations: number;
  /** The trace entry for this iteration (reasoning, code, output, error, children, envSnapshot). */
  entry: TraceEntry;
  /** Cumulative trace so far (all iterations for this invocation, including this one). */
  trace: readonly TraceEntry[];
  /** Whether this iteration produced a return value (i.e. the run is about to end). */
  returned: boolean;
  /** Wall-clock milliseconds since this invocation started. */
  elapsedMs: number;
}

/** Callback type for onIteration. */
export type OnIterationCallback = (event: IterationEvent) => void;
```

### Changes to `RlmOptions`

```typescript
export interface RlmOptions {
  // ... existing fields unchanged ...

  /**
   * Called after each iteration completes (for root and child invocations).
   * Receives the trace entry, iteration metadata, and delegation context.
   * Must not throw. Must not block (keep it synchronous and fast).
   */
  onIteration?: OnIterationCallback;
}
```

### Changes to `rlmInternal`

Two insertion points, both immediately after `trace.push(entry)`:

**Point 1: Normal iteration (no return)**
After line 477 (`trace.push(entry)`), add:

```typescript
opts.onIteration?.({
  invocationId,
  parentId,
  depth,
  iteration,
  maxIterations: effectiveMaxIterations,
  entry,
  trace,
  returned: false,
  elapsedMs: Date.now() - invocationStartTime,
});
```

**Point 2: Return iteration**
After line 460 (`trace.push(entry)`) inside the `returnValue !== undefined` block,
add the same call but with `returned: true`.

**New local variable:** Add `const invocationStartTime = Date.now()` at the top of
`rlmInternal`.

### Why `onIteration` and not EventEmitter

- **Irreducible Core.** A callback is a function parameter, not a new dependency
  or pattern. It fits the existing seams (`CallLLM` is already a function you
  pass in).
- **No import needed.** No `events` module, no `.on()/.off()` lifecycle.
- **Composable.** The caller composes what happens: write JSONL, update a
  progress bar, push to a WebSocket, or do nothing.
- **Child coverage.** Because `rlmInternal` is recursive and `opts` is closed
  over, children automatically fire the same callback. The `depth` and
  `invocationId` fields distinguish them.

### Why not a streaming return (AsyncGenerator)

Changing `rlm()` from `Promise<RlmResult>` to `AsyncGenerator<IterationEvent,
RlmResult>` would be a breaking API change. Every consumer would need to change.
A callback is additive -- existing consumers pass nothing and see no difference.

---

## Layer 2: Harness Change (`harness.ts`)

### New types

```typescript
/** JSONL record written after each iteration. */
interface StreamingTraceRecord {
  /** Record type for forward compatibility. */
  type: "iteration" | "task_start" | "task_end";
  /** ISO timestamp of this record. */
  timestamp: string;
  /** Task ID from the eval harness. */
  taskId: string;
  /** Fields from IterationEvent (invocationId, parentId, depth, iteration, etc.) */
  invocationId: string;
  parentId: string | null;
  depth: number;
  iteration: number;
  maxIterations: number;
  returned: boolean;
  elapsedMs: number;
  /** The trace entry itself (reasoning, code, output, error). */
  entry: TraceEntry;
  /** Benchmark-specific metadata (e.g. ARC-3 game state). */
  benchmarkState?: Record<string, unknown>;
}
```

### New `HarnessConfig` field

```typescript
export interface HarnessConfig {
  // ... existing fields ...

  /**
   * Return benchmark-specific state to include in each streaming trace record.
   * Called after each iteration. Unlike getResultMetadata (called once at end),
   * this is called per-iteration for real-time observability.
   *
   * Example: ARC-3 returns { actionCount, levelsCompleted, state }.
   */
  getIterationMetadata?: (task: EvalTask) => Record<string, unknown> | undefined;
}
```

### New CLI flag

```
--trace-stream           Write streaming JSONL trace file per task
```

When `--trace-stream` is passed (or `--trace-full` which already enables all
trace options), the harness:

1. Creates a directory: `eval/results/traces/<timestamp>/`
2. For each task, creates: `eval/results/traces/<timestamp>/<taskId>.jsonl`
3. Passes an `onIteration` callback to `rlm()` that appends a JSON line to the
   task's JSONL file after each iteration.

### Implementation sketch for `runSingleTask`

```typescript
async function runSingleTask(
  task: EvalTask,
  // ... existing params ...
  traceStream?: boolean,
  traceDir?: string,
  getIterationMetadata?: (task: EvalTask) => Record<string, unknown> | undefined,
): Promise<EvalResult> {
  const startTime = Date.now();

  // Set up streaming trace file
  let traceFile: number | undefined;  // file descriptor
  if (traceStream && traceDir) {
    const tracePath = join(traceDir, `${task.id}.jsonl`);
    traceFile = openSync(tracePath, 'w');
    // Write task_start record
    const startRecord: StreamingTraceRecord = {
      type: 'task_start',
      timestamp: new Date().toISOString(),
      taskId: task.id,
      invocationId: 'root',
      parentId: null,
      depth: 0,
      iteration: 0,
      maxIterations,
      returned: false,
      elapsedMs: 0,
      entry: { reasoning: '', code: [], output: '', error: null },
    };
    writeSync(traceFile, JSON.stringify(startRecord) + '\n');
  }

  // Build onIteration callback
  const onIteration: OnIterationCallback | undefined = traceFile !== undefined
    ? (event) => {
        const benchmarkState = getIterationMetadata?.(task);
        const record: StreamingTraceRecord = {
          type: 'iteration',
          timestamp: new Date().toISOString(),
          taskId: task.id,
          invocationId: event.invocationId,
          parentId: event.parentId,
          depth: event.depth,
          iteration: event.iteration,
          maxIterations: event.maxIterations,
          returned: event.returned,
          elapsedMs: event.elapsedMs,
          entry: event.entry,
          ...(benchmarkState && { benchmarkState }),
        };
        // appendFileSync for atomicity (each line is one write syscall)
        appendFileSync(traceFile!, JSON.stringify(record) + '\n');
      }
    : undefined;

  // ... rest of runSingleTask, passing onIteration to rlm() ...

  const result = await rlm(task.query, task.context, {
    // ... existing options ...
    ...(onIteration && { onIteration }),
  });

  // Write task_end record
  if (traceFile !== undefined) {
    const endRecord = {
      type: 'task_end',
      timestamp: new Date().toISOString(),
      taskId: task.id,
      invocationId: 'root',
      parentId: null,
      depth: 0,
      iteration: result.iterations,
      maxIterations,
      returned: true,
      elapsedMs: Date.now() - startTime,
      entry: { reasoning: '', code: [], output: '', error: null },
      answer: result.answer,
      score: scoringFn(result.answer, task.expected, task.metadata),
    };
    appendFileSync(traceFile, JSON.stringify(endRecord) + '\n');
    closeSync(traceFile);
  }
}
```

### File descriptor management

Use `openSync` / `appendFileSync` / `closeSync` from `node:fs`. Each JSONL line
is a single `appendFileSync` call, which on POSIX is atomic for reasonable sizes
(< PIPE_BUF). This means `tail -f` sees complete lines without corruption.

In the error/catch path, write a `task_end` record with the error, then close
the fd in `finally`.

---

## Layer 3: Benchmark Hooks (`run.ts`)

### ARC-3 `getIterationMetadata`

```typescript
case "arc3": {
  // ... existing setup ...

  return {
    // ... existing fields ...
    getIterationMetadata: (task) => {
      const client = clients.get(task.id);
      if (!client) return undefined;
      const frame = client.observe();
      return {
        actionCount: client.actionCount,
        completed: client.completed,
        levelsCompleted: frame?.levels_completed ?? 0,
        winLevels: frame?.win_levels ?? 0,
        state: frame?.state ?? 'NOT_STARTED',
        // Include a compact frame fingerprint, not the full 64x64 grid
        frameGuid: frame?.guid,
      };
    },
  };
}
```

This reads from `Arc3Client`'s existing in-memory state (`observe()`,
`actionCount`, `completed`). No API calls. No new state. The client already
tracks everything needed.

### Other benchmarks

Other benchmarks can provide `getIterationMetadata` or not. If omitted, the
`benchmarkState` field is simply absent from JSONL records. No coupling.

For `arc-compound`, the hook could expose `submissionCounts` and
`correctTasks.size` per iteration, giving real-time solve progress.

---

## JSONL File Format

### Why JSONL (not partial JSON, not SQLite, not a binary format)

- **Append-only.** Each record is one line. No need to re-serialize the whole
  file.
- **Streamable.** `tail -f trace.jsonl` works. `jq` works. No special tooling.
- **Crash-safe.** If the process dies, all complete lines are valid. No trailing
  comma or missing `]` to fix.
- **Composable.** `cat *.jsonl | jq ...` merges multiple tasks.

### Record schema

Every line is a JSON object with these common fields:

```jsonc
{
  "type": "iteration",          // "task_start" | "iteration" | "task_end"
  "timestamp": "2026-02-17T...",
  "taskId": "arc3-ls20-cb3b57cc",
  "invocationId": "d1-c0",     // or "root"
  "parentId": "root",           // or null
  "depth": 1,
  "iteration": 3,
  "maxIterations": 30,
  "returned": false,
  "elapsedMs": 42310,
  "entry": {
    "reasoning": "I need to...",
    "code": ["const frame = await arc3.step(4);"],
    "output": "{ state: 'NOT_FINISHED', ... }",
    "error": null,
    "children": [...],          // if traceChildren is on
    "envSnapshot": {...}        // if traceSnapshots is on
  },
  "benchmarkState": {           // only if getIterationMetadata returns data
    "actionCount": 47,
    "levelsCompleted": 2,
    "state": "NOT_FINISHED"
  }
}
```

### `task_start` record

Written before `rlm()` is called. Contains the task ID and initial benchmark
state. The `entry` field has empty values. This record marks "the run has begun"
for monitoring tools.

### `task_end` record

Written after `rlm()` completes (or errors). Contains the final answer, score,
and final benchmark state. Marks "the run is done."

### Example JSONL file

```
{"type":"task_start","timestamp":"2026-02-17T10:00:00Z","taskId":"arc3-ls20","invocationId":"root","parentId":null,"depth":0,"iteration":0,"maxIterations":30,"returned":false,"elapsedMs":0,"entry":{"reasoning":"","code":[],"output":"","error":null}}
{"type":"iteration","timestamp":"2026-02-17T10:00:05Z","taskId":"arc3-ls20","invocationId":"root","depth":0,"iteration":0,"maxIterations":30,"returned":false,"elapsedMs":5000,"entry":{"reasoning":"I'll start the game...","code":["const f = await arc3.start();"],"output":"{...}","error":null},"benchmarkState":{"actionCount":0,"levelsCompleted":0,"state":"NOT_FINISHED"}}
{"type":"iteration","timestamp":"2026-02-17T10:00:45Z","taskId":"arc3-ls20","invocationId":"d1-c0","parentId":"root","depth":1,"iteration":0,"maxIterations":30,"returned":false,"elapsedMs":3200,"entry":{"reasoning":"Analyzing the grid...","code":["const grid = arc3.observe().frame[0];"],"output":"...","error":null},"benchmarkState":{"actionCount":5,"levelsCompleted":0,"state":"NOT_FINISHED"}}
{"type":"iteration","timestamp":"2026-02-17T10:01:30Z","taskId":"arc3-ls20","invocationId":"d1-c0","parentId":"root","depth":1,"iteration":4,"maxIterations":30,"returned":true,"elapsedMs":48200,"entry":{"reasoning":"...","code":["return('done')"],"output":"","error":null},"benchmarkState":{"actionCount":23,"levelsCompleted":1,"state":"NOT_FINISHED"}}
{"type":"iteration","timestamp":"2026-02-17T10:02:00Z","taskId":"arc3-ls20","invocationId":"root","depth":0,"iteration":1,"maxIterations":30,"returned":false,"elapsedMs":120000,"entry":{"reasoning":"Child completed level 1...","code":["..."],"output":"done","error":null,"children":[{"query":"...","depth":1,"answer":"done","iterations":5,"trace":[]}]},"benchmarkState":{"actionCount":23,"levelsCompleted":1,"state":"NOT_FINISHED"}}
{"type":"task_end","timestamp":"2026-02-17T10:15:00Z","taskId":"arc3-ls20","invocationId":"root","depth":0,"iteration":12,"maxIterations":30,"returned":true,"elapsedMs":900000,"entry":{"reasoning":"","code":[],"output":"","error":null},"answer":"{\"score\":14.3}","score":0.143,"benchmarkState":{"actionCount":180,"levelsCompleted":3,"state":"WIN"}}
```

---

## Directory Layout

```
eval/
  results/
    arc3_anthropic_claude-opus-4-6_2026-02-17T10-00-00Z.json    # final result (existing)
    traces/
      2026-02-17T10-00-00Z/
        arc3-ls20-cb3b57cc.jsonl     # streaming trace for this task
        arc3-ft09-abc12345.jsonl     # another task
```

The `traces/` directory is a sibling of the result JSON files. The timestamp
subdirectory matches the run. Each task gets its own JSONL file.

For single-task runs (typical for ARC-3), there is one file. For multi-task
benchmarks like oolong with concurrency, there are many files being written in
parallel -- each to its own fd, so no locking needed.

---

## Consumption

### During a run: `tail -f`

```bash
# Watch root iterations only
tail -f eval/results/traces/*/arc3-ls20*.jsonl | jq -r 'select(.depth == 0) | "\(.iteration)/\(.maxIterations) | actions=\(.benchmarkState.actionCount) levels=\(.benchmarkState.levelsCompleted)"'

# Watch all iterations (root + children)
tail -f eval/results/traces/*/arc3-ls20*.jsonl | jq -c '{inv: .invocationId, iter: .iteration, depth: .depth, actions: .benchmarkState.actionCount}'
```

### After a run: analysis

```bash
# Count iterations per invocation
cat trace.jsonl | jq -r 'select(.type == "iteration") | .invocationId' | sort | uniq -c

# Extract action progression
cat trace.jsonl | jq -r 'select(.benchmarkState) | [.elapsedMs, .benchmarkState.actionCount, .benchmarkState.levelsCompleted] | @csv'

# Find the iteration where level 1 was completed
cat trace.jsonl | jq 'select(.benchmarkState.levelsCompleted == 1) | {iter: .iteration, inv: .invocationId, elapsed: .elapsedMs}' | head -1
```

### Future: live viewer

A simple Node script could `fs.watch()` the JSONL file and render a live
dashboard in the terminal showing:

- Current iteration / max
- Active invocation (root or child ID)
- Action count and levels completed (ARC-3)
- Last code block executed
- Time elapsed

This is not in scope for the initial implementation but the JSONL format supports
it cleanly.

---

## What Changes Where

### `src/rlm.ts` (engine)

| Change | Description |
|--------|-------------|
| Add `IterationEvent` type | New exported interface |
| Add `OnIterationCallback` type | `(event: IterationEvent) => void` |
| Add `onIteration?` to `RlmOptions` | Optional callback field |
| Add `invocationStartTime` local | `Date.now()` at top of `rlmInternal` |
| Fire callback after `trace.push()` | Two sites: normal iteration + return |

Total: ~25 lines added. No structural changes. No new dependencies.

### `eval/harness.ts` (harness)

| Change | Description |
|--------|-------------|
| Add `getIterationMetadata?` to `HarnessConfig` | New optional hook |
| Add `traceStream?` to `HarnessConfig` | Boolean flag |
| Create trace directory in `runEval` | `mkdirSync` for `traces/<timestamp>/` |
| Build `onIteration` in `runSingleTask` | JSONL writer callback |
| Pass `onIteration` to `rlm()` | Thread through existing options |

Total: ~50 lines added.

### `eval/run.ts` (CLI)

| Change | Description |
|--------|-------------|
| Add `--trace-stream` flag parsing | New flag |
| Add to `--trace-full` | Include stream in "all traces" |
| Add `getIterationMetadata` for `arc3` | Read from existing `Arc3Client` state |
| Pass through to harness config | `traceStream`, `getIterationMetadata` |

Total: ~25 lines added.

### `eval/types.ts`

No changes. `StreamingTraceRecord` is internal to harness.ts and not part of the
public eval types.

---

## Design Decisions

### Callback fires for children too

Because `rlmInternal` is recursive and closes over `opts`, children automatically
fire the same `onIteration` callback. The `depth`, `invocationId`, and `parentId`
fields distinguish root iterations from child iterations. This means the JSONL
file interleaves root and child records chronologically -- which is exactly what
you want for understanding the delegation flow.

### No trace data in the callback is deduplicated

The `entry` field in `IterationEvent` is the same `TraceEntry` object that goes
into the final `trace` array. If `traceChildren` is on, child traces appear in
the parent's `entry.children`. If `traceSnapshots` is on, `entry.envSnapshot` is
populated. The streaming record includes whatever tracing options are active.

This means the JSONL file can be large when all trace options are on. That is
acceptable because:

1. It is opt-in (`--trace-stream`).
2. Disk is cheap.
3. The alternative (stripping data) makes analysis harder.

### Callback must not throw

The contract is that `onIteration` must not throw. If the JSONL write fails
(disk full, permissions), the callback should swallow the error and log a
warning. The engine must not crash because of a tracing failure. The harness
wraps the write in a try-catch.

### Callback is synchronous

The callback is `(event: IterationEvent) => void`, not async. This is deliberate:

1. `appendFileSync` is fast for small writes (~microseconds).
2. Making it async would require `await` in the engine's hot loop, adding
   latency between iterations.
3. The callback runs after the trace is pushed but before the next LLM call,
   so a synchronous write is in a natural "gap" where the model is not waiting.

If a future consumer needs async (e.g. pushing to a WebSocket), they can buffer
internally and flush on their own schedule.

### `getIterationMetadata` vs reusing `getResultMetadata`

These are different hooks with different timing:

- `getResultMetadata` is called **once** after `rlm()` completes. It returns data
  for the final `EvalResult.metadata` (e.g. scorecardId, replayUrl).
- `getIterationMetadata` is called **per iteration** during the run. It returns
  point-in-time game state for streaming observability.

They read from the same `Arc3Client` instance, but serve different purposes. The
per-iteration hook must be cheap (no API calls, just reading in-memory state).

### Trace entries include full reasoning text

The `entry.reasoning` field contains the full LLM response. For ARC-3 with Opus,
this can be 2-4KB per iteration. Over 30 iterations with 4 child delegations,
a single JSONL file could be 500KB-2MB. This is acceptable for a debugging/analysis
trace. If size becomes a concern, a future `--trace-compact` flag could strip
reasoning and keep only code + output.

---

## Migration / Backward Compatibility

- `onIteration` is optional. Omitting it changes nothing.
- No existing types are modified (only extended).
- No existing function signatures change.
- The JSONL files are new artifacts, not replacements for the existing result JSON.
- The `--trace-stream` flag defaults to off.

Existing eval commands work identically. The streaming trace is purely additive.

---

## Edge Cases

### Process crash mid-run

JSONL is append-only. All lines written before the crash are valid and readable.
The file simply has no `task_end` record. Analysis tools should handle this: if
the last record is `type: "iteration"` and not `type: "task_end"`, the run was
interrupted.

### Concurrent tasks (concurrency > 1)

Each task writes to its own JSONL file, so there is no interleaving across tasks.
Multiple `appendFileSync` calls to different files from the same Node.js process
are safe.

### Child timeout errors

When a child throws `RlmMaxIterationsError`, the parent catches it. The child's
iterations were already written to JSONL (via `onIteration` firing in the child's
loop). The parent's next iteration -- which processes the error -- also fires
`onIteration`. So the full sequence is captured regardless of whether the child
succeeded or failed.

### Very large env snapshots

If `traceSnapshots` is on, `entry.envSnapshot` can be large (up to 256KB per
the `maxBytes` limit in `JsEnvironment.snapshot`). Over many iterations, this
adds up. The `--trace-stream` and `--trace-snapshots` flags are independent, so
operators can enable streaming without snapshots for lighter output.

### Circular references in trace entries

The engine already handles this in `saveResults` with a `WeakSet`-based
cycle-breaking replacer. The JSONL writer in the harness must use the same
approach. Since `JSON.stringify` is called once per line (not for the whole
file), the `WeakSet` is scoped per record, which is correct.

---

## Implementation Order

1. **Add `IterationEvent`, `OnIterationCallback`, and `onIteration` to
   `src/rlm.ts`.** Fire the callback at the two `trace.push()` sites. Add
   `invocationStartTime`. (~25 lines, engine-only, no behavioral change.)

2. **Add `getIterationMetadata` and `traceStream` to `HarnessConfig`. Build the
   JSONL writer in `runSingleTask`.** Wire `onIteration` through to `rlm()`.
   (~50 lines, harness-only.)

3. **Add `--trace-stream` flag to `run.ts`.** Add `getIterationMetadata` to the
   `arc3` benchmark config. Update `--trace-full` to include streaming. (~25
   lines, CLI-only.)

4. **Test.** Run an ARC-3 game with `--trace-stream` and verify:
   - JSONL file appears and grows during the run.
   - `tail -f ... | jq` shows live progress.
   - `benchmarkState` includes action count and levels.
   - Final result JSON is unchanged.
   - Runs without `--trace-stream` are unchanged.

5. **Optional: Add `getIterationMetadata` to `arc-compound`.** Expose
   `submissionCounts.size` and `correctTasks.size` for real-time solve tracking.

---

## Summary

The total change is approximately 100 lines across three files. The engine gets
one optional callback. The harness writes JSONL. Benchmarks optionally enrich
each record with domain state. The operator gains `tail -f` observability over
30-minute runs for the cost of a few KB of disk per iteration.
