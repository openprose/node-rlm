# Phase 3 Handoff: Wire Emit into rlm.ts

## Summary

**`src/rlm.ts`:**
- Imported `RlmEvent` and `RlmEventSink` from `./events.js`.
- Added `observer?: RlmEventSink` to `RlmOptions`.
- Created `emit` binding and `runId` (via `globalThis.crypto.randomUUID()`) at the top of `rlm()`.
- `run:start` / `run:end` — wraps the `rlmInternal(...)` call at the bottom of `rlm()` in try/catch/finally.
- `invocation:start` — after `buildSystemPrompt()` in `rlmInternal`.
- `invocation:end` — in a try/catch/finally that wraps the for-loop and max-iterations throw. The catch captures `invocationError` before rethrowing.
- `iteration:start` — top of the for-loop.
- `iteration:end` + `sandbox:snapshot` — in a finally block inside the for-loop. Snapshot is guarded with `if (emit)`.
- `llm:request` — before `callLLM()`, with `performance.now()` timer start.
- `llm:response` — after `callLLM()` returns. Includes duration, reasoning, code, usage (cast through `unknown`).
- `llm:error` — in the callLLM catch block. Includes duration and error message.
- `delegation:spawn` — in the sandbox `rlm` callback, after `childInvocationId` is computed.
- `delegation:return` — after child `rlmInternal` resolves successfully.
- `delegation:error` — after child `rlmInternal` rejects (new catch block added; rethrows after emitting).
- `delegation:unawaited` — where the existing unawaited-call warning is generated.

**`src/index.ts`:** No changes needed. `RlmEventSink` and `RlmEvent` were already exported.

**`test/observer.test.ts`:** New file with 10 tests:
1. Happy path: correct order and fields (runId, timestamp, invocationId present).
2. `iteration:start` count equals `iteration:end` count.
3. `llm:error` fires when callLLM throws; `iteration:end`, `invocation:end`, `run:end` all carry the error.
4. Max iterations: `invocation:end` and `run:end` fire with error.
5. Delegation events fire for child `rlm()` calls.
6. `sandbox:snapshot` fires after each iteration.
7. No observer: rlm works normally without events.
8. `llm:request` includes message count and system prompt length.
9. `llm:response` includes reasoning, code, and duration.
10. `iteration:end` has `returned=true` on normal return, `returned=false` otherwise.

## Test results

```
npx tsc --noEmit
(clean -- no errors)

npx vitest run
 Test Files  6 passed | 1 skipped (7)
      Tests  138 passed | 1 skipped (139)
```

## Decisions made

- **`usage` field on `llm:response`:** `CallLLMResponse` does not declare a `usage` property. Drivers may attach it at runtime. Used `(response as unknown as Record<string, unknown>).usage` to forward it without modifying the `CallLLMResponse` interface.
- **`invocationError` capture:** Added a `catch` block to the outer try (around the for-loop + max-iterations throw) that sets `invocationError` before rethrowing. Without this, errors thrown from `callLLM` would bypass the `invocationError` assignment and `invocation:end` would report `error: null`.

## Gaps or ambiguities

None.

## Code to double-check

None.
