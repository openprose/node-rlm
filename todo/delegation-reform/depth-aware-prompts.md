# Depth-Aware System Prompts

Design for making the RLM system prompt vary by depth and mode, so the root can act as a coordinator while children act as solvers.

## Problem

The current `SYSTEM_PROMPT` is a single constant used for all depths. This creates three issues:

1. **Root can't be a coordinator**: The prompt frames the agent as a solo solver. Delegation is an afterthought (buried at line 45/77, described as "expensive").
2. **Children get the wrong prompt**: A depth-1 child without a custom `systemPrompt` receives the full root prompt — including "Designing Delegation" (32 lines), cost-aversion language, and the coordinator workflow. A child with 15 iterations should be focused on solving, not on further delegation.
3. **No way to swap modes**: There's no mechanism to run the same task set with "coordinator root" vs "solver root" without rewriting the prompt.

## Current behavior

| Layer | System Prompt | Plugins | Source |
|-------|--------------|---------|--------|
| Root (depth 0) | `SYSTEM_PROMPT` + model table + plugins + orientation | Yes | `rlm.ts:266-269` |
| Child with custom systemPrompt | custom + `buildChildRepl()` + model table + orientation | No | `rlm.ts:261-265` |
| Child without custom systemPrompt | `SYSTEM_PROMPT` + model table + orientation | No | `rlm.ts:271-273` |
| Flat (depth >= maxDepth) | `FLAT_SYSTEM_PROMPT` or custom + flat orientation | No | `rlm.ts:239-249` |

## Distinct roles

| Role | When | Identity | Workflow |
|------|------|----------|----------|
| **Coordinator** | depth 0, delegation mode | Orchestrator who delegates | Analyze, delegate, harvest, refine |
| **Solver** | depth 0 (default), or any child | Direct problem solver | Explore, implement, verify, return |
| **Specialist** | child with custom systemPrompt | Task-specific | Already handled by `buildChildRepl()` |
| **Flat** | depth >= maxDepth | One-shot answerer | Already handled by `FLAT_SYSTEM_PROMPT` |

## Options considered

### Option A: Composable sections (recommended)

Split `SYSTEM_PROMPT` into composable building blocks assembled by a pure function.

```typescript
// system-prompt.ts

// Core environment docs (always included, every depth)
const ENVIRONMENT_SECTION = `...`; // context, console.log, return, __rlm, require, variables persist

// Delegation capability docs (only for agents that CAN delegate, i.e. depth < maxDepth - 1)
const DELEGATION_CAPABILITY = `...`; // rlm(), llm(), Promise.all, budget info

// Workflow variants (one per mode, root only — children always get SOLVER)
const COORDINATOR_WORKFLOW = `...`; // analyze -> delegate -> harvest -> refine
const SOLVER_WORKFLOW = `...`;      // explore -> implement -> verify -> return

// Delegation tips (short, only for agents that can delegate)
const DELEGATION_TIPS = `...`;      // 5 actionable tips, not the current 32-line protocol

// Assembly function
export function buildSystemPrompt(config: {
  depth: number;
  maxDepth: number;
  mode: 'coordinator' | 'solver';
  childBudget?: number; // iterations available to children (e.g., 15)
}): string {
  const { depth, maxDepth, mode, childBudget } = config;
  const canDelegate = depth < maxDepth - 1;

  const sections = [
    buildIdentity(depth, mode),
    ENVIRONMENT_SECTION,
    canDelegate ? buildDelegationCapability(childBudget) : '',
    depth === 0 && mode === 'coordinator' ? COORDINATOR_WORKFLOW : SOLVER_WORKFLOW,
    canDelegate ? DELEGATION_TIPS : '',
  ].filter(Boolean);

  return sections.join('\n\n');
}
```

**Pros:**
- Clean separation of concerns. Each section has one job.
- Easy to swap coordinator/solver by changing `mode`.
- Children automatically get the solver workflow.
- Delegation docs only appear when the agent can actually delegate.
- Budget info ("children get 15 iterations") can be injected dynamically.

**Cons:**
- More code in system-prompt.ts.
- Need to be careful about section interactions.

### Option B: Two complete prompt templates

