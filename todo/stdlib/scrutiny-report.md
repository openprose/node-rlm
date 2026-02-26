# Scrutiny Report: Standard Library (Phases 1-3)

## Summary

All three phases are in good shape. TypeScript compiles with zero errors. All 162 tests pass (1 skipped: e2e requiring API key). Three issues were found and fixed during review.

---

## Phase 1: Directory Restructure

### Verified

- `plugins/` directory does not exist
- `programs/arc3/` exists with 4 files: root.md, game-solver.md, level-solver.md, oha.md
- `programs/arc2-compound/` exists with 3 files: root.md, orchestrator.md, solver.md
- `lib/drivers/` exists with 21 .md files
- `lib/profiles/` exists with 1 .md file (gemini-3-flash.md)
- `archive/apps/` exists with 17 .md files
- `src/plugins.ts` path constants point to `lib/`, `programs/`, `archive/` -- no `plugins/` references
- Zero stale `plugins/` path references in `src/`, `eval/`, `test/` (excluding function name `loadPlugins`)
- Zero stale `plugins/` path references in `programs/`, `lib/` .md files
- `eval/run.ts` line 114 help text says `programs/<name>/` (correct)
- `LANGUAGE.md` line 429: `programs/{name}/` (correct)
- `CONTAINER.md` line 103: `programs/{name}/` (correct)
- `BACKPRESSURE.md` line 108: `programs/judge/` (correct)

### Issues

None.

---

## Phase 2: app to use Rename

### Verified

- **`src/rlm.ts`**:
  - Sandbox `rlm()` accepts both `use` and `app` (line 542)
  - `use` takes precedence: `const componentName = rlmOpts?.use ?? rlmOpts?.app` (line 551)
  - Deprecation warning emitted when `app` used without `use` (lines 552-554)
  - `RlmOptions` has both `childComponents` (line 36) and `childApps` with `@deprecated` (line 38)
  - Internal resolution: `options.childComponents ?? options.childApps ?? {}` (line 94)
- **`src/events.ts`**:
  - `DelegationSpawnEvent` has both `componentName` (line 99) and `appName` with `@deprecated` (lines 100-101)
- **`src/system-prompt.ts`**:
  - Shows `use?` in options documentation (line 79)
  - Says "use loads a named component for the child" (line 80)
- **`src/plugins.ts`**:
  - `ProgramDefinition` has both `childComponents` (line 167) and `childApps` with `@deprecated` (lines 168-169)
  - `loadProgram()` returns both fields referencing the same object (line 218)
  - `loadStack()` accepts both `use` and `app` (lines 223-225), resolves via `options.use ?? options.app` (line 230)
- **`src/index.ts`**:
  - Exports `RlmOptions` and `DelegationSpawnEvent` types with new fields
- **Program .md files**:
  - Zero `{ app:` references in `programs/` (grep confirmed)
- **Tests**:
  - 9 tests covering `use:`, `app:` backwards compat, precedence, `childApps` compat, `childComponents`, error handling
  - `test/plugins.test.ts`: 6 `loadStack` tests covering `use:`, `app:` backwards compat, precedence
  - Deprecation warnings correctly appear in test stderr
- **Documentation**:
  - Zero `{ app:` references in CONTAINER.md, LANGUAGE.md, README.md, BACKPRESSURE.md
  - Zero `childApps` references in documentation files
  - `OBSERVABILITY.md` shows `componentName` (line 92)

### Issues

None.

---

## Phase 3: Standard Library Components

### Verified

- All 17 files exist:
  - `lib/composites/` (7): worker-critic, proposer-adversary, observer-actor-arbiter, ensemble-synthesizer, dialectic, witness, ratchet
  - `lib/roles/` (5): critic, summarizer, classifier, verifier, extractor
  - `lib/controls/` (5): retry-with-learning, progressive-refinement, map-reduce, pipeline, gate
- All `.gitkeep` files removed
- Every file has well-formed YAML frontmatter with `kind: program-node`
- Composites and controls have `role: coordinator`; roles have `role: leaf`
- `slots` present on all composites and controls where applicable (pipeline uses `slots: []` with `stages` array convention)
- Contracts present (`requires:` and `ensures:`) in every file
- Voice is direct and imperative -- matches existing program nodes
- Zero domain-specific references (no ARC, game, grid, level, frame, pixel)
- Children don't know they're part of a composite (verified in all Notes sections)
- All delegation code uses `{ use: "name" }` (new syntax)
- State conventions: composites use `&compositeState`, controls use `&controlState`, roles have empty state

### Issues Found and Fixed

**1. `witness.md` -- delegation code didn't implement the diff** (FIXED)

The contract promises `Returns { agreed, discrepancies, confidence }` but the original code constructed a `diffBrief` string that was never used, set a static `diffAnalysis` string, and returned `{ report_a, report_b }` instead. The code was incomplete -- it had the scaffolding for a diff but skipped the implementation.

Fixed by: replacing the dead code with an actual diff implementation that splits reports into findings, classifies agreements vs. discrepancies by source, and computes a confidence ratio. The coordinator performs the diff itself (structural work, not delegated to a slot), consistent with the design note in the handoff.

**2. `progressive-refinement.md` -- incomplete expression on line 82** (FIXED)

The code had `__controlState.rounds_used = Math.min(max_rounds, /* actual rounds */);` -- a placeholder comment instead of a real value. Additionally, even if the comment were replaced with `round + 1`, `round` is scoped inside the `for` loop and would be a `ReferenceError` at that point.

Fixed by: adding a `roundsUsed` counter outside the loop, incrementing it at the start of each iteration, and using it after the loop exits.

---

## Cross-Cutting Checks

### Verified

- `README.md` project structure section reflects new layout (programs/, lib/, archive not shown but appropriate)
- `LANGUAGE.md` references correct paths (`programs/{name}/`)
- `CONTAINER.md` uses `{ use: "name" }` consistently throughout
- `BACKPRESSURE.md` references `programs/judge/` (correct)
- `src/index.ts` exports the right types including `RlmOptions` with `childComponents`
- `npx tsc --noEmit` passes with zero errors
- `npx vitest run` passes: 162 tests, 1 skipped (e2e)

### Issues Found and Fixed

**3. `README.md` -- "(future)" annotations on lib subdirectories** (FIXED)

Lines 190-192 described `lib/composites/`, `lib/roles/`, `lib/controls/` as "(future)" even though Phase 3 populated them with 17 components. Changed to "(standard library)".

---

## Overall Assessment

The three phases are well-executed. The directory restructure is clean with no stale references. The rename maintains full backwards compatibility with proper deprecation warnings and precedence rules. The standard library components are well-written, domain-agnostic, and follow consistent conventions.

The two code issues in Phase 3 (witness.md diff and progressive-refinement.md counter) are the kind of bugs that illustrative code accumulates -- the prose contracts were correct, but the JavaScript didn't fully implement them. Both are fixed.

## Remaining Follow-Up Items

1. **No `loadLib()` function yet.** The plan calls for engine-side name resolution that scans `lib/` and registers library components as a fallback dictionary. This is not implemented. Library components exist as files but are not discoverable by the engine at runtime. Programs can only use components declared in their own directory. This is acknowledged in the Phase 3 handoff as deferred work.

2. **No integration test for library components.** The Phase 3 handoff notes that a non-ARC program composing library components would be the right first exercise. None exists yet.

3. **`TENETS.md` and `BACKPRESSURE.md` are untracked.** The Phase 1 handoff notes BACKPRESSURE.md was never committed. These should be committed when the stdlib work is committed.
