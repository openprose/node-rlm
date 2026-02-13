# Context Usage Analysis: Run-026 (Drivers)

## Architecture Summary

### How the persistent sandbox works

The RLM gives every agent a **persistent Node.js `vm.Context`** that survives across iterations. Key mechanisms:

1. **Variable persistence**: All `const`, `let`, `var`, and `function` declarations are hoisted to the context scope. When an agent writes `const task = JSON.parse(context)` in iteration 0, `task` remains available in iteration 5 -- the agent can simply reference `task` without re-declaring or re-parsing it. The `JsEnvironment.hoistDeclarations()` method converts `const`/`let`/`var` declarations into context-level `let` bindings (first use) and plain assignments (subsequent uses), so re-declaring the same name silently reassigns rather than throwing a duplicate-declaration error.

2. **`context` variable**: Each agent gets a `context` string (the task data). It's defined via a `get`/`set` property on `globalThis` backed by `__ctx.local.context`. This is available at every iteration.

3. **`__ctx.shared.data`**: The root context data, frozen and readable by all REPL agents at any depth. Intended for delegation chains where children need access to the original task data without re-serialization.

4. **`__ctx.local`**: A per-agent private writable workspace. Implemented via a Proxy that routes reads/writes based on the active `invocationId`. Each agent gets its own isolated store.

5. **`__ctx.readLocal(id)`**: Allows reading another agent's local store (e.g., a parent reading a child's stored results).

6. **Shared `vm.Context` for parent-child**: Both parent and child RLM agents execute in the **same** `vm.Context`. This means sandbox-level variables (anything assigned at the top level) are visible to both parent and child. Children can read variables the parent set, and vice versa. The `__ctx.local` Proxy provides isolation per agent, but raw sandbox variables are globally visible.

7. **`console.log()` output**: Captured per-execution and appended to the conversation as `user` messages. The output is truncated at 50KB. Every `console.log` call adds text to the LLM's conversation history, consuming context window capacity.

### What the system prompt tells agents

The system prompt (`SYSTEM_PROMPT` in `system-prompt.ts`) includes:

- "Variables persist across iterations. Code from earlier iterations is still in scope." (line 32)
- "`__ctx.shared.data` -- the root context data, readable by all REPL agents at any depth (frozen)" (line 29)
- "`__ctx.local` -- your private writable workspace. Each agent has its own isolated local store." (line 30)

However, the prompt does **not** include any of the following:
- Guidance to parse context once and reuse the parsed object
- Warnings about context window bloat from excessive `console.log` output
- Instructions to store intermediate results in persistent variables
- Advice to define helper functions once and reuse them across iterations
- Recommendations for using `__ctx.local` as a structured scratchpad

The delegation section mentions using "distinct variable names when running parallel delegations to avoid sandbox collisions" and notes that "REPL children can access `__ctx.shared.data` for the full root data -- you do NOT need to re-send the entire dataset." But there is no systematic guidance on context discipline for the solo-agent iteration loop.

---

## Current Usage Patterns

### 1. Persistent variable reuse: The `task` variable

**Observed behavior**: Two distinct patterns emerge across the 20 tasks.

**Pattern A -- Re-parse every iteration (10 tasks, 140 occurrences)**:
The agent writes `const task = JSON.parse(context)` at the top of nearly every code block, even though the `task` variable already exists from the previous iteration.

```javascript
// arc-0934a4d8, iter 0
const task = JSON.parse(context);
console.log("Training examples:", task.train.length);

// arc-0934a4d8, iter 1  (task already exists!)
const task = JSON.parse(context);
for (let i = 0; i < task.train.length; i++) { ... }

// arc-0934a4d8, iter 2  (task STILL already exists!)
const task = JSON.parse(context);
// Check for near-symmetry in the inputs

// ... continues for ALL 19 iterations
```

