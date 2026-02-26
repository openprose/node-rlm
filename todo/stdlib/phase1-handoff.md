# Phase 1 Handoff: Directory Restructure

## What Was Done

Restructured the project layout from a monolithic `plugins/` directory to a split layout with `programs/`, `lib/`, and `archive/`.

### File Moves (all via `git mv`)

| Source | Destination |
|--------|-------------|
| `plugins/programs/arc3/` | `programs/arc3/` |
| `plugins/programs/arc2-compound/` | `programs/arc2-compound/` |
| `plugins/drivers/` (21 files) | `lib/drivers/` |
| `plugins/profiles/` (1 file) | `lib/profiles/` |
| `plugins/apps/` (17 files) | `archive/apps/` |

### Empty directories created (with `.gitkeep`)

- `lib/composites/`
- `lib/roles/`
- `lib/controls/`

### `plugins/` directory deleted

After all moves, the `plugins/` directory was removed entirely.

### Code Changes

**`src/plugins.ts`** -- Central change. Three new path constants replace the old one:

```typescript
// Before:
const DEFAULT_PLUGINS_DIR = resolve(fileURLToPath(import.meta.url), "../../plugins");

// After:
const DEFAULT_LIB_DIR = resolve(fileURLToPath(import.meta.url), "../../lib");
const DEFAULT_PROGRAMS_DIR = resolve(fileURLToPath(import.meta.url), "../../programs");
const DEFAULT_ARCHIVE_DIR = resolve(fileURLToPath(import.meta.url), "../../archive");
```

Function signature changes:

| Function | Old parameter | New parameter | Resolution |
|----------|--------------|---------------|------------|
| `loadPlugins(names, subdir, ...)` | `pluginsDir?` | `baseDir?` | Default is `DEFAULT_LIB_DIR` for `"drivers"`, `DEFAULT_ARCHIVE_DIR` for `"apps"` |
| `loadProfile(name, ...)` | `pluginsDir?` | `libDir?` | Resolves to `lib/profiles/` |
| `detectProfile(model, ...)` | `pluginsDir?` | `libDir?` | Resolves to `lib/profiles/` |
| `loadProgram(name, ...)` | `pluginsDir?` | `programsDir?` | Resolves to `programs/{name}/` (no more `programs/` subdir in path) |
| `loadStack(options)` | `pluginsDir?` | `libDir?` | Passes through to `loadProfile`/`detectProfile`; `loadPlugins` calls use their own defaults |

**`eval/run.ts`** -- Help text updated: `plugins/programs/<name>/` changed to `programs/<name>/`. No functional code changes needed because `loadPlugins`, `loadProgram`, and `loadStack` are called without custom directory overrides -- they use the updated defaults.

**`eval/harness.ts`** -- No changes needed. No direct path references.

**`test/plugins.test.ts`** -- No changes needed. All tests call functions without custom directory overrides, relying on the updated defaults. All 155 tests pass.

### Documentation Changes

| File | Change |
|------|--------|
| `README.md` | Updated "Plugins" section (removed `plugins/apps/` reference), updated "Project structure" to show new layout |
| `LANGUAGE.md` | Line 429: `plugins/programs/{name}/` -> `programs/{name}/`; Line 432: `plugins/programs/arc3/` -> `programs/arc3/` |
| `CONTAINER.md` | Line 103: `plugins/programs/{name}/` -> `programs/{name}/` |
| `BACKPRESSURE.md` | Lines 108/111: `plugins/programs/judge/` -> `programs/judge/` |

## Decisions Made

1. **`loadPlugins` dispatches by subdir**: Rather than splitting into two functions, `loadPlugins` checks its `subdir` argument to select the default base directory (`DEFAULT_LIB_DIR` for "drivers", `DEFAULT_ARCHIVE_DIR` for "apps"). This minimizes the API surface change.

2. **`loadStack` does not pass `libDir` through to `loadPlugins`**: Since `loadPlugins` now computes its own default based on `subdir`, and no callers pass custom directories, the passthrough was unnecessary. `loadStack` passes `libDir` through to `loadProfile`/`detectProfile` only.

3. **`loadProgram` path simplification**: The old code did `join(dir, "programs", name)` where `dir` was `plugins/`. Now it does `join(dir, name)` where `dir` is `programs/`. The `"programs"` segment is baked into the default constant, not the path construction.

4. **No changes to `app` parameter names**: Per instructions, `app`, `childApps`, `rootApp`, `rootAppBody` are untouched. That's Phase 2.

5. **`BACKPRESSURE.md` was untracked**: This file was never committed. I updated it with correct paths anyway. It needs to be `git add`ed when committing.

6. **`TENETS.md` has an unrelated modification**: There's a pre-existing uncommitted change to TENETS.md (adds a "Multi-Polarity Over Monologue" section). This is NOT part of Phase 1.

## What the Scrutiny Agent Should Verify

1. **All tests pass**: `npx tsc --noEmit && npx vitest run` -- confirmed passing at time of handoff.

2. **Path resolution correctness**: Verify that `loadPlugins(["await-discipline"], "drivers")` resolves to `lib/drivers/await-discipline.md` and `loadPlugins(["structured-data-aggregation"], "apps")` resolves to `archive/apps/structured-data-aggregation.md`.

3. **`loadProgram("arc3")` resolves to `programs/arc3/`**: The path no longer includes a `programs/` intermediate segment since the default constant already points to the `programs/` directory.

4. **No stale `plugins/` references in shipped code**: Run `grep -rn "plugins/" src/ eval/ test/ --include="*.ts"` and confirm only the function name `loadPlugins` and comment/log strings appear -- no path references.

5. **Documentation consistency**: Check that `README.md`, `LANGUAGE.md`, `CONTAINER.md`, `BACKPRESSURE.md` all reference the new paths.

6. **Git history preservation**: Run `git log --follow programs/arc3/root.md` and confirm the history traces back through the rename.

7. **Empty lib directories exist**: `lib/composites/`, `lib/roles/`, `lib/controls/` each have a `.gitkeep` file.

8. **`.prose/`, `.archive/`, `todo/` references are untouched**: These contain historical references to old paths and should NOT be updated -- they are records of the past.
