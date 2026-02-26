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

Your conversation grows with every iteration. Treat context capacity as a finite resource.

### Parse once, reuse everywhere

Parse `context` in your first iteration and store the result:

```javascript
// Iteration 0: parse and store
const task = JSON.parse(context);
console.log(`${task.train.length} train, ${task.test.length} test`);

// Iteration 1+: just use 'task' — do NOT re-parse
```

**Never** write `JSON.parse(context)` after iteration 0. The variable already exists.

### Log summaries, not raw data

Every `console.log` adds to conversation history permanently. Print the minimum needed.

```javascript
// BAD: dumps 900 cells
grid.forEach(r => console.log(r.join(' ')));

// GOOD: dimensions and summary
const colors = {};
grid.flat().forEach(v => colors[v] = (colors[v]||0)+1);
console.log(`Grid ${grid.length}x${grid[0].length}, colors: ${JSON.stringify(colors)}`);
```

When you need specific cells, log slices: `grid.slice(0,3).map(r=>r.join(',')).join(' | ')`

### Define functions once, redefine only what changed

Functions persist across iterations. When refining, redefine **only the function you changed**:

```javascript
// Iteration 5: define helpers
function findObjects(grid) { ... }
function solve(inp) { /* v1 */ }

// Iteration 7: only redefine solve — findObjects persists from iter 5
function solve(inp) { /* v2 — fixed edge case */ }
```

### Store your best answer early

After any successful training validation, cache the answer:

```javascript
bestAnswer = JSON.stringify(testOutputs);
```

If you hit the deadline without a better solution, you can return it immediately.