Severity distribution:
| Category | Tasks | Iterations with re-parse |
|----------|-------|-------------------------|
| CRITICAL (every iteration) | 2 | arc-4e34c42c (20/20), arc-0934a4d8 (19/19) |
| HIGH (>60%) | 7 | arc-5961cc34 (13/14), arc-7ed72f31 (10/10), arc-6e453dd6 (10/11), arc-db695cfb (9/10), arc-36a08778 (14/18), arc-136b0064 (13/17), arc-b99e7126 (9/14) |
| LOW (<20%) | 11 | arc-247ef758 (1/11), arc-446ef5d2 (1/20), etc. |

**Pattern B -- Parse once, reuse variable (10 tasks)**:
The agent parses context in iteration 0 and then references `task` (or `data`) directly in subsequent iterations.

```javascript
// arc-247ef758, iter 0
const task = JSON.parse(context);
console.log("Training examples:", task.train.length);

// arc-247ef758, iter 1  (references task directly -- no re-parse)
for (let i = 0; i < task.train.length; i++) {
  const inp = task.train[i].input;
  ...
}

// arc-247ef758, iter 3
// Theory: Each shape's color appears as a marker on the border
for (let i = 0; i < task.train.length; i++) {
  const inp = task.train[i].input;
  // uses 'task' without re-parsing
```

**Impact**: `JSON.parse(context)` on a typical ARC task JSON is cheap computationally (microseconds), but the **real cost** is context pollution. Each redundant `const task = JSON.parse(context)` line appears in the assistant message in the conversation history and trains the model to treat it as a necessary preamble. Over 19 iterations, this contributes to a pattern of boilerplate that crowds out useful reasoning content.

### 2. Function redefinition across iterations

**Observed behavior**: When agents refine their solution, they often redefine the entire function from scratch rather than modifying the existing definition in-place (which is impossible in the REPL model, but they could avoid redefining unchanged helper functions).

**Worst case -- arc-4e34c42c**: 59 function redefinitions across 20 iterations.
```
findObjects: defined at iters [2, 11, 12, 13, 14, 15, 16, 17, 18, 19]
padToHeight: defined at iters [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
maxOverlap: defined at iters [8, 9, 10, 11, 12, 13, 14]
mergeTwo: defined at iters [8, 9, 11, 13, 15, 16, 17, 18, 19]
solve: defined at iters [11, 13, 15, 16, 17, 19]
```

**arc-36a08778**: 14 redefinitions, with `findSegments` redefined 7 times.
```
findSegments: defined at iters [8, 10, 11, 12, 13, 14, 16]
solve: defined at iters [8, 10, 11, 13, 14]
gridCopy: defined at iters [8, 10, 11, 13, 14]
```

In the arc-36a08778 case, `gridCopy` is a trivial helper `grid.map(r => [...r])` that never changes, yet it is redefined 5 times because the agent copies the entire solution block each iteration.

**Typical pattern -- arc-2ba387bc**: `findRectangles` is defined at iters [2, 4, 5, 7, 8] because the agent copies it alongside new code. However, only 2 of those 5 definitions actually change the function body.

**Impact**: Each redefinition wastes tokens in both the assistant message (the code) and the conversation history. For a function like `findSegments` (~20 lines), redefining it 7 times adds ~140 lines of redundant code to the conversation. This bloats the context window and may contribute to the agent losing track of what changed between versions.

### 3. `console.log` as primary output mechanism

**Observed behavior**: 96% of code blocks (295/308) contain `console.log` calls. In many cases, agents dump large grid outputs:

```javascript
// arc-247ef758, iter 0 -- dumps full grids to console
for (let i = 0; i < task.train.length; i++) {
  const inp = task.train[i].input;
  const out = task.train[i].output;
  console.log(`\nTrain ${i}: input ${inp.length}x${inp[0].length}`);
  console.log("Input:");
  inp.forEach(r => console.log(r.join(' ')));
  console.log("Output:");
  out.forEach(r => console.log(r.join(' ')));
}
```

For a 30x30 grid, this produces ~30 lines of output per grid, ~120 lines for a single training example's input + output. With 3 training examples, this is ~360 lines of grid data injected into the conversation history.

**Alternative**: Store the parsed/formatted data in a variable and log only a summary:

```javascript
// Better: store data, log summary
const grids = task.train.map(t => ({ inp: t.input, out: t.output }));
console.log(`${grids.length} training examples, dims: ${grids.map(g => `${g.inp.length}x${g.inp[0].length}`)}`);
// Access grids[0].inp[r][c] later without re-printing
```

### 4. `__ctx.shared.data` and `__ctx.local`: Almost never used

**`__ctx.shared.data`**: Zero uses across all 20 tasks. This is the frozen root context data accessible at all depths. Since the run uses `maxDepth=2` and only 2 tasks even attempt delegation, this is understandable -- but even the delegating tasks don't use it.

**`__ctx.local`**: Used exactly twice, both in **arc-36a08778**, and only for the deadline-return pattern:

```javascript
// arc-36a08778, iter 14 -- store answer in local context
__ctx.local.answer = JSON.stringify(results);

// arc-36a08778, iter 17 -- retrieve from local context at deadline
console.log("DEADLINE CANDIDATE:");
console.log(__ctx.local.answer.substring(0, 200) + "...");
return(JSON.parse(__ctx.local.answer));
```

This is actually an excellent use of `__ctx.local` -- storing the best candidate answer persistently so it survives across iterations. But only 1 of 20 tasks exhibits this pattern.

### 5. Result accumulation in variables

**Good pattern observed in some tasks**: The agent builds up results incrementally:

```javascript
// arc-247ef758, iter 9 -- accumulates test outputs
const testOutputs = [];
for (let i = 0; i < task.test.length; i++) {
  const result = transform(task.test[i].input);
  testOutputs.push(result);
}
// testOutputs persists and is used in iter 11's return()
```

**More common pattern**: Each iteration is self-contained, re-deriving everything from scratch. The agent doesn't maintain running state like `hypothesisResults`, `testedApproaches`, or `bestCandidate`.

### 6. Delegation and context sharing

Only 2 of 20 tasks use `rlm()` delegation:
- **arc-195c6913**: Delegates once (iter 14), child hits max iterations without returning. No sandbox variable passing.
- **arc-cbebaa4b**: Delegates once. No sandbox variable passing observed.

Neither task uses the shared-context-delegation pattern (writing data to sandbox variables for the child). Both pass all data inline in the query string.

The `shared-context-delegation` driver was **not included** in this run's driver stack (the run used: `one-block-per-iteration, deadline-return, verify-all-examples, verify-before-return, hypothesis-budget, exploration-budget, arc-helper-library, overlap-testing, json-stringify-return`).

---

## Anti-Patterns Found

### Anti-Pattern 1: Universal re-parsing (9 tasks, ~140 wasted parse calls)

The agent writes `const task = JSON.parse(context)` at the start of every code block even though `task` persists from the previous iteration. This is the most widespread anti-pattern.

**Representative case -- arc-0934a4d8 (19 consecutive re-parses)**:
Every single iteration begins with the exact same line:
```javascript
const task = JSON.parse(context);
```

The `hoistDeclarations` mechanism in `JsEnvironment` silently converts this to `task = JSON.parse(context)` (since `task` was already declared), so it doesn't error -- it just re-parses the same JSON string. The agent never once writes just `task.train[i]` without first re-parsing.

### Anti-Pattern 2: Copy-paste function blocks (arc-4e34c42c: 59 redefinitions)

When refining a solution, the agent copies the entire multi-function solution block, even when only one function changed. This means unchanged helper functions like `padToHeight` get redefined identically 12 times.

```
arc-4e34c42c function redefinitions:
  padToHeight: 12 times (never changed)
  findObjects: 10 times (changed ~3 times)
  backgroundColor: 9 times (changed once)
  permutations: 6 times (never changed)
```

This inflates the conversation with redundant code. In a 20-iteration task, this means the LLM's context window contains 12 copies of `padToHeight` across 12 different assistant messages.

### Anti-Pattern 3: Grid dump to console (all tasks)

In the exploration phase, agents print full grid contents via `console.log`. For 30x30 grids with 3 training examples (input+output), this can produce 1000+ lines of output in a single iteration, all of which goes into the conversation history.

