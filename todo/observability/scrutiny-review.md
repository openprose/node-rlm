# Observability Implementation: Scrutiny Review

**Date:** 2026-02-24
**Reviewer:** Claude Opus 4.6 (automated code review)
**Scope:** 5-phase observability implementation (commits 45d1db3 through a964681)
**Files reviewed:** `src/events.ts`, `src/observer.ts`, `src/rlm.ts`, `src/index.ts`, `eval/types.ts`, `eval/harness.ts`, `eval/analyze.ts`, `test/observer.test.ts`, `eval/run.ts`, `eval/verify.ts`, `src/cli.ts`, plus all design docs and handoff files.

---

## Summary

The implementation is clean, correct, and complete. All 14 event types from DESIGN.md are defined in `events.ts` and emitted from `rlm.ts`. TypeScript compilation passes with zero errors. All 155 tests pass. No references to removed trace machinery remain in `src/`, `eval/` code files, or `test/`. The emit closure pattern follows the design precisely. The observer is optional and introduces zero behavior change when omitted.

The code reads as though observability was always part of the design, which was the stated goal. The implementation is notably free of over-engineering: no event builders, no wrapper classes, no helper utilities for one-time operations. The few issues found below are all minor.

---

## Critical Issues (must fix)

### C1. `delegation:return` and `delegation:error` read stale `parentId` from sandbox

**File:** `src/rlm.ts:607, 620`

The `delegation:return` and `delegation:error` events read `parentId` from `env.get("__rlm")` at the time the child's promise resolves:

```typescript
parentId: (env.get("__rlm") as DelegationContext | undefined)?.parentId ?? null,
```

This fires *after* `rlmInternal` completes for the child. The child's execution sets `__rlm` to the child's delegation context (line 384-395) during each of its code execution blocks. Because `__rlm` is a shared sandbox global and is overwritten before each `env.exec()`, the value read on lines 607/620 may reflect the *child's* `__rlm` rather than the *parent's*.

In practice, this is mitigated because `__rlm` is set by the `rlmInternal` that is actively running code blocks, and the async promise resolution happens after the child's `rlmInternal` returns (no more code blocks to set `__rlm`). However, with parallel delegations, one child could finish while another child's `rlmInternal` is actively executing code blocks, at which point `__rlm` would reflect the executing child's context.

The `delegation:spawn` event at line 590 has the same pattern but fires synchronously before the child starts, so it reads the correct value.

**Recommended fix:** Capture `parentId` at spawn time (alongside `callerInvocationId` on line 577) and use the captured value in all three delegation events:

```typescript
const callerParentId = (env.get("__rlm") as DelegationContext | undefined)?.parentId ?? null;
```

Then use `callerParentId` on lines 590, 607, and 620. This mirrors how `callerInvocationId` is already captured once and reused.

---

## Important Issues (should fix)

### I1. `llm:response` calls `performance.now()` twice, producing inconsistent `timestamp` and `duration`

**File:** `src/rlm.ts:355-363`

```typescript
emit?.({
    type: "llm:response",
    runId,
    timestamp: performance.now(),    // call 1
    ...
    duration: performance.now() - llmStart,  // call 2
});
```

Two calls to `performance.now()` in the same event object literal means `duration` is computed from a slightly later time than `timestamp`. The difference is microseconds, but it makes `timestamp` and `duration` logically inconsistent: a consumer computing `timestamp - llm:request.timestamp` would get a different number than `duration`.

**Recommended fix:** Capture `const llmEnd = performance.now()` once, then use it for both fields:

```typescript
const llmEnd = performance.now();
emit?.({
    type: "llm:response",
    timestamp: llmEnd,
    duration: llmEnd - llmStart,
    ...
});
```

### I2. Same double-call issue in `llm:error`

**File:** `src/rlm.ts:343-349`

Same pattern: `timestamp: performance.now()` and `duration: performance.now() - llmStart` are two separate calls.

**Recommended fix:** Same as I1.

### I3. `analyze.ts` silently produces empty analysis for old result files

**File:** `eval/analyze.ts:28`

Phase 5 removed the `LegacyTraceEntry` backward-compatibility code from Phase 2. Now `analyzeTask` reads `result.events ?? []`. Old result files (with `trace` but no `events`) will produce `events = []`, resulting in zero iterations, zero code blocks, etc. The analysis will silently produce meaningless zeros instead of failing or warning.

The Phase 5 PHASES.md spec says "Do not add backwards compatibility for old result files with `trace`. Old files are old files. If `analyze.ts` is run on them, it can fail or skip gracefully." The current behavior is technically "skip gracefully" (it returns zeros), but it's misleading rather than graceful since it produces data that looks valid but is empty.

**Recommended fix:** At the top of `analyzeTask`, if `events` is empty/undefined and the result has iterations > 0, log a warning and skip the task (or mark it as having no events). Alternatively, just document this in a comment.

### I4. `eval/viewer.html` is broken for new results, not updated

**File:** `eval/viewer.html:600-601, 774-775`

The viewer references `result.trace` which no longer exists. Phase 2's handoff noted this as a known gap. New result files will render with no trace timeline. This is a usability regression for anyone using the viewer.

**Recommended fix:** Either update the viewer to consume `result.events` (rendering iteration/delegation events as a timeline), or add a comment at the top of the file noting it needs updating, or remove it if it's deprecated. This is not urgent since the viewer was already noted as a known gap.

---

## Minor Issues (nice to fix)

### M1. `usage` field uses double unsafe cast

**File:** `src/rlm.ts:367`