```typescript
export const COORDINATOR_PROMPT = `You are an RLM coordinator...`; // delegation-first
export const SOLVER_PROMPT = `You are an RLM solver...`;           // direct computation
```

Add `promptMode` to `RlmOptions`. Root gets whichever mode. Children always get `SOLVER_PROMPT`.

**Pros:** Simplest to understand. Easy to A/B test.
**Cons:** Duplication between templates (environment section is identical). Harder to maintain.

### Option C: Plugins all the way down

Keep the base `SYSTEM_PROMPT` neutral. Move all behavioral guidance into drivers (`coordinator-mode`, `solver-mode`). Since plugins only load at root, children get the bare prompt.

**Pros:** Zero engine changes. Fully swappable via `--drivers`.
**Cons:** Can't REMOVE anti-delegation language from the base prompt — a driver saying "delegation is free!" while the base prompt says "expensive — use wisely" is contradictory. Doesn't solve the children-get-wrong-prompt problem.

## Recommendation: Option A with Option B's CLI ergonomics

### CLI interface

```bash
# Default: solver mode (current behavior, backward compatible)
npx tsx eval/run.ts --benchmark arc --model anthropic/claude-opus-4-6

# Coordinator mode: root delegates, children solve
npx tsx eval/run.ts --benchmark arc --model anthropic/claude-opus-4-6 --prompt-mode coordinator

# GitHub Actions
gh workflow run eval.yml -f prompt-mode=coordinator -f ...
```

### Implementation plan

#### 1. Split `SYSTEM_PROMPT` in `src/system-prompt.ts`

Replace the single `SYSTEM_PROMPT` constant with composable sections:

**`ENVIRONMENT_SECTION`** (~20 lines) — always included:
- `context`, `console.log()`, `return(value)`
- `__rlm` delegation context (read-only)
- `__ctx.shared.data`, `__ctx.local`
- `require()`, variable persistence

**`DELEGATION_CAPABILITY`** (~8 lines) — only when `depth < maxDepth - 1`:
- `await rlm(query, context?, { systemPrompt?, model? })` with budget info
- `await llm(query, context?, { model? })` — one-shot alternative
- `Promise.all` pattern for parallel delegation
- "Children's iterations do not count against your budget" (the key incentive fix)
- Remove "Powerful but expensive — use wisely"

**`COORDINATOR_WORKFLOW`** (~15 lines) — root in coordinator mode:
```
## How to Work

1. **Analyze** — parse the data, identify structural features
2. **Delegate** — launch 2-3 children to test hypotheses in parallel:
   ```javascript
   const [rA, rB] = await Promise.all([
     rlm("Test hypothesis A: [describe]", context),
     rlm("Test hypothesis B: [describe]", context),
   ]);
   console.log("A:", rA.substring(0, 200));
   console.log("B:", rB.substring(0, 200));
   ```
   Each child gets 15 iterations. Launching 2 children costs 1 parent iteration
   but buys 30 child iterations — a 30:1 leverage ratio.
3. **Harvest** — evaluate child results, pick the best
4. **Refine** — verify and improve the best result yourself
5. **Return** — only return(answer) after verification
```

**`SOLVER_WORKFLOW`** (~10 lines) — root in solver mode, or any child:
```
## How to Work

Each iteration is one step. Do one thing, observe the result, then plan the next step.

1. **Explore** — inspect the data. console.log(typeof context, context.length).
2. **Plan** — decide strategy.
3. **Execute** — compute directly.
4. **Verify** — console.log() your candidate answer.
5. **Return** — only return(answer) after you have seen the correct value printed.
```

**`DELEGATION_TIPS`** (~5 lines) — replaces current 32-line "Designing Delegation":
```
## Delegation Tips

- Pass a systemPrompt to tell the child its role and expected output format.
- Children share the sandbox: variables you define are visible to children.
- Children can access __ctx.shared.data for full root data.
- Always await rlm() calls. Unawaited calls are silently lost.
- After children return, verify their results yourself.
```

**`buildIdentity(depth, mode)`** — the opening line:
- Coordinator: "You are an RLM that analyzes tasks and delegates parallel hypothesis testing to child agents."
- Solver: "You are an RLM — an LLM running inside a REPL loop. You write and execute JavaScript to solve tasks."