```javascript
// arc-0934a4d8, iter 1 -- dumps ALL training grids
for (let i = 0; i < task.train.length; i++) {
  const inp = task.train[i].input;
  const out = task.train[i].output;
  console.log("Input:");
  inp.forEach(r => console.log(r.join(' ')));
  console.log("Output:");
  out.forEach(r => console.log(r.join(' ')));
}
// Output: 360+ lines of grid data
```

After the first exploration iteration, this grid data sits in the conversation forever, consuming context capacity that could be used for reasoning.

### Anti-Pattern 4: No structured hypothesis tracking

Agents test hypotheses through code, printing results to console, but never store the results in a persistent data structure:

```javascript
// Typical pattern: test hypothesis, print result, move on
console.log(`H3 match: ${matchCount}/${totalCells}`);
// Result is in the conversation but not in a variable

// Better pattern (never observed):
hypothesisLog.push({
  id: 'H3', name: '180-degree rotation',
  result: { match: matchCount, total: totalCells },
  verdict: matchCount > 0.95 * totalCells ? 'accept' : 'reject'
});
```

No task in the run maintains a `hypothesisResults` array or equivalent persistent structure.

---

## Missed Opportunities

### Opportunity 1: Parse once, store derived data structures

Instead of re-parsing JSON every iteration, the agent could parse once and store derived data:

```javascript
// Iter 0: Parse and derive
const task = JSON.parse(context);
const trainGrids = task.train.map(t => ({
  inp: t.input, out: t.output,
  H: t.input.length, W: t.input[0].length
}));
const testGrids = task.test.map(t => ({
  inp: t.input, H: t.input.length, W: t.input[0].length
}));
console.log(`${trainGrids.length} train, ${testGrids.length} test, dims: ${trainGrids[0].H}x${trainGrids[0].W}`);

// Iter 1+: Just use trainGrids, testGrids directly
// No re-parsing needed
```

**Estimated savings**: Eliminates ~140 redundant `JSON.parse(context)` calls and the associated boilerplate lines in the conversation. For an agent with 50K token context, this could save 5-10% of capacity.

### Opportunity 2: Store the best candidate answer persistently

Only arc-36a08778 uses `__ctx.local.answer` to store the best candidate. Every other task computes the answer in the final iteration from scratch, risking losing a good candidate if the last iteration fails.

```javascript
// Good pattern (from arc-36a08778):
__ctx.local.answer = JSON.stringify(results);
// ... later, at deadline:
return(JSON.parse(__ctx.local.answer));

// Should be standard practice for all tasks:
// After each successful training validation, store the answer
if (score === task.train.length) {
  bestAnswer = testOutputs;
  console.log(`Best answer stored (${score}/${task.train.length} train pass)`);
}
```

### Opportunity 3: Define utility functions once, modify only the changing function

Instead of redefining all functions every iteration:

```javascript
// Iter 8: Define all helpers
function gridCopy(g) { return g.map(r => [...r]); }
function findSegments(grid) { /* ... */ }
function solve(input) { /* v1 */ }

// Iter 10: Only redefine solve, not gridCopy and findSegments
function solve(input) { /* v2 -- changed turn logic */ }
// gridCopy and findSegments still available from iter 8
```

**Estimated savings in arc-4e34c42c**: Eliminating 45+ redundant function redefinitions would save ~900 lines of code in the conversation history.

### Opportunity 4: Use `__ctx.local` as a structured scratchpad

```javascript
// Store hypothesis results persistently
__ctx.local.hypotheses = __ctx.local.hypotheses || [];
__ctx.local.hypotheses.push({
  id: 'H3', iter: __rlm.iteration,
  test: '180-degree rotation',
  score: matchCount / totalCells,
  verdict: 'rejected'
});

// Store the best solution found so far
__ctx.local.bestSolution = { fn: transform, score: 3, total: 3 };

// At deadline, always have something to return
if (__rlm.iteration >= __rlm.maxIterations - 2 && __ctx.local.bestSolution) {
  const results = task.test.map(t => __ctx.local.bestSolution.fn(t.input));
  return(JSON.stringify(results));
}
```

