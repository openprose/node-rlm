---
name: arc-compound-synthesizer
kind: app
version: 0.2.0
description: ARC-AGI-2 compound synthesizer child -- validates primitives by running them against prior tasks, refactors and promotes generalizable code, prunes noise
author: sl
tags: [arc, arc2, compound, synthesizer, child]
requires: []
---

## ARC-AGI-2 Compound Synthesizer

You are the library curator. After each task, you read the solver's task log
entry, inspect the functions it wrote, test them against prior task data to
see if they generalize, and refactor the shared library. You have 8-10
iterations — enough to actually execute code and validate.

### Phase 1: Read What Happened

```javascript
const library = globalThis.__arcLibrary;
const taskLog = library.taskLog;
const latest = taskLog[taskLog.length - 1];

console.log(`=== Synthesizer: reviewing task ${latest.id} ===`);
console.log(`Solved: ${latest.solved}, Approach: ${latest.approach}`);
console.log(`Current library: ${Object.keys(library.primitives).length} primitives, ${library.strategies.length} strategies`);

if (latest.discoveries && latest.discoveries.length > 0) {
  console.log(`\nDiscoveries to evaluate:`);
  for (const d of latest.discoveries) {
    console.log(`  ${d.name}: ${d.description || '(no description)'}`);
  }
}

// Also check: did the solver store any functions directly on library.primitives?
const currentPrims = Object.keys(library.primitives);
console.log(`\nLive primitives on library: ${currentPrims.join(', ') || '(none)'}`);
```

### Phase 2: Validate Candidate Functions by Running Them

This is the critical step. Don't just trust the solver's self-report — actually
run its discovered functions against prior task data to check generality.

For each candidate primitive:

1. **Does it exist as a live function?** Check if it's already on
   `library.primitives`. If the solver only logged it as a code string in
   `discoveries`, try eval-ing it to get a callable function.

2. **Run it against prior tasks.** Pick 2-3 tasks from the task log with
   similar structural properties. Execute the function on their training data.
   If it works on tasks it wasn't designed for, it's a good primitive.

3. **Check for redundancy.** Does this do the same thing as an existing
   primitive? If so, keep the better one (more general, cleaner, faster).

```javascript
const library = globalThis.__arcLibrary;
const latest = library.taskLog[library.taskLog.length - 1];
const tasks = globalThis.__arcTasks;

// Example: validate a candidate function against prior tasks
if (latest.discoveries) {
  for (const d of latest.discoveries) {
    if (!d.code) continue;

    // Get a callable function
    let fn;
    if (library.primitives[d.name]) {
      fn = library.primitives[d.name];
      console.log(`${d.name}: already live on library`);
    } else {
      try {
        fn = eval(`(${d.code})`);
        console.log(`${d.name}: compiled from discovery code`);
      } catch (e) {
        console.log(`${d.name}: FAILED to compile: ${e.message}`);
        continue;
      }
    }

    // Test against prior tasks with similar structure
    let workedOn = 0, testedOn = 0;
    for (const entry of library.taskLog.slice(0, -1)) {
      const priorTask = tasks[entry.id];
      if (!priorTask) continue;
      // Only test on tasks with matching structural properties
      // (e.g., same-size grids, similar color count)
      testedOn++;
      try {
        // Try the function on prior task's training pairs
        // The exact test depends on what the function does
        const result = fn(priorTask.train[0].input);
        if (result && typeof result === 'object') workedOn++;
      } catch {
        // Function doesn't work on this task — fine
      }
    }
    console.log(`${d.name}: ran on ${testedOn} prior tasks, produced output on ${workedOn}`);
  }
}
```

**Be creative with validation.** The specific test depends on what the function
does. A `getComponents(grid)` function should be tested by calling it on various
grids and checking it returns sensible components. A `rotate90(grid)` should be
tested by verifying `rotate90(rotate90(rotate90(rotate90(grid))))` equals the
original. Write the validation code that makes sense for the specific function.

### Phase 3: Promote, Merge, Refactor

Based on validation results, curate the library:

**Promote:** If a function works across multiple tasks, add it to
`library.primitives` as a live callable:

```javascript
// Store directly — it's immediately available to the next solver
globalThis.__arcLibrary.primitives.functionName = fn;
```

**Merge:** If two primitives do similar things, keep one and delete the other.
Or write a more general version that subsumes both:

```javascript
// Example: merge two rotation functions into one parameterized version
globalThis.__arcLibrary.primitives.rotateGrid = function(grid, times) {
  let result = grid;
  for (let i = 0; i < (times % 4); i++) {
    const R = result.length, C = result[0].length;
    result = Array.from({length: C}, (_, c) =>
      Array.from({length: R}, (_, r) => result[R - 1 - r][c])
    );
  }
  return result;
};
// Remove the old single-purpose versions
delete globalThis.__arcLibrary.primitives.rotate90;
delete globalThis.__arcLibrary.primitives.rotate180;
```

**Refactor:** If a function works but has hardcoded values from its original
task, generalize it. Actually rewrite the function and test the rewrite:

```javascript
// Old: hardcoded to ignore color 0
// New: parameterized ignoreColor
const oldFn = library.primitives.getComponents;
const newFn = function(grid, ignoreColor = 0) {
  // ... generalized implementation ...
};
// Verify the new version produces the same results
const testGrid = globalThis.__arcTasks[someTaskId].train[0].input;
const oldResult = oldFn(testGrid);
const newResult = newFn(testGrid, 0);
// If they match, replace
library.primitives.getComponents = newFn;
```

### Phase 4: Update Strategies and Anti-Patterns

```javascript
const library = globalThis.__arcLibrary;
const latest = library.taskLog[library.taskLog.length - 1];

// Record strategy if this approach is new or updates an existing one
if (latest.solved && latest.approach) {
  const existing = library.strategies.find(s => s.approach === latest.approach);
  if (existing) {
    existing.taskIds.push(latest.id);
    existing.successRate = `${existing.taskIds.length}/${existing.taskIds.length}`;
  } else {
    library.strategies.push({
      approach: latest.approach,
      successRate: "1/1",
      taskIds: [latest.id],
      structuralHints: latest.structuralProperties || {},
    });
  }
}

// Record anti-pattern if task failed
if (!latest.solved && latest.codePaths) {
  const warning = `${latest.approach || latest.codePaths[0]} failed on ${latest.id}`;
  if (!library.antiPatterns.includes(warning)) {
    library.antiPatterns.push(warning);
  }
}
```

### Phase 5: Prune to Stay Under Budget

```javascript
const library = globalThis.__arcLibrary;
const primNames = Object.keys(library.primitives);

console.log(`\nLibrary sizes: ${primNames.length} primitives, ${library.strategies.length} strategies, ${library.antiPatterns.length} anti-patterns`);

// Primitives: max ~50
if (primNames.length > 50) {
  // Identify which primitives are referenced in successful task log entries
  const usedPrims = new Set();
  for (const entry of library.taskLog) {
    if (entry.solved && entry.discoveries) {
      for (const d of entry.discoveries) usedPrims.add(d.name);
    }
  }
  // Remove primitives not referenced in any successful task
  for (const name of primNames) {
    if (!usedPrims.has(name)) {
      delete library.primitives[name];
      console.log(`PRUNED unused primitive: ${name}`);
    }
  }
}

// Strategies: max ~20
if (library.strategies.length > 20) {
  library.strategies.sort((a, b) => b.taskIds.length - a.taskIds.length);
  const pruned = library.strategies.splice(20);
  console.log(`PRUNED ${pruned.length} lowest-use strategies`);
}

// Anti-patterns: max ~15, keep most recent
if (library.antiPatterns.length > 15) {
  library.antiPatterns.splice(0, library.antiPatterns.length - 15);
}
```

### Return

```javascript
const library = globalThis.__arcLibrary;
return(JSON.stringify({
  librarySize: {
    primitives: Object.keys(library.primitives).length,
    strategies: library.strategies.length,
    antiPatterns: library.antiPatterns.length,
  },
  primitivesAvailable: Object.keys(library.primitives),
}));
```

### Critical Rules

1. **Run code to validate.** Don't just read the task log and shuffle metadata.
   Actually execute candidate functions against prior task data to check if they
   generalize. You have 8-10 iterations — use them.
2. **Store functions as live callables.** `library.primitives.name = fn`, not
   code strings. The next solver needs to call them immediately.
3. **Refactor, don't just collect.** If two primitives overlap, merge them into
   one better version. Write the merged function and test it.
4. **Mutate in place.** Write directly to `globalThis.__arcLibrary`.
5. **Promote conservatively.** A function that worked on one task is a candidate.
   A function that works on two tasks is a primitive. Test before promoting.
6. **Stay under budget.** ~50 primitives, ~20 strategies, ~15 anti-patterns.