#### 2. Add `buildSystemPrompt()` function

```typescript
export type PromptMode = 'coordinator' | 'solver';

export function buildSystemPrompt(config: {
  depth: number;
  maxDepth: number;
  mode: PromptMode;
  childBudget?: number;
}): string {
  // ... compose sections as described above
}
```

#### 3. Update `rlm.ts` to use `buildSystemPrompt()`

Replace the three prompt-construction paths:

```typescript
// Before (rlm.ts:260-274):
if (customSystemPrompt) {
  effectiveSystemPrompt = customSystemPrompt + buildChildRepl(hasRlm) + modelTable + orientationBlock;
} else if (depth === 0) {
  effectiveSystemPrompt = rootSystemPrompt + orientationBlock;
} else {
  effectiveSystemPrompt = SYSTEM_PROMPT + modelTable + orientationBlock;
}

// After:
if (customSystemPrompt) {
  effectiveSystemPrompt = customSystemPrompt + buildChildRepl(hasRlm) + modelTable + orientationBlock;
} else {
  effectiveSystemPrompt = buildSystemPrompt({
    depth,
    maxDepth: opts.maxDepth,
    mode: depth === 0 ? opts.promptMode ?? 'solver' : 'solver',
    childBudget: iterationsForDepth(depth + 1, opts.maxIterations),
  }) + modelTable + orientationBlock;
  if (depth === 0 && opts.pluginBodies) {
    effectiveSystemPrompt += `\n\n---\n\n${opts.pluginBodies}`;
  }
}
```

Key change: children without custom systemPrompt now get `buildSystemPrompt({depth, mode: 'solver'})` instead of the full `SYSTEM_PROMPT`. This means they get the solver workflow, delegation capability docs (if they can delegate), but NOT the coordinator workflow or the 32-line "Designing Delegation" section.

#### 4. Add `promptMode` to `RlmOptions`

```typescript
export interface RlmOptions {
  callLLM: CallLLM;
  maxIterations?: number;
  maxDepth?: number;
  pluginBodies?: string;
  models?: Record<string, ModelEntry>;
  maxBlocksPerIteration?: number;
  promptMode?: PromptMode; // NEW: 'coordinator' | 'solver' (default: 'solver')
}
```

#### 5. Add `--prompt-mode` to CLI and workflow

**`eval/run.ts`**: parse `--prompt-mode` arg, pass to harness/rlm options.

**`.github/workflows/eval.yml`**: add `prompt-mode` input (default: "solver").

**`docs/TRIGGERING_EVALS.md`**: add to workflow inputs table.

### What this enables

```bash
# Current best-known (solver mode, backward compatible)
gh workflow run eval.yml -f drivers="..." -f prompt-mode=solver

# Coordinator mode (delegation-first root, solver children)
gh workflow run eval.yml -f drivers="delegation-first,deadline-return,verify-before-return" -f prompt-mode=coordinator

# Coordinator + pass@2
gh workflow run eval.yml -f prompt-mode=coordinator -f attempts=2 -f drivers="..."
```

### Interaction with drivers

Drivers stack on top of whichever mode is active:
- In **solver mode**: drivers like `hypothesis-budget`, `exploration-budget` guide the solo workflow
- In **coordinator mode**: drivers like `delegation-first` can enforce delegation protocol; solo-focused drivers like `exploration-budget` should NOT be loaded (they conflict with the coordinator workflow)

The mode determines the base behavior; drivers fine-tune it. This is cleaner than having drivers try to override the base prompt's anti-delegation language.

### Backward compatibility

- `promptMode` defaults to `'solver'`
- `--prompt-mode` defaults to `solver`
- Solver mode produces identical behavior to current `SYSTEM_PROMPT`
- No changes to `buildChildRepl()` (specialist children are unchanged)
- No changes to `FLAT_SYSTEM_PROMPT` (flat agents are unchanged)

### Migration path

1. Implement composable sections and `buildSystemPrompt()`
2. Verify solver mode produces identical prompts to current `SYSTEM_PROMPT`
3. Write coordinator workflow section
4. Add CLI/workflow flags
5. Run experiment: coordinator mode + delegation-first driver vs solver mode (current best)