### Opportunity 5: Compact grid logging

```javascript
// Instead of printing 30 lines per grid:
inp.forEach(r => console.log(r.join(' ')));

// Print a compact summary:
const colorCounts = {};
inp.flat().forEach(v => colorCounts[v] = (colorCounts[v]||0)+1);
console.log(`Grid ${H}x${W}, colors: ${JSON.stringify(colorCounts)}`);
// Or print just the first/last 3 rows:
console.log(`First 3 rows: ${inp.slice(0,3).map(r=>r.join(' ')).join(' | ')}`);
```

---

## What the System Prompt Should Say

The current system prompt mentions that "Variables persist across iterations" but provides no operational guidance on how to leverage this. Specific gaps:

1. **No guidance on parsing**: The prompt doesn't say "Parse context once in your first iteration and reuse the parsed object." The agent re-parses because the prompt doesn't tell it not to.

2. **No guidance on output volume**: The prompt doesn't warn about context window pressure from large `console.log` outputs. It says "console.log() -- prints output. This is how you see results between iterations." This implicitly encourages dumping everything to console.

3. **No guidance on `__ctx.local` for iteration state**: The prompt documents `__ctx.local` but doesn't suggest using it for hypothesis tracking, best-candidate storage, or iteration-to-iteration scratchpad.

4. **No function reuse guidance**: The prompt says "Variables persist across iterations" but doesn't explicitly say "Functions you defined in earlier iterations are still callable. Only redefine a function when you need to change it."

---

## Recommendations

### 1. Add a "Context Discipline" section to the system prompt

Add after the "How to Work" section:

```
## Context Discipline

Your conversation history grows with every iteration. Manage it deliberately:

- **Parse once**: Parse `context` in your first iteration and store the result.
  It persists — do not re-parse it every iteration.
- **Log selectively**: `console.log` output becomes part of the conversation.
  Print summaries, not raw data. For grids, log dimensions and color counts,
  not every cell.
- **Reuse functions**: Functions defined in earlier iterations are still callable.
  Only redefine a function when you change its logic.
- **Store intermediate results**: Use named variables for hypothesis results,
  computed features, and candidate answers. Reference them by name instead of
  recomputing.
```

### 2. Create a "context-discipline" driver

This is warranted as a standalone driver (see draft below). The driver would be more detailed than system prompt additions and could be included selectively based on task complexity.

### 3. Modify the `deadline-return` driver to reference `__ctx.local`

The current `deadline-return` driver says to "select your best candidate" but doesn't tell the agent where to store it. Adding:

```
After every successful training validation, store your answer:
  __ctx.local.bestAnswer = candidateAnswer;
At deadline, retrieve: return(__ctx.local.bestAnswer);
```

### 4. Consider architectural changes

- **Automatic output summarization**: When `console.log` output exceeds a threshold (e.g., 2KB), automatically truncate or summarize it before injecting into the conversation. The current 50KB limit is too generous for context health.
- **Iteration-start injection**: At the start of each iteration, inject a brief summary of what persistent variables are available: `[System: Persistent variables: task, transform, gridCopy, testOutputs]`. This would remind the agent that these exist.

---

## Draft Driver: context-discipline

```markdown
---
name: context-discipline
kind: driver
version: 0.1.0
description: Manage persistent state and context window pressure across iterations
author: sl
tags: [strategy, efficiency, context-management]
requires: []
---

## Context Discipline

Your conversation grows with every iteration. Every `console.log`, every code
block, every assistant response accumulates in the LLM context window. Treat
context capacity as a finite resource.

### Parse once, reuse everywhere

Parse `context` in your first iteration and store the result in a named
variable. It persists across all subsequent iterations.

```javascript
// Iteration 0: parse and store
const task = JSON.parse(context);
console.log(`${task.train.length} train, ${task.test.length} test`);

