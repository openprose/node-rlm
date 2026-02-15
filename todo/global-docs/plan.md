# globalDocs Implementation Plan

Add a `globalDocs` option to the RLM harness that documents sandbox globals in every agent's system prompt at every depth. Then split the ARC-3 plugin into environment docs (via `globalDocs`) and strategy docs (stays in the plugin).

## Problem Statement

The RLM harness has a `sandboxGlobals` option (`RlmOptions`, line 28 of `src/rlm.ts`) that injects values into the JS sandbox. For ARC-3, this injects `{ arc3: client }` (see `eval/run.ts` lines 364-368). But the documentation for `arc3.*` lives only in the app plugin `plugins/apps/arc3-player-v2.md`, which is appended to the root agent's system prompt via `pluginBodies` (line 149 of `src/rlm.ts`). Plugins are explicitly NOT passed to children (lines 280-282: children without custom systemPrompt get `SYSTEM_PROMPT + modelTable + orientationBlock`, no plugins).

This means child agents spawned via `rlm()` share the sandbox and CAN access `arc3`, but they don't KNOW it exists because their system prompt never mentions it. The same applies to children with custom `systemPrompt` (line 274: they get `customSystemPrompt + buildChildRepl(hasRlm) + modelTable + orientationBlock`, no plugins) and flat-mode agents (lines 254-256: they get `FLAT_SYSTEM_PROMPT` or custom prompt + flat orientation, no plugins).

---

## 1. The Change to `RlmOptions`

### Location

`/Users/sl/code/trinity/node-rlm/src/rlm.ts`, lines 12-29.

### Current interface

```typescript
export interface RlmOptions {
    callLLM: CallLLM;
    maxIterations?: number;
    maxDepth?: number;
    /** Concatenated plugin bodies to append to the root agent's system prompt. */
    pluginBodies?: string;
    /** Named model aliases available for child delegation. */
    models?: Record<string, ModelEntry>;
    /**
     * Maximum code blocks to execute per LLM response.
     * When set to 1, only the first code block is executed and extra blocks
     * are discarded with a warning appended to the output.
     * Default: undefined (no limit).
     */
    maxBlocksPerIteration?: number;
    /** Extra globals to inject into the REPL sandbox. */
    sandboxGlobals?: Record<string, unknown>;
}
```

### Add `globalDocs` field

Insert after `sandboxGlobals` (after line 28):

```typescript
export interface RlmOptions {
    callLLM: CallLLM;
    maxIterations?: number;
    maxDepth?: number;
    /** Concatenated plugin bodies to append to the root agent's system prompt. */
    pluginBodies?: string;
    /** Named model aliases available for child delegation. */
    models?: Record<string, ModelEntry>;
    /**
     * Maximum code blocks to execute per LLM response.
     * When set to 1, only the first code block is executed and extra blocks
     * are discarded with a warning appended to the output.
     * Default: undefined (no limit).
     */
    maxBlocksPerIteration?: number;
    /** Extra globals to inject into the REPL sandbox. */
    sandboxGlobals?: Record<string, unknown>;
    /**
     * Documentation for sandbox globals, appended to the Environment section
     * of every agent's system prompt at every depth (root, children, flat).
     * Use this to document APIs injected via sandboxGlobals so that all agents
     * — including children spawned via rlm() — know they exist.
     */
    globalDocs?: string;
}
```

### Semantics

- `globalDocs` is a string containing markdown documentation.
- It is appended to the Environment section of every agent's system prompt, at every depth level.
- It is NOT a replacement for `pluginBodies` -- plugins contain strategy/behavioral guidance that is root-only. `globalDocs` contains API reference documentation that must be visible everywhere.
- It is orthogonal to `sandboxGlobals` -- you can have `globalDocs` without `sandboxGlobals` (e.g., documenting built-in globals) or `sandboxGlobals` without `globalDocs` (e.g., internal plumbing not meant for agents), but typically they are paired.

### Update the opts destructuring

At line 137-145 of `src/rlm.ts`, add `globalDocs`:

```typescript
const opts = {
    callLLM: options.callLLM,
    maxIterations: options.maxIterations ?? 15,
    maxDepth: options.maxDepth ?? 3,
    pluginBodies: options.pluginBodies,
    models: options.models,
    maxBlocksPerIteration: options.maxBlocksPerIteration,
    sandboxGlobals: options.sandboxGlobals,
    globalDocs: options.globalDocs,           // NEW
};
```

---

## 2. System Prompt Changes

There are four distinct system prompt construction paths in `rlmInternal`. Each one must include `globalDocs`. Below is the analysis of each path and the exact code change needed.

### 2.1 How `globalDocs` is injected: the mechanism

`globalDocs` should be appended after the Environment section of each prompt variant. The cleanest approach is to create a helper that wraps the global docs in a consistent format:

Add to `src/system-prompt.ts`:

```typescript
/**
 * Wrap globalDocs content for inclusion in system prompts.
 * Returns empty string if globalDocs is undefined/empty.
 */
export function formatGlobalDocs(globalDocs?: string): string {
    if (!globalDocs) return "";
    return `\n\n## Sandbox Globals\n\n${globalDocs}`;
}
```

This produces a titled section that sits logically after the Environment section. The heading "Sandbox Globals" clearly communicates that these are additional APIs available in the sandbox.

### 2.2 Path 1: Root agent (depth === 0, no customSystemPrompt)

**Source:** `src/rlm.ts` lines 275-278.

```typescript
// Current:
} else if (depth === 0) {
    // Root agent gets the full system prompt with plugins
    effectiveSystemPrompt = rootSystemPrompt + orientationBlock +
        (depth === opts.maxDepth - 1 ? PENULTIMATE_DEPTH_WARNING : "");
}
```

`rootSystemPrompt` is built at line 148-149:

```typescript
const modelTable = buildModelTable(opts.models);
const basePrompt = SYSTEM_PROMPT + modelTable;
const rootSystemPrompt = opts.pluginBodies ? `${basePrompt}\n\n---\n\n${opts.pluginBodies}` : basePrompt;
```

**Change:** Insert `globalDocs` between `SYSTEM_PROMPT` and `modelTable`. This places it right after the Environment section (which is the last section of `SYSTEM_PROMPT` before the "How to Work" section -- actually, `SYSTEM_PROMPT` ends with "How to Work" and "Designing Delegation", so globalDocs should go after Environment but before "How to Work").

Actually, looking more carefully at `SYSTEM_PROMPT` (in `src/system-prompt.ts`), the structure is:
1. Opening paragraph (lines 1-8)
2. `## Environment` section (lines 10-32)
3. `## How to Work` section (lines 34-44)
4. `## Designing Delegation` section (lines 46-76)
5. Closing rules (line 77)

The cleanest insertion point is after the entire `SYSTEM_PROMPT` constant, before `modelTable`. This way `globalDocs` appears as a peer section alongside Environment, How to Work, etc. Alternatively, we could insert it within the Environment section, but that requires splitting `SYSTEM_PROMPT` which is more invasive.

**Decision:** Append `globalDocs` as a section after `SYSTEM_PROMPT`, before `modelTable`. The `formatGlobalDocs()` helper produces a `## Sandbox Globals` section.

**Change to line 148:**

```typescript
const modelTable = buildModelTable(opts.models);
const globalDocsSection = formatGlobalDocs(opts.globalDocs);  // NEW
const basePrompt = SYSTEM_PROMPT + globalDocsSection + modelTable;
const rootSystemPrompt = opts.pluginBodies ? `${basePrompt}\n\n---\n\n${opts.pluginBodies}` : basePrompt;
```

No change needed to the `if (depth === 0)` branch itself -- the root prompt already uses `rootSystemPrompt` which now includes `globalDocs`.

### 2.3 Path 2: Child with customSystemPrompt

**Source:** `src/rlm.ts` lines 270-274.

```typescript
// Current:
if (customSystemPrompt) {
    // Parent provided custom instructions — use child base template
    const hasRlm = depth < opts.maxDepth - 1;
    const childBase = buildChildRepl(hasRlm);
    effectiveSystemPrompt = customSystemPrompt + childBase + modelTable + orientationBlock;
}
```

`buildChildRepl()` produces an `## Environment` section (see `src/system-prompt.ts` lines 84-99). `globalDocs` should appear right after this section.

**Change:**

```typescript
if (customSystemPrompt) {
    const hasRlm = depth < opts.maxDepth - 1;
    const childBase = buildChildRepl(hasRlm);
    effectiveSystemPrompt = customSystemPrompt + childBase + globalDocsSection + modelTable + orientationBlock;
}
```

But wait -- `globalDocsSection` is defined at the top of `rlm()`, not inside `rlmInternal()`. We need to make it available inside `rlmInternal`. Since `rlmInternal` is a nested function that captures `opts` via closure, we just need to compute `globalDocsSection` once at the `rlm()` level.

**Revised approach:** Compute `globalDocsSection` at line 148 (in the `rlm()` function body), and it will be available to `rlmInternal()` via closure.

```typescript
// In rlm(), around line 147-149:
const modelTable = buildModelTable(opts.models);
const globalDocsSection = formatGlobalDocs(opts.globalDocs);  // NEW
const basePrompt = SYSTEM_PROMPT + globalDocsSection + modelTable;
const rootSystemPrompt = opts.pluginBodies ? `${basePrompt}\n\n---\n\n${opts.pluginBodies}` : basePrompt;
```

Then in `rlmInternal` at line 274:

```typescript
// Before:
effectiveSystemPrompt = customSystemPrompt + childBase + modelTable + orientationBlock;

// After:
effectiveSystemPrompt = customSystemPrompt + childBase + globalDocsSection + modelTable + orientationBlock;
```

### 2.4 Path 3: Child without customSystemPrompt (depth > 0)

**Source:** `src/rlm.ts` lines 279-282.

```typescript
// Current:
} else {
    // Non-root child without custom prompt — use base system prompt, no plugins
    effectiveSystemPrompt = SYSTEM_PROMPT + modelTable + orientationBlock +
        (depth === opts.maxDepth - 1 ? PENULTIMATE_DEPTH_WARNING : "");
}
```

**Change:**

```typescript
} else {
    // Non-root child without custom prompt — use base system prompt, no plugins
    effectiveSystemPrompt = SYSTEM_PROMPT + globalDocsSection + modelTable + orientationBlock +
        (depth === opts.maxDepth - 1 ? PENULTIMATE_DEPTH_WARNING : "");
}
```

### 2.5 Path 4: Flat agent (depth >= maxDepth)

**Source:** `src/rlm.ts` lines 248-258.