```typescript
usage: (response as unknown as Record<string, unknown>).usage as import("./events.js").TokenUsage | undefined,
```

This is a necessary workaround since `CallLLMResponse` doesn't declare `usage`, but it's a messy double cast plus a dynamic import type annotation. Phase 3's handoff documented this decision.

**Recommended fix (deferred):** Add `usage?: TokenUsage` to `CallLLMResponse` (or a more general `Record<string, unknown>` extension field). This was mentioned in DESIGN.md as a separate incremental change. When that happens, remove this cast.

### M2. No `.off()` method on `RlmObserver`

**File:** `src/observer.ts`

The observer supports `.on()` but has no way to remove handlers. This isn't needed for any current use case (the observer lives for a single run), but it's a common expectation for event emitter APIs. The design docs don't call for it.

**Recommended fix:** Not needed now. If someone needs it, add it then.

### M3. `fakeEvent` helper in tests uses `as RlmEvent` cast

**File:** `test/observer.test.ts:254-263`

```typescript
function fakeEvent(overrides: Partial<RlmEvent> & { type: RlmEvent["type"] }): RlmEvent {
    return {
        runId: "run-1",
        timestamp: Date.now(),
        invocationId: "root",
        parentId: null,
        depth: 0,
        ...overrides,
    } as RlmEvent;
}
```

The `as RlmEvent` cast bypasses type checking on required event-specific fields. This is fine for unit tests where partial events are sufficient, but it means the tests wouldn't catch a missing required field.

**Recommended fix:** Acceptable as-is for unit tests. Just noting it.

### M4. `EvalResult.events` is optional (`events?`) rather than required

**File:** `eval/types.ts:29`

```typescript
events?: RlmEvent[];
```

This makes it optional, which means old result files (without `events`) can still be typed as `EvalResult`. But it also means new code must handle the `undefined` case everywhere. Since the harness always populates it (even as `[]` in the error path at harness.ts:149), it could be required.

**Recommended fix:** Making it required would break parsing of old result JSON files via `JSON.parse() as BenchmarkResult`. Keeping it optional is the pragmatic choice. Just noting the tradeoff.

### M5. `eval/verify.ts` sample `EvalResult` doesn't include `events`

**File:** `eval/verify.ts:75-83`

The sample `EvalResult` object doesn't include `events`. This is fine because `events` is optional, but if it's ever made required (M4), this would break.

**Recommended fix:** Add `events: []` to the sample for completeness. Low priority.

---

## Missing Items (to implement)

### No missing items from the design spec.

All event types are defined and emitted. The observer implements `.on()`, `getEvents()`, and `getTree()`. The eval harness creates an observer per task and collects events. The analysis reads from events. The trace machinery is fully removed. Exports are complete.

### Future work noted in the design (not part of this implementation):

1. **`usage` field on `CallLLMResponse`** -- DESIGN.md notes this as a separate incremental change when the driver is updated to parse the API's usage response.
2. **`model` label on root `llm:request`/`llm:response`** -- DESIGN.md notes an optional `modelLabel` on `RlmOptions` as future work.
3. **`viewer.html` update** -- needs to consume events instead of trace (noted in I4).
4. **Delta snapshots and sub-iteration tracking** -- noted as future work in DESIGN.md Bucket 4 discussion.
5. **Control plane (pause/resume gates)** -- event seams are in place; gating is future work.

---

## Observations

### Well done

1. **Closure capture pattern is clean.** The `emit` binding at the top of `rlm()` (lines 104-106) follows the same pattern as every other shared binding. No parameter threading, no singletons.

2. **`iteration:end` always fires.** The `finally` block at line 484 ensures matching pairs regardless of exit path (return, continue, or error). This is the right structure.

3. **`sandbox:snapshot` is correctly guarded.** Line 499 uses `if (emit)` for the expensive serialization path, while cheap events use `emit?.()`. This follows the design's cheap/expensive split.

4. **No trace artifacts remain.** Grep confirms zero hits for `TraceEntry`, `ChildTrace`, `traceChildren`, `traceSnapshots` in `src/`, `eval/` code files, and `test/`. The remaining hits are in `eval/analyses/` which are historical analysis documents, not code.

5. **`RlmObserver.getEvents()` returns a copy.** Line 43 in `observer.ts` uses `[...this.events]`, preventing accidental mutation of the internal array.

6. **`getTree()` handles edge cases.** Returns `null` for unknown runId. Handles multiple children. Ignores events from other runs.

7. **Tests are thorough.** 27 observer-specific tests cover the happy path, error paths, delegation, max iterations, matching pairs, snapshot emission, no-observer mode, event fields, and the observer's own unit tests (filtering, tree reconstruction).

8. **The `invocationError` capture pattern** (line 301, 518-520) correctly handles both loop-exhaustion and callLLM-throw paths, ensuring `invocation:end` always reports the error.

9. **The handoff files are exemplary.** Each phase's handoff is clear, complete, and documents decisions. The "gaps or ambiguities" sections are honest about known issues (e.g., viewer.html).

### Patterns to preserve

- **Emit before action, not after** (e.g., `run:start` before `rlmInternal`, `delegation:spawn` before the child starts). This is correct for future control-plane gating.
- **Event context is explicit at every call site.** No ambient "current invocation" state. Every emit call specifies its own `runId`, `invocationId`, `parentId`, `depth`.
- **Observer is a value object passed via options.** No global singleton, no magic context.
- **`BaseEvent` is not exported.** Consumers use the specific event interfaces or `RlmEvent` union. The base is an implementation detail.