// Iteration 1+: just use 'task' — do NOT re-parse
for (const ex of task.train) { ... }
```

**Never** write `const task = JSON.parse(context)` after iteration 0.
The variable already exists.

### Log summaries, not raw data

Every `console.log` call adds to the conversation history. Print the minimum
needed to make decisions.

```javascript
// BAD: dumps 900 cells to conversation
grid.forEach(r => console.log(r.join(' ')));

// GOOD: log dimensions and summary statistics
const colors = {};
grid.flat().forEach(v => colors[v] = (colors[v]||0)+1);
console.log(`Grid ${grid.length}x${grid[0].length}, colors: ${JSON.stringify(colors)}`);
```

When you need to inspect specific cells, log slices:
```javascript
console.log(`Rows 0-2: ${grid.slice(0,3).map(r=>r.join(',')).join(' | ')}`);
```

### Reuse functions, redefine only what changed

Functions persist across iterations. When refining a solution, redefine **only
the function you changed**, not the entire solution block.

```javascript
// Iteration 8: define helpers
function gridCopy(g) { return g.map(r => [...r]); }
function findObjects(grid) { ... }
function solve(inp) { /* v1 */ }

// Iteration 10: only redefine solve
function solve(inp) { /* v2 — fixed turn logic */ }
// gridCopy and findObjects still available from iter 8
```

### Store intermediate results persistently

Use named variables to accumulate knowledge across iterations:

```javascript
// Store hypothesis results
hypothesisLog = hypothesisLog || [];
hypothesisLog.push({ name: 'rotation', score: 0.23, verdict: 'rejected' });

// Store the best candidate answer after each successful validation
if (trainScore === task.train.length) {
  bestAnswer = testOutputs;
  bestTrainScore = trainScore;
}
```

### Store your best answer early

After any successful training validation, store the answer persistently:

```javascript
__ctx.local.bestAnswer = JSON.stringify(testOutputs);
```

If you hit the deadline without a better answer, you can always retrieve it:

```javascript
return(JSON.parse(__ctx.local.bestAnswer));
```

### The cost model

Each iteration adds to the conversation:
- Your reasoning text (~100-500 tokens)
- Your code block (~50-300 tokens)
- The `console.log` output (~10-5000 tokens)

After 15 iterations, your context may contain 10,000-50,000 tokens of history.
At that scale, every unnecessary grid dump or re-parsed boilerplate competes
with the reasoning the model needs to solve the problem.
```

---

## Summary of Findings

| Metric | Value |
|--------|-------|
| Tasks analyzed | 20 |
| Total iterations | 308 |
| `JSON.parse(context)` calls | 140 (45% of iterations) |
| Tasks re-parsing every iteration | 9 (45% of tasks) |
| `__ctx.shared.data` usage | 0 |
| `__ctx.local` usage | 2 (1 task, for deadline-return only) |
| Function redefinitions | ~110 total, ~70 unnecessary |
| Code blocks using `console.log` | 295/308 (96%) |
| Delegation calls (`rlm()`) | 2 (in 2 tasks) |
| Tasks using sandbox variable passing for delegation | 0 |

**Key finding**: Agents almost completely ignore the persistent context features that differentiate the RLM from a stateless LLM. They treat each iteration as if it were a fresh session, re-parsing data, redefining functions, and dumping results to console rather than storing them in variables. The `__ctx.shared`, `__ctx.local`, and even basic variable reuse are essentially unused.

The `shared-context-delegation` driver exists but was not included in this run's driver stack. Even so, only 2 tasks attempted delegation at all, suggesting the driver would have had minimal impact. The bigger opportunity is a `context-discipline` driver that addresses the iteration-loop anti-patterns that affect all 20 tasks.

**Correlation with outcomes**: The 9 tasks with CRITICAL/HIGH re-parsing rates have an average score of 0.56 (5/9 correct). The 11 tasks with LOW re-parsing rates have an average score of 0.73 (8/11 correct). While this correlation is not strong enough to be causal (task difficulty is a confound), it suggests that agents with better context discipline may make more efficient use of their iteration budget.