```typescript
// Current:
if (depth >= opts.maxDepth) {
    const msg = context ? `${query}\n\nContext: ${context}` : query;
    const flatOrientation = buildOrientationBlock(
        invocationId, parentId, depth, opts.maxDepth,
        1, lineage, true,
    );
    const effectiveFlatPrompt = customSystemPrompt
        ? customSystemPrompt + flatOrientation
        : FLAT_SYSTEM_PROMPT + flatOrientation;
    const answer = await callLLM([{ role: "user", content: msg }], effectiveFlatPrompt);
    return { answer, iterations: 1, trace: [] };
}
```

Flat agents don't have a REPL sandbox and can't execute code, so they can't actually call `arc3.*`. However, they may still benefit from knowing what data structures look like (e.g., to interpret context passed by their parent). This is a judgment call.

**Decision:** Include `globalDocs` in flat agents. The documentation helps flat agents understand the data format and API semantics even though they can't call the APIs directly. A parent might pass serialized frame data to a flat child and ask "what do you see in this grid?" -- the flat child needs to know the frame structure.

**Change:**

```typescript
if (depth >= opts.maxDepth) {
    const msg = context ? `${query}\n\nContext: ${context}` : query;
    const flatOrientation = buildOrientationBlock(
        invocationId, parentId, depth, opts.maxDepth,
        1, lineage, true,
    );
    const effectiveFlatPrompt = customSystemPrompt
        ? customSystemPrompt + globalDocsSection + flatOrientation
        : FLAT_SYSTEM_PROMPT + globalDocsSection + flatOrientation;
    const answer = await callLLM([{ role: "user", content: msg }], effectiveFlatPrompt);
    return { answer, iterations: 1, trace: [] };
}
```

### 2.6 Summary of changes in `src/rlm.ts`

| Line(s) | Current | Change |
|---------|---------|--------|
| 28-29 | `sandboxGlobals` field ends interface | Add `globalDocs?: string` field after it |
| 144 | `sandboxGlobals: options.sandboxGlobals,` | Add `globalDocs: options.globalDocs,` after it |
| 148 | `const basePrompt = SYSTEM_PROMPT + modelTable;` | `const globalDocsSection = formatGlobalDocs(opts.globalDocs);` then `const basePrompt = SYSTEM_PROMPT + globalDocsSection + modelTable;` |
| 254-256 | flat prompt without globalDocs | Insert `globalDocsSection` before `flatOrientation` |
| 274 | `customSystemPrompt + childBase + modelTable + orientationBlock` | Insert `globalDocsSection` after `childBase` |
| 281 | `SYSTEM_PROMPT + modelTable + orientationBlock` | Insert `globalDocsSection` after `SYSTEM_PROMPT` |

### 2.7 Changes in `src/system-prompt.ts`

Add the `formatGlobalDocs` helper function (new export):

