# Observability Implementation: Second-Pass Review

**Date:** 2026-02-24
**Scope:** Verification of scrutiny-review fixes + fresh sweep of all observability files
**Files reviewed:** `src/rlm.ts`, `src/events.ts`, `src/observer.ts`, `src/index.ts`, `eval/types.ts`, `eval/harness.ts`, `eval/analyze.ts`, `eval/verify.ts`, `eval/viewer.html`, `test/observer.test.ts`

---

## Fix Verification

### C1. Stale `parentId` in delegation events -- VERIFIED CORRECT

`callerParentId` is captured at line 580 of `src/rlm.ts`, immediately after `callerInvocationId` at line 579, both reading from `env.get("__rlm")` synchronously at spawn time (before any child work begins). The captured value is used in all three delegation events:

- `delegation:spawn` (line 593): `parentId: callerParentId`
- `delegation:return` (line 610): `parentId: callerParentId`
- `delegation:error` (line 623): `parentId: callerParentId`

This is exactly the recommended fix. The async promise resolution (lines 602-633) uses the closed-over `callerParentId`, not a fresh read from `env.get("__rlm")`. No concerns.

### I1. Double `performance.now()` in `llm:response` -- VERIFIED CORRECT

`const llmEnd = performance.now()` is captured once at line 356. Used for:
- `timestamp: llmEnd` (line 360)
- `duration: llmEnd - llmStart` (line 365)

No concerns.

### I2. Double `performance.now()` in `llm:error` -- VERIFIED CORRECT

`const llmEnd = performance.now()` is captured once at line 340 (inside the catch block). Used for:
- `timestamp: llmEnd` (line 344)
- `duration: llmEnd - llmStart` (line 350)

The handoff notes that the catch block's `llmEnd` and the post-try `llmEnd` are in separate scopes. Confirmed: the catch block throws at line 353, so execution never falls through to line 356. No shadowing or naming conflict. No concerns.

### I3. Silent empty analysis -- VERIFIED CORRECT

Line 29-31 of `eval/analyze.ts`:
```typescript
if (events.length === 0 && result.iterations > 0) {
    console.warn(`[analyze] ${result.taskId}: no events (pre-observability result file), code analysis will be empty`);
}
```

This correctly detects old result files (no events but iterations > 0) and warns to stderr. The analysis continues with zeros, which is the "skip gracefully" behavior the spec requested. The warning makes the zeros non-misleading. No concerns.

### I4. Viewer updated for events -- VERIFIED CORRECT, ONE MINOR ISSUE

Lines 599-609 of `eval/viewer.html`:
```javascript
if (result.events && result.events.length > 0) {
    inner.appendChild(renderEventTimeline(result.events));
} else if (result.trace && result.trace.length > 0) {
    inner.appendChild(renderTimeline(result.trace, 0));
} else {
    const noTrace = document.createElement('div');
    noTrace.className = 'no-data';
    noTrace.textContent = 'No trace/event data available';
    inner.appendChild(noTrace);
}
```

Correct three-way fallback: events first, legacy trace second, no-data message third. The `renderEventTimeline` and `renderEventIterCard` functions are well-structured: they group events by invocationId, render iteration cards with reasoning/code/output/error, and support expandable child delegations with lazy rendering.

**Minor viewer issue:** See N2 below.

---

## New Issues Found

### N1. (Minor) Observer `emit` does not isolate handler faults

**File:** `src/observer.ts:20-28`

If a user-registered `on()` handler throws, the exception propagates through `emit()`, through the closure in `rlm.ts:105`, and into the rlm execution loop. This could corrupt the agent's iteration flow (e.g., a throw inside `iteration:end` emission in the `finally` block would suppress the normal return or re-throw).

The current codebase only registers handlers in tests, so this is not a practical risk today. But the `on()` API is public and exported, so external consumers could register faulty handlers.

**Recommended fix (deferred):** Wrap handler calls in try-catch in `observer.ts`:
```typescript
for (const handler of handlers) {
    try {
        (handler as EventHandler<typeof event>)(event);
    } catch (err) {
        // Log but don't propagate -- observability must not break execution
    }
}
```

This is low priority since the eval harness (the only production consumer) does not register handlers. It should be fixed before exposing the observer as a public API for third-party consumers.

### N2. (Minor) Viewer shows all children on every iteration card

**File:** `eval/viewer.html:735-743, 820-824`

The `findDelegationIter` function always returns `iterEnd.iteration`, and `iterEnd.iteration === iterNum` by construction (since `iterData.iterEnd` is the end event for `iterNum`). So the condition `iterNum === findDelegationIter(ie, children)` is always true. Combined with the fact that `children` is collected globally for the invocationId (not filtered per-iteration), this means ALL children of the invocation are rendered on EVERY iteration card, not just the iteration that spawned them.

In practice, most single-delegation cases show correctly because there's only one child. The bug surfaces with multiple children spawned across different iterations -- each child would appear duplicated on every iteration card.

**Recommended fix:** Filter children by the iteration they were spawned during. Since `delegation:spawn` doesn't carry the parent's iteration number, the best heuristic is to use timestamp ordering: assign each child to the iteration whose `iteration:end` timestamp is the first one >= the child's `delegation:spawn` timestamp. Alternatively, show all children only on the last iteration (which the comment says is the intent, but the code doesn't implement):

