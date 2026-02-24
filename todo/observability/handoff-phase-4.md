# Phase 4 Handoff: RlmObserver

## Summary

**Files created:**
- `src/observer.ts` — `RlmObserver` class implementing `RlmEventSink` with event collection, typed `.on()` handlers, `getEvents(filter?)`, and `getTree(runId)`.

**Files modified:**
- `src/index.ts` — Added exports for `RlmObserver`, `EventFilter`, and `TreeNode`.
- `test/observer.test.ts` — Added 16 unit tests for `RlmObserver` and 3 integration tests with `rlm()`.

## Test results

```
npx tsc --noEmit
# (clean — no output)

npx vitest --run
# 155 passed | 1 skipped (the e2e test, pre-existing skip)
# All 27 observer tests pass (11 existing + 16 new)
```

## Decisions made

- `getEvents()` returns a shallow copy of the array (not a reference) to prevent accidental mutation.
- `getTree()` returns `null` (not an empty node) when no events match the `runId`.
- `EventFilter.type` accepts a single string or an array of strings. Array means "any of these types."
- Filters combine with AND logic (all specified fields must match).
- `TreeNode` is a plain interface, not a class.

## Gaps or ambiguities

None.

## Code to double-check

None.