```typescript
/**
 * Wrap globalDocs content for inclusion in system prompts.
 * Returns empty string if globalDocs is undefined/empty.
 */
export function formatGlobalDocs(globalDocs?: string): string {
    if (!globalDocs) return "";
    return `\n\n## Sandbox Globals\n\n${globalDocs}`;
}
```

Import it in `src/rlm.ts` (update line 2):

```typescript
// Before:
import { buildChildRepl, buildModelTable, FLAT_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./system-prompt.js";

// After:
import { buildChildRepl, buildModelTable, FLAT_SYSTEM_PROMPT, formatGlobalDocs, SYSTEM_PROMPT } from "./system-prompt.js";
```

---

## 3. The Plugin Split

### 3.1 Current plugin content analysis

`plugins/apps/arc3-player-v2.md` has two logical sections:

**API Reference (lines 12-77):** Documents what `arc3.*` does.
- `### Sandbox API` (lines 17-24) -- method signatures
- `### Frame Structure` (lines 26-49) -- data shape with critical indexing notes
- `### Action Semantics` (lines 51-63) -- action codes table
- `### Scoring` (lines 65-67) -- scoring formula
- `### Return Protocol` (lines 69-78) -- how to end the game

**Strategy (lines 80-249):** How to play the game well.
- `### Strategy: How to Solve ARC-3 Games` (lines 82-249)
  - Phase 1: Orient (iterations 0-2) with full code examples
  - Phase 2: Execute (iterations 3+) with game loop template
  - Phase 3: Adapt (ongoing)
  - Key Rules (6 rules)

### 3.2 Content that moves to `globalDocs` (API reference)

This is the content that will be provided via the `globalDocs` option. It documents what sandbox globals are available and how to use them. Every agent at every depth needs this.

```markdown
### ARC-3 Sandbox API

The `arc3` global is pre-configured for your game.

- `await arc3.start()` -- Opens scorecard, resets game. **Call exactly once, in your very first code block.** Returns initial frame.
- `await arc3.step(action, x?, y?)` -- Sends action (integer 1-7), returns next frame.
- `arc3.observe()` -- Returns last frame without an API call. Free to call repeatedly.
- `await arc3.getScore()` -- Fetches scorecard summary. Call when game ends.
- `arc3.actionCount` -- Total actions sent so far.
- `arc3.completed` -- True if state is WIN or GAME_OVER.

### Frame Structure

```
{
  game_id: string,
  guid: string,
  frame: number[][][],    // shape: [1][64][64]
  state: "NOT_FINISHED" | "NOT_STARTED" | "WIN" | "GAME_OVER",
  levels_completed: number,
  win_levels: number,
  available_actions: number[]
}
```

**CRITICAL: Frame indexing.** The `frame` field has shape `[1][64][64]`. To read a pixel:

```javascript
const grid = frame.frame[0];  // 64x64 grid (the [0] unwraps the outer array)
const pixel = grid[row][col]; // color index 0-15
```

- `frame.frame.length` is 1 (not 64) -- always index `frame.frame[0]` first
- `frame.frame[0]` is the 64x64 grid: `frame.frame[0][row][col]` gives a color index (0-15)
- Row 0 = top, row 63 = bottom. Col 0 = left, col 63 = right.

### Action Semantics

| Action | Meaning |
|--------|---------|
| 1 | Up |
| 2 | Down |
| 3 | Left |
| 4 | Right |
| 5 | Interact |
| 6 | Click at (x, y) -- requires coordinates |
| 7 | Undo |

Only use actions listed in `available_actions` for the current frame.

### Scoring

Per-level: `human_baseline_actions / your_actions`, capped at 1.0. Game score: average across all 7 levels, **including 0.0 for incomplete levels**. Completing a level inefficiently is always better than not completing it.

### Return Protocol

When `arc3.completed` is true (state is `"WIN"` or `"GAME_OVER"`):

```javascript
const score = await arc3.getScore();
return(JSON.stringify(score));
```

If you are running low on iterations and the game is still going, return what you have rather than timing out with nothing.
```

### 3.3 Content that stays in the plugin (strategy)

The plugin file `plugins/apps/arc3-player-v2.md` is rewritten to contain only the strategy and behavioral guidance. It remains root-only via `pluginBodies`.

New `plugins/apps/arc3-player-v2.md`:

```markdown
---
name: arc3-player-v2
kind: app
version: 0.4.0
description: ARC-AGI-3 strategy guide -- phased approach with frame-diff discovery and game loops
author: sl
tags: [arc, arc3, interactive, games, solver]
requires: []
---

## ARC-AGI-3 Strategy

You are solving an ARC-AGI-3 game. You observe 64x64 frames, take actions, and try to complete all 7 levels as efficiently as possible. You are scored on action efficiency vs human baselines.

The `arc3` sandbox API is documented in your Environment section. All agents (including children you spawn via `rlm()`) have access to `arc3`.

### Strategy: How to Solve ARC-3 Games

You have plenty of iterations (~50). Use the early ones for orientation and discovery, then shift to execution. **Do not rush past understanding -- but also do not analyze without acting.** Every iteration should include at least a few game actions.

#### Phase 1: Orient (iterations 0-2)

Your first priority is to understand what the game IS. Start the game, define your utilities, and probe all available actions to learn what they do.

**Iteration 0 -- Start + Setup + First Probes:**

[... rest of the strategy section unchanged from lines 91-249 of the current file ...]
```

The key change in the strategy plugin: the opening line now says "The `arc3` sandbox API is documented in your Environment section. All agents (including children you spawn via `rlm()`) have access to `arc3`." This tells the root agent that children also know about `arc3`, enabling delegation.

### 3.4 How the harness wires up `globalDocs`

In `eval/run.ts`, the ARC-3 benchmark case currently returns `setupSandbox`, `getResultMetadata`, and `cleanupTask` from `getBenchmarkConfig()`. The `globalDocs` string should be constructed here too, but since `globalDocs` is a static string (not per-task), it should be set at the `HarnessConfig` level.

The `globalDocs` string is the API reference content from section 3.2 above. It can be hardcoded as a constant in a new file, or constructed inline.

**Recommendation:** Create a new file `eval/arc3-docs.ts` that exports the `globalDocs` string as a constant. This keeps the docs close to the client code and easy to update.

---

## 4. Harness Changes

### 4.1 Changes to `HarnessConfig`

**File:** `/Users/sl/code/trinity/node-rlm/eval/harness.ts`, lines 12-47.

Add `globalDocs` field to `HarnessConfig`:

```typescript
export interface HarnessConfig {
    // ... existing fields ...
    /** Documentation for sandbox globals, included in every agent's system prompt at all depths. */
    globalDocs?: string;
}
```

Insert after line 34 (`maxBlocksPerIteration`).

### 4.2 Changes to `runSingleTask`

**File:** `/Users/sl/code/trinity/node-rlm/eval/harness.ts`, lines 189-271.

Currently `runSingleTask` has this signature (lines 189-200):

```typescript
async function runSingleTask(
    task: EvalTask,
    callLLM: CallLLM,
    scoringFn: ScoringFunction,
    maxIterations: number,
    maxDepth: number,
    pluginBodies?: string,
    models?: Record<string, ModelEntry>,
    maxBlocksPerIteration?: number,
    setupSandbox?: (task: EvalTask) => Record<string, unknown>,
    cleanupTask?: (task: EvalTask) => Promise<void>,
    getResultMetadata?: (task: EvalTask) => Record<string, unknown> | undefined,
): Promise<EvalResult> {
```

Add `globalDocs` parameter:

```typescript
async function runSingleTask(
    task: EvalTask,
    callLLM: CallLLM,
    scoringFn: ScoringFunction,
    maxIterations: number,
    maxDepth: number,
    pluginBodies?: string,
    models?: Record<string, ModelEntry>,
    maxBlocksPerIteration?: number,
    setupSandbox?: (task: EvalTask) => Record<string, unknown>,
    cleanupTask?: (task: EvalTask) => Promise<void>,
    getResultMetadata?: (task: EvalTask) => Record<string, unknown> | undefined,
    globalDocs?: string,                                                        // NEW
): Promise<EvalResult> {
```

And pass it through to `rlm()` at lines 222-230:

```typescript
// Before:
const result = await rlm(task.query, task.context, {
    callLLM: wrappedCallLLM,
    maxIterations,
    maxDepth,
    pluginBodies,
    ...(models && { models }),
    ...(maxBlocksPerIteration && { maxBlocksPerIteration }),
    ...(sandboxGlobals && { sandboxGlobals }),
});

// After:
const result = await rlm(task.query, task.context, {
    callLLM: wrappedCallLLM,
    maxIterations,
    maxDepth,
    pluginBodies,
    ...(models && { models }),
    ...(maxBlocksPerIteration && { maxBlocksPerIteration }),
    ...(sandboxGlobals && { sandboxGlobals }),
    ...(globalDocs && { globalDocs }),                       // NEW
});
```

### 4.3 Update the call to `runSingleTask` in `runEval`

At line 110, update the call to pass `config.globalDocs`:

```typescript
// Before:
const result = await runSingleTask(task, config.callLLM, config.scoringFn, maxIterations, maxDepth, config.pluginBodies, config.models, config.maxBlocksPerIteration, config.setupSandbox, config.cleanupTask, config.getResultMetadata);

// After:
const result = await runSingleTask(task, config.callLLM, config.scoringFn, maxIterations, maxDepth, config.pluginBodies, config.models, config.maxBlocksPerIteration, config.setupSandbox, config.cleanupTask, config.getResultMetadata, config.globalDocs);
```

**Note:** This function has too many positional parameters. A future refactor should collapse them into an options object, but that is out of scope for this change.

### 4.4 Create `eval/arc3-docs.ts`

New file containing the globalDocs string for the ARC-3 benchmark:

```typescript
// eval/arc3-docs.ts
// API reference for the arc3 sandbox global, included in all agents' system prompts.

export const ARC3_GLOBAL_DOCS = `The \`arc3\` global is pre-configured for your game.

- \`await arc3.start()\` -- Opens scorecard, resets game. **Call exactly once, in your very first code block.** Returns initial frame.
- \`await arc3.step(action, x?, y?)\` -- Sends action (integer 1-7), returns next frame.
- \`arc3.observe()\` -- Returns last frame without an API call. Free to call repeatedly.
- \`await arc3.getScore()\` -- Fetches scorecard summary. Call when game ends.
- \`arc3.actionCount\` -- Total actions sent so far.
- \`arc3.completed\` -- True if state is WIN or GAME_OVER.

### Frame Structure

\\\`\\\`\\\`
{
  game_id: string,
  guid: string,
  frame: number[][][],    // shape: [1][64][64]
  state: "NOT_FINISHED" | "NOT_STARTED" | "WIN" | "GAME_OVER",
  levels_completed: number,
  win_levels: number,
  available_actions: number[]
}
\\\`\\\`\\\`

**CRITICAL: Frame indexing.** The \`frame\` field has shape \`[1][64][64]\`. To read a pixel:

\\\`\\\`\\\`javascript
const grid = frame.frame[0];  // 64x64 grid (the [0] unwraps the outer array)
const pixel = grid[row][col]; // color index 0-15
\\\`\\\`\\\`

- \`frame.frame.length\` is 1 (not 64) -- always index \`frame.frame[0]\` first
- \`frame.frame[0]\` is the 64x64 grid: \`frame.frame[0][row][col]\` gives a color index (0-15)
- Row 0 = top, row 63 = bottom. Col 0 = left, col 63 = right.

### Action Semantics

| Action | Meaning |
|--------|---------|
| 1 | Up |
| 2 | Down |
| 3 | Left |
| 4 | Right |
| 5 | Interact |
| 6 | Click at (x, y) -- requires coordinates |
| 7 | Undo |

Only use actions listed in \`available_actions\` for the current frame.

### Scoring

Per-level: \`human_baseline_actions / your_actions\`, capped at 1.0. Game score: average across all 7 levels, **including 0.0 for incomplete levels**. Completing a level inefficiently is always better than not completing it.

### Return Protocol

When \`arc3.completed\` is true (state is \`"WIN"\` or \`"GAME_OVER"\`):

\\\`\\\`\\\`javascript
const score = await arc3.getScore();
return(JSON.stringify(score));
\\\`\\\`\\\`

If you are running low on iterations and the game is still going, return what you have rather than timing out with nothing.`;
```

**Note on escaping:** The triple backticks inside the template literal need to be escaped. The actual file will use a technique to avoid this -- either raw string concatenation or placing the content in a separate `.md` file and reading it at build time. The simplest approach: store the docs as a `.md` file and read it at runtime.

**Revised approach:** Create `eval/arc3-global-docs.md` with the raw markdown content, and have `eval/run.ts` read it at startup via `readFileSync`. This avoids all escaping issues and keeps the docs as a readable markdown file.

### 4.5 Create `eval/arc3-global-docs.md`

New file with the raw markdown content from section 3.2 (the API reference portion). No frontmatter needed.

### 4.6 Changes to the arc3 case in `eval/run.ts`

**File:** `/Users/sl/code/trinity/node-rlm/eval/run.ts`, lines 351-386.

Import the globalDocs:

```typescript
// At top of file, add:
import { readFileSync } from "node:fs";  // already imported at line 29
import { join } from "node:path";        // already imported at line 30

// In the arc3 case, load the docs:
case "arc3": {
    if (!process.env.ARC3_API_KEY) {
        console.error("ARC3_API_KEY not set. Required for ARC-3 benchmark.");
        console.error("Set it in .env or as an environment variable.");
        process.exit(1);
    }
    const clients = new Map<string, Arc3Client>();

    // Load arc3 globalDocs                                    // NEW
    const arc3DocsPath = join(                                 // NEW
        new URL(".", import.meta.url).pathname,                // NEW
        "arc3-global-docs.md",                                 // NEW
    );                                                         // NEW
    const arc3GlobalDocs = readFileSync(arc3DocsPath, "utf-8"); // NEW

    return {
        loadTasks: () => loadArc3Tasks(
            args.game ? args.game.split(",").map((s) => s.trim()) : undefined,
            args.maxTasks,
        ),
        scoringFn: arc3Score,
        globalDocs: arc3GlobalDocs,                            // NEW
        setupSandbox: (task) => {
            // ... unchanged ...
        },
        // ... rest unchanged ...
    };
}
```

Wait -- the `BenchmarkConfig` interface (lines 312-318 of `eval/run.ts`) needs `globalDocs` too:

```typescript
interface BenchmarkConfig {
    loadTasks: () => Promise<EvalTask[]>;
    scoringFn: ScoringFunction;
    globalDocs?: string;                                       // NEW
    setupSandbox?: (task: EvalTask) => Record<string, unknown>;
    cleanupTask?: (task: EvalTask) => Promise<void>;
    getResultMetadata?: (task: EvalTask) => Record<string, unknown> | undefined;
}
```

And the `main()` function must pass `globalDocs` from `benchmarkConfig` to the `runEval` config (around line 565):

```typescript
const result = await runEval(tasks, {
    benchmark: args.benchmark,
    model: args.model,
    callLLM,
    scoringFn: benchmarkConfig.scoringFn,
    maxIterations: args.maxIterations,
    maxDepth: args.maxDepth,
    concurrency: args.concurrency,
    pluginBodies,
    models,
    ...(args.maxBlocksPerIteration && { maxBlocksPerIteration: args.maxBlocksPerIteration }),
    ...(args.attempts > 1 && { attempts: args.attempts }),
    ...(benchmarkConfig.setupSandbox && { setupSandbox: benchmarkConfig.setupSandbox }),
    ...(benchmarkConfig.cleanupTask && { cleanupTask: benchmarkConfig.cleanupTask }),
    ...(benchmarkConfig.getResultMetadata && { getResultMetadata: benchmarkConfig.getResultMetadata }),
    ...(benchmarkConfig.globalDocs && { globalDocs: benchmarkConfig.globalDocs }),  // NEW
    filter: args.filter ?? undefined,
    onProgress: printProgress,
});
```

---

## 5. Test Plan

### 5.1 Unit tests for `formatGlobalDocs`

**File:** `/Users/sl/code/trinity/node-rlm/test/system-prompt.test.ts`

Add tests for the new helper:

```typescript
import { formatGlobalDocs } from "../src/system-prompt.js";

describe("formatGlobalDocs", () => {
    it("returns empty string when globalDocs is undefined", () => {
        expect(formatGlobalDocs(undefined)).toBe("");
    });

    it("returns empty string when globalDocs is empty string", () => {
        expect(formatGlobalDocs("")).toBe("");
    });

    it("wraps content in a Sandbox Globals section", () => {
        const result = formatGlobalDocs("The `foo` global does X.");
        expect(result).toContain("## Sandbox Globals");
        expect(result).toContain("The `foo` global does X.");
    });
});
```

### 5.2 Integration test: globalDocs appears in root system prompt

**File:** `/Users/sl/code/trinity/node-rlm/test/rlm.test.ts`

```typescript
it("globalDocs: included in root system prompt", async () => {
    let capturedSystemPrompt = "";
    const callLLM: CallLLM = async (_messages, systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return '```repl\nreturn "done"\n```';
    };

    await rlm("test", undefined, {
        callLLM,
        globalDocs: "The `myApi` global provides X and Y.",
    });

    expect(capturedSystemPrompt).toContain("## Sandbox Globals");
    expect(capturedSystemPrompt).toContain("The `myApi` global provides X and Y.");
});
```

### 5.3 Integration test: globalDocs appears in child system prompt

```typescript
it("globalDocs: included in child system prompt (without customSystemPrompt)", async () => {
    const systemPrompts: string[] = [];
    const callLLM: CallLLM = async (messages, systemPrompt) => {
        systemPrompts.push(systemPrompt);
        const userMsg = messages[0]?.content || "";
        if (userMsg === "child task") {
            return '```repl\nreturn "child done"\n```';
        }
        return '```repl\nconst r = await rlm("child task")\nreturn r\n```';
    };

    await rlm("parent task", undefined, {
        callLLM,
        maxDepth: 3,
        globalDocs: "The `myApi` global provides X and Y.",
    });

    // Root prompt has globalDocs
    expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
    // Child prompt also has globalDocs
    expect(systemPrompts[1]).toContain("The `myApi` global provides X and Y.");
});
```

### 5.4 Integration test: globalDocs appears in child with customSystemPrompt

```typescript
it("globalDocs: included in child system prompt (with customSystemPrompt)", async () => {
    const systemPrompts: string[] = [];
    const callLLM: CallLLM = async (messages, systemPrompt) => {
        systemPrompts.push(systemPrompt);
        const userMsg = messages[0]?.content || "";
        if (userMsg === "child task") {
            return '```repl\nreturn "child done"\n```';
        }
        return '```repl\nconst r = await rlm("child task", undefined, { systemPrompt: "You are a helper." })\nreturn r\n```';
    };

    await rlm("parent task", undefined, {
        callLLM,
        maxDepth: 3,
        globalDocs: "The `myApi` global provides X and Y.",
    });

    // Child with custom systemPrompt also has globalDocs
    const childPrompt = systemPrompts[1];
    expect(childPrompt).toContain("You are a helper.");
    expect(childPrompt).toContain("The `myApi` global provides X and Y.");
});
```

### 5.5 Integration test: globalDocs appears in flat-mode children

```typescript
it("globalDocs: included in flat-mode child system prompt", async () => {
    const systemPrompts: string[] = [];
    const callLLM: CallLLM = async (messages, systemPrompt) => {
        systemPrompts.push(systemPrompt);
        const userMsg = messages[0]?.content || "";
        if (!systemPrompt.includes("javascript")) {
            // Flat-mode child
            return "flat answer";
        }
        if (userMsg === "parent task") {
            return '```repl\nconst r = await rlm("sub query")\nreturn r\n```';
        }
        return '```repl\nreturn "unexpected"\n```';
    };

    await rlm("parent task", undefined, {
        callLLM,
        maxDepth: 1,
        globalDocs: "The `myApi` global provides X and Y.",
    });

    // Root prompt has globalDocs
    expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
    // Flat-mode child also has globalDocs
    const flatPrompt = systemPrompts[1];
    expect(flatPrompt).toContain("The `myApi` global provides X and Y.");
});
```

### 5.6 Integration test: globalDocs + sandboxGlobals work together

```typescript
it("globalDocs + sandboxGlobals: child can use documented sandbox global", async () => {
    const mockApi = { greet: (name: string) => "hello " + name };
    const callLLM: CallLLM = async (messages, systemPrompt) => {
        const userMsg = messages[0]?.content || "";
        if (userMsg === "greet world") {
            // Child agent -- verify globalDocs is in prompt and use the global
            if (!systemPrompt.includes("myApi.greet")) {
                return '```repl\nreturn "FAIL: no globalDocs"\n```';
            }
            return '```repl\nreturn myApi.greet("world")\n```';
        }
        return '```repl\nconst r = await rlm("greet world")\nreturn r\n```';
    };

    const result = await rlm("parent task", undefined, {
        callLLM,
        maxDepth: 3,
        sandboxGlobals: { myApi: mockApi },
        globalDocs: "`myApi.greet(name)` -- returns a greeting string.",
    });

    expect(result.answer).toBe("hello world");
});
```

### 5.7 Negative test: globalDocs absent when not provided

```typescript
it("globalDocs: not present in system prompt when not provided", async () => {
    let capturedSystemPrompt = "";
    const callLLM: CallLLM = async (_messages, systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return '```repl\nreturn "done"\n```';
    };

    await rlm("test", undefined, { callLLM });

    expect(capturedSystemPrompt).not.toContain("## Sandbox Globals");
});
```

### 5.8 Contrast test: pluginBodies NOT in children, globalDocs IS

```typescript
it("globalDocs vs pluginBodies: plugins are root-only, globalDocs is everywhere", async () => {
    const systemPrompts: string[] = [];
    const callLLM: CallLLM = async (messages, systemPrompt) => {
        systemPrompts.push(systemPrompt);
        const userMsg = messages[0]?.content || "";
        if (userMsg === "child task") {
            return '```repl\nreturn "child done"\n```';
        }
        return '```repl\nconst r = await rlm("child task")\nreturn r\n```';
    };

    await rlm("parent task", undefined, {
        callLLM,
        maxDepth: 3,
        pluginBodies: "## My Plugin\nRoot-only strategy.",
        globalDocs: "The `myApi` global provides X.",
    });

    // Root has both
    expect(systemPrompts[0]).toContain("## My Plugin");
    expect(systemPrompts[0]).toContain("The `myApi` global provides X.");

    // Child has globalDocs but NOT pluginBodies
    expect(systemPrompts[1]).not.toContain("## My Plugin");
    expect(systemPrompts[1]).toContain("The `myApi` global provides X.");
});
```

---

## 6. Alignment with Depth-Aware Prompts Design

### 6.1 How this aligns with the composable sections proposal

The depth-aware prompts design (`todo/delegation-reform/depth-aware-prompts.md`) proposes Option A: splitting `SYSTEM_PROMPT` into composable building blocks assembled by a `buildSystemPrompt()` function. The proposed sections are:

- `ENVIRONMENT_SECTION` -- always included, every depth
- `DELEGATION_CAPABILITY` -- only when depth < maxDepth - 1
- `COORDINATOR_WORKFLOW` / `SOLVER_WORKFLOW` -- mode-dependent
- `DELEGATION_TIPS` -- only when can delegate

`globalDocs` fits naturally as a section that is "always included, every depth" -- the same lifecycle as `ENVIRONMENT_SECTION`. When the composable sections refactor happens, `globalDocs` would be inserted as a section in the assembly function:

```typescript
// Future buildSystemPrompt():
const sections = [
    buildIdentity(depth, mode),
    ENVIRONMENT_SECTION,
    globalDocs ? `## Sandbox Globals\n\n${globalDocs}` : '',  // <-- globalDocs here
    canDelegate ? buildDelegationCapability(childBudget) : '',
    depth === 0 && mode === 'coordinator' ? COORDINATOR_WORKFLOW : SOLVER_WORKFLOW,
    canDelegate ? DELEGATION_TIPS : '',
].filter(Boolean);
```

### 6.2 Stepping stone vs independent change

This change is **both a stepping stone and independently valuable**.

**Independent value:** Even without the full composable sections refactor, `globalDocs` solves a real problem today -- child agents can't use sandbox globals because they don't know they exist. The ARC-3 benchmark benefits immediately.

**Stepping stone:** The pattern of "inject a section at every depth" is exactly what the composable sections design needs. `globalDocs` establishes the precedent and the plumbing. When `buildSystemPrompt()` is implemented, `globalDocs` will slot in as one of the composable sections with zero semantic change.

### 6.3 Conflicts and considerations

**No conflicts.** `globalDocs` does not modify `SYSTEM_PROMPT`, `buildChildRepl()`, or `FLAT_SYSTEM_PROMPT`. It adds a new section alongside them. The composable sections refactor can proceed independently.

**One consideration:** The current change injects `globalDocs` by string concatenation at each prompt construction site (4 places in `rlmInternal`). The composable sections refactor would centralize this into `buildSystemPrompt()`. When that refactor happens, the 4 injection sites collapse into 1. This is a minor cleanup, not a conflict.

**Another consideration:** The `formatGlobalDocs()` helper uses the heading `## Sandbox Globals`. In the composable sections design, section headings are part of each section constant. If the composable sections refactor renames or restructures headings, `formatGlobalDocs()` should be updated to match. This is trivial.

---

## 7. File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/rlm.ts` | Modify | Add `globalDocs` to `RlmOptions` interface; add to opts destructuring; compute `globalDocsSection` via `formatGlobalDocs()`; inject into all 4 prompt construction paths |
| `src/system-prompt.ts` | Modify | Add `formatGlobalDocs()` helper function (new export) |
| `eval/harness.ts` | Modify | Add `globalDocs` to `HarnessConfig` interface; add parameter to `runSingleTask()`; pass through to `rlm()` |
| `eval/run.ts` | Modify | Add `globalDocs` to `BenchmarkConfig` interface; load `arc3-global-docs.md` in arc3 case; pass through to `runEval()` |
| `eval/arc3-global-docs.md` | Create | API reference for the `arc3` sandbox global (extracted from `plugins/apps/arc3-player-v2.md` lines 17-78) |
| `plugins/apps/arc3-player-v2.md` | Modify | Remove API reference sections (lines 17-78); keep strategy sections (lines 80-249); bump version to 0.4.0; add note that `arc3` API docs are in the Environment section |
| `test/system-prompt.test.ts` | Modify | Add tests for `formatGlobalDocs()` |
| `test/rlm.test.ts` | Modify | Add 7 tests: root globalDocs, child globalDocs (with/without customSystemPrompt), flat-mode globalDocs, globalDocs + sandboxGlobals, negative test, contrast with pluginBodies |

---

## 8. Scope Boundaries

### What this plan does NOT cover

- **Child delegation types (coordinator/solver modes):** The depth-aware prompts proposal introduces `promptMode: 'coordinator' | 'solver'`. This change is orthogonal. `globalDocs` works with any prompt mode.

- **Composable system prompt refactor:** The full `buildSystemPrompt()` refactor (Option A from depth-aware-prompts.md) is a separate, larger change. `globalDocs` is compatible with it but does not depend on it.

- **`--global-docs` CLI flag:** The current design has `globalDocs` constructed programmatically by the benchmark case (e.g., the arc3 case loads `arc3-global-docs.md`). A generic CLI flag for arbitrary globalDocs is not needed today. If future benchmarks need it, add it then.

- **Per-depth globalDocs filtering:** The current design includes globalDocs at ALL depths including flat. A future enhancement could allow `globalDocs` to specify depth ranges (e.g., "only include at depths with REPL access"). This is not needed now -- flat agents benefit from knowing the data structures even if they can't call the APIs.

- **Other sandbox globals documentation:** Only the ARC-3 `arc3` global is documented in this change. If other benchmarks add sandbox globals in the future, they follow the same pattern: create a `*-global-docs.md` file and pass it as `globalDocs`.

- **Removing `--app arc3-player-v2` requirement:** After this change, the arc3 benchmark still requires `--app arc3-player-v2` for strategy guidance. The API docs are automatic (via `globalDocs` in the benchmark config), but the strategy plugin must still be loaded explicitly. A future change could embed the strategy in the benchmark case itself, but that eliminates the ability to swap strategies via different `--app` plugins, which is valuable for experimentation.

### What depends on this change being done first

- **ARC-3 delegation experiments:** Any experiment where the root agent delegates sub-games or analysis tasks to children requires children to know about `arc3`. This change is a prerequisite.

- **Multi-agent ARC-3 strategies:** Strategies where a coordinator delegates "try moving right for 20 steps" to one child and "try interact on all colored cells" to another require both children to have `arc3` API docs.

- **Future sandbox globals for other benchmarks:** The `globalDocs` mechanism is generic. Once implemented, any benchmark can document its sandbox globals without modifying the core system prompt code.
