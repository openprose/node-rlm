# Documentation Consistency Report

Post-stdlib (phases 1-3) review of all project documentation for stale references, conflicts, and gaps.

## Files Reviewed

- `README.md`
- `TENETS.md`
- `CONTAINER.md`
- `LANGUAGE.md`
- `BACKPRESSURE.md`
- `OBSERVABILITY.md`

## Changes Made

### LANGUAGE.md -- Two stale `app` references (FIXED)

1. **Line 119**: Comment `# child app names this node delegates to` changed to `# child component names this node delegates to`.
2. **Line 273**: Prose `` `delegates` maps child app names to the capabilities they own `` changed to `` `delegates` maps child component names to the capabilities they own ``.

These were missed during Phase 2 because they are inside a YAML comment and descriptive prose, not in `{ app: "name" }` call syntax.

### TENETS.md -- Stale "Plugins/Apps" tenet (FIXED)

Section heading "Plugins are Programs Written in Prose" and body text "Drivers and apps are markdown files" / "Apps are task architectures (run one)" referenced the archived `apps/` concept. Updated heading to "Programs are Written in Prose" and body to reference drivers, components, and programs -- the current vocabulary.

## No Changes Needed

### README.md

- Project structure section correctly shows `programs/`, `lib/`, and the three stdlib subdirectories with "(standard library)" annotations.
- Plugins section heading is still "Plugins" -- this is fine because the import path is `node-rlm/plugins` and the function is `loadPlugins`. The concept name matches the API.
- All path references use `lib/drivers/`, `lib/profiles/`.
- Uses `{ use: ... }` syntax. No stale `{ app: ... }`.

### CONTAINER.md

- All path references use `programs/{name}/`, not `plugins/programs/`.
- All call syntax uses `{ use: "name" }` and `childComponents`.
- `rootAppBody` on line 106 is the actual field name in `src/plugins.ts` (verified). Not stale.
- "What Is Not Implemented Yet" section: all five items (oversight-rlm, self-improving programs, composition unit tests, container-as-own-rlm-call, composition_feedback) remain unimplemented. The stdlib composites are structural patterns, not these features. No update needed.
- Composition Vocabulary section: the 4 named styles (direct, coordinated, exploratory, targeted) describe *how to delegate*. The stdlib composites (worker-critic, etc.) describe *what structure the delegation creates*. These are complementary concepts at different levels. No need to cross-reference.

### LANGUAGE.md (beyond the two fixes)

- File structure section correctly references `programs/{name}/`.
- No `plugins/` path references.
- No mention of `lib/` or `slots` -- this is appropriate. LANGUAGE.md describes the programming language syntax; the standard library is content written in that language, not a language feature. `slots` is a frontmatter convention used by library components, not a new language construct.

### BACKPRESSURE.md

- All path references use `programs/judge/`.
- No `app:` or `childApps` references.
- No stale `plugins/` paths.

### OBSERVABILITY.md

- Uses `componentName` in delegation:spawn event docs (updated in Phase 2).
- No stale `appName` references.
- No path references that need updating.

### TENETS.md (beyond the one fix)

- "Multi-Polarity Over Monologue" tenet is consistent with how the stdlib composites work. The tenet says "small composites with well-defined tension are more robust than either 1 agent or N agents." The stdlib composites (worker-critic, proposer-adversary, dialectic, witness, etc.) are exactly this: small composites with 2-3 roles creating structural tension. No gap.

## Summary

Three edits across two files. The rest of the documentation is consistent with the post-stdlib state. The scrutiny report's fix of README.md "(future)" annotations had already addressed the most visible gap.