```javascript
function findDelegationIter(iterEnd, children) {
    if (!iterEnd) return 0;
    // Show all children grouped at the last iteration
    return Math.max(...children.map(c => {
        const inv = c.childInv;
        if (!inv) return 0;
        return Math.max(...[...inv.iterations.keys()]);
    }).concat([iterEnd.iteration]));
}
```

Or more simply, only render children on the maximum iteration number:
```javascript
if (children.length > 0 && iterNum === Math.max(...inv.iterations.keys())) {
```

### N3. (Minor) `saveResults` WeakSet replacer may suppress shared (non-circular) references

**File:** `eval/harness.ts:403-414`

The `WeakSet`-based circular reference replacer marks any previously seen object as `"[circular]"`. This is correct for true cycles, but it also suppresses legitimate shared references (the same object appearing in two places without forming a cycle). In depth-first traversal, after the first subtree containing the shared object completes, the second reference is replaced with `"[circular]"`.

In practice, event objects are constructed with fresh object literals at each emit site, so shared references between events are extremely unlikely. The `sandbox:snapshot` values are deep-copied via `JSON.parse(JSON.stringify())`. The `usage` object comes from a fresh API response per call. This is a theoretical concern only.

**Recommended fix:** No action needed now. If shared references ever become likely (e.g., event payloads that reference shared state), switch to a proper cycle-detection algorithm (track the current ancestor path, not all previously seen objects).

---

## Remaining Minor Issues (from first review)

### M1. `usage` field uses double unsafe cast -- Status: UNCHANGED, ACCEPTABLE

Still present at `src/rlm.ts:369`. The `as unknown as Record<string, unknown>` double cast is ugly but necessary until `CallLLMResponse` gains a `usage` field. Not worth fixing separately -- it will be cleaned up when the driver is updated to parse usage from the API response. Stays minor.

### M2. No `.off()` method on `RlmObserver` -- Status: UNCHANGED, ACCEPTABLE

Still not needed. The observer is created per-task in the harness and lives for a single `rlm()` call. No consumer needs to remove handlers mid-run. If `on()` handler fault isolation is added (N1 above), `.off()` becomes even less necessary since handlers can't accidentally break things. Stays minor.

### M3. `fakeEvent` helper uses `as RlmEvent` cast -- Status: UNCHANGED, ACCEPTABLE

Still present at `test/observer.test.ts:254-263`. The cast bypasses type checking on event-specific required fields. This is the standard pattern for test helpers that need partial objects. The integration tests (`observer.test.ts:423-495`) use real `rlm()` calls with full events, providing the type safety coverage that the unit tests skip. Stays minor.

### M4. `EvalResult.events` is optional -- Status: UNCHANGED, ACCEPTABLE

Still `events?: RlmEvent[]` at `eval/types.ts:29`. The harness always populates it (line 278 success path, line 297 error path, line 149 outer-catch path). Making it required would break `JSON.parse() as BenchmarkResult` for old result files. The I3 fix (warning on empty events) mitigates the downstream impact. Stays minor.

### M5. `eval/verify.ts` sample `EvalResult` doesn't include `events` -- Status: UNCHANGED, ACCEPTABLE

Still missing at `eval/verify.ts:75-83`. Since `events` is optional (M4), this compiles and runs fine. If events is ever made required, this would break at compile time (which is the correct behavior -- it would force updating the sample). Stays minor.

**Assessment:** None of the 5 minor issues should be upgraded. They are all either deliberate tradeoffs or deferred cleanup.

---

## Test Verification

### TypeScript compilation
```
$ npx tsc --noEmit
(no output -- clean)
```

### Test suite
```
$ npx vitest run
Test Files  6 passed | 1 skipped (7)
     Tests  155 passed | 1 skipped (156)
```

All 27 observer-specific tests pass. The skipped test is `test/e2e.test.ts` (requires API key).

### Stale trace reference check

- `src/`: 0 matches for `TraceEntry|ChildTrace|traceChildren|traceSnapshots`
- `eval/` code files: 0 matches (6 matches in `eval/analyses/` historical documents -- expected)
- `test/`: 0 matches

The only reference to `trace` in `eval/viewer.html` is the legacy fallback path (line 602: `result.trace`), which is correct -- it renders old result files that predate the observability system.

---

## Final Assessment

**The implementation is ready for production use.** All 5 fixes from the scrutiny review are correctly applied. No regressions introduced. TypeScript compiles cleanly, all tests pass, no stale references remain.

### Outstanding work before shipping: None required.

### Recommended follow-up work (non-blocking):

1. **N1 (handler fault isolation):** Add try-catch around `on()` handler calls in `observer.ts`. Do this before advertising the observer API to third-party consumers.
2. **N2 (viewer child grouping):** Fix the `findDelegationIter` logic so children appear on the correct iteration card. Low urgency since the viewer is a diagnostic tool, not a user-facing product.
3. **N3 (saveResults replacer):** No action needed unless shared object references become possible in event payloads.
4. **M1 (usage cast):** Clean up when `CallLLMResponse` gains a `usage` field.
