# RLM Observability

The RLM engine emits structured events during execution. An observer collects these events and makes them available for analysis, visualization, or streaming. The system is recursive — events propagate through the full delegation tree, not just the root invocation.

## Quick start

```typescript
import { rlm, RlmObserver } from "node-rlm";

const observer = new RlmObserver();

const result = await rlm("What is 2 + 2?", undefined, {
  callLLM: myDriver,
  observer,
});

// All events from the run
const events = observer.getEvents();

// Filter by type
const llmCalls = observer.getEvents({ type: "llm:response" });

// Reconstruct the delegation tree
const tree = observer.getTree(events[0].runId);
```

## Architecture

**Engine → Sink → Observer**

The engine emits events through an `RlmEventSink` interface (a single `emit(event)` method). `RlmObserver` is the built-in implementation that collects events in memory and provides query/subscription APIs. You can also implement `RlmEventSink` directly for custom consumers (streaming, logging, metrics).

```
rlm() ──emit──▶ RlmEventSink ──▶ RlmObserver
                                    ├── .on(type, handler)
                                    ├── .getEvents(filter?)
                                    └── .getTree(runId)
```

The `observer` option on `RlmOptions` accepts any `RlmEventSink`. When set, the engine emits events at every code seam. When omitted, no events are emitted and there is zero overhead.

Handler faults are isolated: if an `.on()` handler throws, the exception is caught and suppressed so it cannot corrupt the engine's execution loop.

## Event model

Every event extends a common base shape:

| Field          | Type             | Description                                                |
|----------------|------------------|------------------------------------------------------------|
| `runId`        | `string`         | Unique ID for the top-level `rlm()` call                   |
| `timestamp`    | `number`         | `performance.now()` at emission time (monotonic ms, not epoch) |
| `invocationId` | `string`         | Unique ID for this invocation (root or child)               |
| `parentId`     | `string \| null` | Parent's `invocationId`, or `null` for the root             |
| `depth`        | `number`         | Delegation depth (0 = root)                                 |

Events form a discriminated union on the `type` field. TypeScript narrows automatically:

```typescript
observer.on("llm:response", (event) => {
  // event is LlmResponseEvent — fully typed
  console.log(event.duration, event.code);
});
```

## Event catalog

### Lifecycle events

| Type | Emitted when | Key fields |
|------|-------------|------------|
| `run:start` | Top-level `rlm()` begins | `query`, `maxIterations`, `maxDepth` |
| `run:end` | Top-level `rlm()` completes | `answer`, `error`, `iterations` |
| `invocation:start` | Any invocation (root or child) begins | `query`, `systemPrompt` |
| `invocation:end` | Any invocation completes | `answer`, `error`, `iterations` |
| `iteration:start` | REPL loop iteration begins | `iteration`, `budgetRemaining` |
| `iteration:end` | REPL loop iteration completes | `iteration`, `code`, `output`, `error`, `returned` |

### LLM events

| Type | Emitted when | Key fields |
|------|-------------|------------|
| `llm:request` | LLM call starts | `iteration`, `messageCount`, `systemPromptLength` |
| `llm:response` | LLM call returns | `iteration`, `duration`, `reasoning`, `code`, `hasToolUse`, `usage` |
| `llm:error` | LLM call fails | `iteration`, `error`, `duration` |

`usage` is a `TokenUsage` object with optional `promptTokens`, `completionTokens`, `cacheReadTokens`, `cacheWriteTokens`. Availability depends on the `callLLM` driver — not all drivers populate this field.

### Delegation events

| Type | Emitted when | Key fields |
|------|-------------|------------|
| `delegation:spawn` | Child `rlm()` call starts | `childId`, `query`, `modelAlias?`, `maxIterations?`, `appName?` |
| `delegation:return` | Child returns successfully | `childId`, `answer`, `iterations` |
| `delegation:error` | Child throws | `childId`, `error`, `iterations` |
| `delegation:unawaited` | Iteration ends with unawaited child promises | `count` |

Delegation events are emitted by the **parent** invocation. The child's own lifecycle/iteration/LLM events are emitted under the child's `invocationId`.

### Sandbox events

| Type | Emitted when | Key fields |
|------|-------------|------------|
| `sandbox:snapshot` | After each iteration completes | `iteration`, `state` |

`state` is a deep copy of user-defined sandbox globals at iteration end. Built-in bindings (`console`, `require`, `rlm`, timers, etc.) are excluded from the snapshot.

## RlmObserver API

### `emit(event: RlmEvent): void`

Implements `RlmEventSink`. Stores the event and dispatches to registered handlers. You normally don't call this directly — the engine calls it.

### `on(type, handler): void`

Subscribe to events of a specific type. Handlers are called synchronously during `emit()`. If a handler throws, the error is caught and suppressed. There is no `off()` method — handlers cannot be removed. Create a new observer if you need a clean slate.

```typescript
observer.on("iteration:end", (event) => {
  if (event.error) console.error(`Iteration ${event.iteration} failed: ${event.error}`);
});
```

### `getEvents(filter?): RlmEvent[]`

Returns a copy of collected events, optionally filtered:

```typescript
interface EventFilter {
  runId?: string;
  invocationId?: string;
  type?: RlmEvent["type"] | RlmEvent["type"][];
}

// All events
observer.getEvents();

// Events for a specific invocation
observer.getEvents({ invocationId: "abc-123" });

// Multiple types
observer.getEvents({ type: ["llm:request", "llm:response"] });
```

### `getTree(runId): TreeNode | null`

Reconstructs the delegation tree from `invocation:start` and `delegation:spawn` events:

```typescript
interface TreeNode {
  invocationId: string;
  children: TreeNode[];
}

const tree = observer.getTree(runId);
// { invocationId: "root-id", children: [
//   { invocationId: "child-1", children: [] },
//   { invocationId: "child-2", children: [...] }
// ]}
```

## Custom sinks

Implement `RlmEventSink` for custom event handling:

```typescript
import type { RlmEventSink, RlmEvent } from "node-rlm";

const streamingSink: RlmEventSink = {
  emit(event: RlmEvent) {
    process.stdout.write(JSON.stringify(event) + "\n");
  },
};

await rlm("query", undefined, { callLLM: myDriver, observer: streamingSink });
```

## Eval harness integration

The eval harness (`eval/harness.ts`) creates a fresh `RlmObserver` per task and stores collected events in `EvalResult.events`. The analysis script (`eval/analyze.ts`) reads these events to compute code volume, behavioral patterns, and iteration statistics. The viewer (`eval/viewer.html`) renders event timelines with iteration cards, LLM timing, and expandable child delegation trees.
