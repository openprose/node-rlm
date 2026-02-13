# REPL Usage Analysis: How ARC-AGI Agents Use (and Underuse) Their JavaScript Sandbox

**Date:** 2026-02-13
**Scope:** 40 trajectories across run-026 (drivers, 65%) and run-027 (baseline, 40%)
**Source data:** Raw JSON results with full code blocks + trajectory annotations

---

## 1. How Agents Currently Use the REPL

### 1.1 The Standard Iteration Pattern

Nearly every trajectory follows the same code structure per iteration:

```javascript
// Step 1: Re-parse the task data (even though it hasn't changed)
const task = JSON.parse(context);

// Step 2: Write analysis/transform code
// ... (varies by iteration)

// Step 3: console.log results
console.log(`Train ${i}: ${match ? "PASS" : "FAIL"}`);
```

**Quantitative findings on re-parsing:**

| Metric | Run-026 (drivers) | Run-027 (baseline) |
|--------|:-:|:-:|
| Mean re-parses per task | 7.2 (successes), 6.7 (failures) | 1.2 (successes), 4.0 (failures) |
| Tasks re-parsing >80% of iters | 8/20 | 2/20 |
| Tasks re-parsing every iter | 3/20 (arc-0934a4d8, arc-4e34c42c, arc-7ed72f31) | 1/20 (arc-aa4ec2a5) |

The re-parsing pattern is mostly harmless in isolation (`JSON.parse` is fast), but it signals a deeper issue: **agents treat each iteration as a fresh program rather than a continuation of a persistent session**.

### 1.2 Function Redefinition: The Biggest Waste

The most egregious REPL anti-pattern is **re-defining the same utility function in multiple iterations**. Example from `arc-aa4ec2a5` (baseline, failed, 20 iters):

```
findComponents: defined in iters [3, 5, 6, 7, 8, 10, 16, 17, 19] (9 times)
bfs:            defined in iters [3, 4, 5, 6, 7, 8, 10, 16, 17, 19] (10 times)
```

The agent re-wrote `findComponents()` and `bfs()` from scratch **nine and ten times** across 20 iterations. Each redefinition consumed ~30-50 lines of code and ~200 tokens of context. That is 1500-2500 tokens of redundant code generation, plus the reasoning tokens to "decide" to write the same function again.

**Contrast with efficient variable persistence:** `arc-247ef758` (drivers, solved in 11 iters) parsed `JSON.parse(context)` only once in iter 0, then referenced the `task` variable in all subsequent iterations. It defined `transform()` in iter 5, refined it in iter 7, and reused it directly in iters 8-10. Total function definitions: 2 (one initial, one refined).

### 1.3 Code Patterns That Appear

**Common patterns across all 40 trajectories:**

1. **Grid printing** (100% of tasks): Every single trajectory starts by printing training grids with `inp.forEach(r => console.log(r.join(' ')))`. This is the universal first move.

2. **Structure extraction** (~90%): Finding divider columns, connected components, bounding boxes, color frequencies. Code like:
   ```javascript
   for (let c = 0; c < W; c++) {
     const vals = new Set();
     for (let r = 0; r < H; r++) vals.add(inp[r][c]);
     if (vals.size === 1 && !vals.has(0)) { divCol = c; break; }
   }
   ```

3. **Cell-by-cell comparison** (~75%): Computing differences between input and output:
   ```javascript
   for (let r = 0; r < H; r++) {
     for (let c = 0; c < W; c++) {
       if (inp[r][c] !== out[r][c]) diffs.push([r, c, inp[r][c], out[r][c]]);
     }
   }
   ```

4. **Train-set verification** (~65% of tasks, 100% of successes): The PASS/FAIL loop:
   ```javascript
   let correct = 0;
   for (let i = 0; i < task.train.length; i++) {
     const predicted = transform(task.train[i].input);
     const expected = task.train[i].output;
     const match = JSON.stringify(predicted) === JSON.stringify(expected);
     console.log(`Train ${i}: ${match ? "PASS" : "FAIL"}`);
     if (match) correct++;
   }
   console.log(`Score: ${correct}/${task.train.length}`);
   ```

5. **Row-by-row diff on failure** (~50%): When verification fails, printing mismatched rows:
   ```javascript
   if (!match) {
     for (let r = 0; r < expected.length; r++) {
       if (JSON.stringify(predicted[r]) !== JSON.stringify(expected[r])) {
         console.log(`  Row ${r} expected: ${expected[r].join(' ')}`);
         console.log(`  Row ${r} got:      ${predicted[r].join(' ')}`);
       }
     }
   }
   ```

### 1.4 How Much Computation vs "Thinking Out Loud"

**Run-026 (drivers):**
- Successes: Mean code length 29,125 chars across ~12 iterations = ~2,400 chars/iter
- Failures: Mean code length 47,865 chars across ~19 iterations = ~2,500 chars/iter

**Run-027 (baseline):**
- Successes: Mean code length 24,365 chars across ~13 iterations = ~1,900 chars/iter
- Failures: Mean code length 41,650 chars across ~20 iterations = ~2,100 chars/iter

Failed tasks generate more total code but at a similar per-iteration rate. The difference is that failures spend more iterations in the exploration phase writing analysis code (printing, counting, checking) rather than implementation code (transform functions, verification loops).

**Key finding:** In the reasoning text (not the code blocks), agents routinely describe hypotheses they could have tested with a 5-line code snippet. From `arc-aa4ec2a5` (baseline, iter 13 reasoning): "Let me look at the shapes as puzzle pieces. Each shape has an L-shape or similar. Two shapes that are 'complementary' might fit together..." -- this is 3 paragraphs of verbal reasoning about complementary shapes, when a 10-line code block checking shape-complement-fitting would have given an immediate answer.

### 1.5 Verification Discipline: The Success/Failure Divide

The starkest difference between successes and failures is the presence of systematic verification:

| Pattern | Run-026 Successes | Run-026 Failures | Run-027 Successes | Run-027 Failures |
|---------|:-:|:-:|:-:|:-:|
| Has PASS/FAIL verify loop | 13/13 (100%) | 6/7 (86%) | 0/8 (0%) | 0/12 (0%) |
| Has expected vs predicted diff | 13/13 (100%) | 4/7 (57%) | 5/8 (63%) | 0/12 (0%) |
| Has score counting | 13/13 (100%) | 4/7 (57%) | 4/8 (50%) | 1/12 (8%) |

**Run-027 baseline never uses PASS/FAIL loops.** Not a single one of the 20 baseline trajectories uses the structured `Train ${i}: PASS/FAIL` pattern. Instead, the baseline relies on manual visual inspection of output grids:

```javascript
// Baseline pattern (arc-aa4ec2a5 iter 15):
console.log("6-cells that were 4 in input:", sixCellsWere4);
console.log("8-cells that were 1 in input:", eightCellsWere1);
// ... agent reads these numbers and reasons about them in text
```

vs.

```javascript
// Driver pattern (arc-247ef758 iter 5):
let correct = 0;
for (let i = 0; i < task.train.length; i++) {
  const predicted = transform(task.train[i].input);
  const match = JSON.stringify(predicted) === JSON.stringify(expected);
  console.log(`Train ${i}: ${match ? "PASS" : "FAIL"}`);
  if (!match) { /* print row-by-row diff */ }
  if (match) correct++;
}
console.log(`Score: ${correct}/${task.train.length}`);
```

The drivers apparently instill the `PASS/FAIL` verification loop as a behavioral norm, which is a major contributor to the 25pp performance gap.

---

## 2. Code/Math Tricks They SHOULD Be Using

### 2.1 Batch Hypothesis Testing

**What agents do:** Test one symmetry type per iteration, wait for output, reason about it, then test another in the next iteration.

**Example from `arc-0934a4d8` (failed, 19 iters):** The agent tested symmetries one at a time:
- Iter 2: H/V reflection (rejected)
- Iter 3: 180-degree rotation (rejected)
- Iter 5: 180-rot on 8-region only (rejected)
- Iter 6: H-reflect and V-reflect on 8-region (rejected)
- Iter 7: 4-fold symmetry (rejected)
- Iter 8: Quadrant symmetry (rejected)
- Iter 9: 2x2 block symmetry, row/col pairing (partial)
- Iter 10: Point symmetry r+c=31 (accepted!)

**What they should do:** Test all symmetry types in a single iteration:

```javascript
const task = JSON.parse(context);

// Batch-test ALL symmetry hypotheses at once
function testSymmetries(inp) {
  const H = inp.length, W = inp[0].length;
  const results = {};

  // Find the 8-region
  let minR=H, maxR=0, minC=W, maxC=0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (inp[r][c] === 8) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }

  // Test every mapping at once
  const mappings = {
    'h-reflect': (r, c) => [r, W-1-c],
    'v-reflect': (r, c) => [H-1-r, c],
    '180-rot': (r, c) => [H-1-r, W-1-c],
    'point-sym-31': (r, c) => [31-r, 31-c],
  };

  // Also dynamically find row/col pair distances
  for (let d = 1; d < H; d++) {
    mappings[`row-pair-${d}`] = (r, c) => [d - r, d - c];
  }

  for (const [name, map] of Object.entries(mappings)) {
    let match = 0, total = 0, oob = 0;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (inp[r][c] === 8) {
          const [mr, mc] = map(r, c);
          total++;
          if (mr < 0 || mr >= H || mc < 0 || mc >= W) { oob++; continue; }
          if (inp[mr][mc] !== 8) match++;
        }
      }
    }
    results[name] = { match, total, oob, pct: (match/(total-oob)*100).toFixed(1) };
  }
  return results;
}

for (let t = 0; t < task.train.length; t++) {
  console.log(`\nTrain ${t}:`);
  const r = testSymmetries(task.train[t].input);
  // Sort by match percentage
  const sorted = Object.entries(r).sort((a,b) => b[1].match - a[1].match);
  for (const [name, s] of sorted.slice(0, 5)) {
    console.log(`  ${name}: ${s.match}/${s.total} (${s.pct}%) oob=${s.oob}`);
  }
}
```

**Savings:** This would replace iterations 2-10 (9 iterations!) with a single iteration. Even if the winning symmetry wasn't in the initial list, the batch results would immediately narrow the search space.

### 2.2 Automated Partial-Match Scoring

**What agents do:** After a failed implementation, they print row-by-row diffs and reason about what went wrong.

**What they should do:** Compute a quantitative score that guides incremental refinement:

```javascript
function scoreGrid(predicted, expected) {
  let match = 0, total = 0, diffs = [];
  for (let r = 0; r < expected.length; r++) {
    for (let c = 0; c < expected[0].length; c++) {
      total++;
      if (predicted[r]?.[c] === expected[r][c]) match++;
      else diffs.push({ r, c, got: predicted[r]?.[c], want: expected[r][c] });
    }
  }
  return {
    score: `${match}/${total} (${(match/total*100).toFixed(1)}%)`,
    diffs: diffs.slice(0, 20), // show first 20 diffs
    dimMatch: predicted.length === expected.length && predicted[0]?.length === expected[0]?.length
  };
}
```

**Example of where this would help:** In `arc-135a2760` (drivers, failed), the agent achieved 807/841 cells correct (96%) but scored 0. A partial-match scorer would have shown exactly which cells were wrong and enabled targeted debugging rather than the complete hypothesis abandonment that occurred.

### 2.3 Parameterized Transform Sweeps

**What agents do:** Manually adjust transform parameters one at a time across iterations.

**What they should do:** Write a parameterized transform and sweep automatically:

```javascript
// Instead of testing "does shape go at center of marker?" then
// "does shape go at top-left of marker?" across two iterations:

function placeShape(shape, marker, anchor) {
  // anchor: 'center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
  const offsets = {
    center: [0, 0],
    topLeft: [Math.floor(shape.h/2), Math.floor(shape.w/2)],
    // ... etc
  };
  // ... apply offset and place
}

// Sweep all anchoring strategies
for (const anchor of ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
  const result = transformWithAnchor(input, anchor);
  const score = scoreGrid(result, expected);
  console.log(`Anchor ${anchor}: ${score.score}`);
}
```

### 2.4 Test-Driven Development (Write Harness First)

**What agents do:** Build the transform function iteratively, test it, find it fails, revise.

**What they should do:** Write the verification harness FIRST, then iterate on the transform:

```javascript
// ITERATION 1: Write harness (reusable for all subsequent iterations)
const task = JSON.parse(context);

// Verification harness - call this after every transform change
function verify(transformFn) {
  let pass = 0;
  for (let i = 0; i < task.train.length; i++) {
    const pred = transformFn(task.train[i].input);
    const exp = task.train[i].output;
    const match = JSON.stringify(pred) === JSON.stringify(exp);
    if (!match) {
      let diffs = 0;
      for (let r = 0; r < exp.length; r++)
        for (let c = 0; c < exp[0].length; c++)
          if (pred?.[r]?.[c] !== exp[r][c]) diffs++;
      console.log(`Train ${i}: FAIL (${diffs} cell diffs)`);
    } else {
      console.log(`Train ${i}: PASS`);
      pass++;
    }
  }
  console.log(`Score: ${pass}/${task.train.length}`);
  return pass === task.train.length;
}

// Store for future iterations
globalThis.verify = verify;
globalThis.task = task;
```

Then in subsequent iterations:
```javascript
// ITERATION N: Just define/refine the transform and call verify
function transform(inp) { /* ... */ }
verify(transform);
```

### 2.5 Statistical Feature Extraction Before Hypothesizing

**What agents do:** Look at the grid visually (printed) and reason about patterns in natural language.

**What they should do:** Programmatically extract features first:

```javascript
function analyzeGrid(grid) {
  const H = grid.length, W = grid[0].length;
  const colors = {};
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const v = grid[r][c];
      if (!colors[v]) colors[v] = { count: 0, rows: new Set(), cols: new Set() };
      colors[v].count++;
      colors[v].rows.add(r);
      colors[v].cols.add(c);
    }

  // Symmetry tests
  let hSym = 0, vSym = 0, rotSym = 0, total = H * W;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      if (grid[r][c] === grid[r][W-1-c]) hSym++;
      if (grid[r][c] === grid[H-1-r][c]) vSym++;
      if (grid[r][c] === grid[H-1-r][W-1-c]) rotSym++;
    }

  return {
    dims: [H, W],
    colorFreq: Object.fromEntries(Object.entries(colors).map(([k,v]) => [k, v.count])),
    hSymmetry: (hSym/total*100).toFixed(1) + '%',
    vSymmetry: (vSym/total*100).toFixed(1) + '%',
    rotSymmetry: (rotSym/total*100).toFixed(1) + '%',
    uniqueColors: Object.keys(colors).length,
    background: Object.entries(colors).sort((a,b) => b[1].count - a[1].count)[0][0],
  };
}

for (let i = 0; i < task.train.length; i++) {
  console.log(`\n--- Train ${i} ---`);
  console.log('Input:', JSON.stringify(analyzeGrid(task.train[i].input)));
  console.log('Output:', JSON.stringify(analyzeGrid(task.train[i].output)));
}
```

### 2.6 Regression Testing on Every Change

**What agents do (well, in run-026):** Re-verify all training examples after changing the transform.

**Example from `arc-36a08778` (drivers, 18 iters, solved):**
```
iter 10: test on training: 1/6 pass  (v1)
iter 13: test on training: 0/6 pass  (v2 -- overcorrection!)
iter 15: test on training: 4/6 pass  (v3)
iter 18: test on training: 6/6 pass  (v4)
```

This is the correct pattern. Each change was immediately validated against the full training set. The regression from 1/6 to 0/6 in v2 was caught immediately, preventing the agent from building on a broken foundation.

**What baseline agents do:** Manual inspection of one example at a time, never running a full regression suite:
```
iter 15: "Let me check Train 0..." (manually traces cells)
iter 16: "Now let me check Train 4..." (manually traces different cells)
iter 17: "Let me verify Train 2..." (still manually tracing)
```

---

## 3. Specific Missed Opportunities

### 3.1 arc-0934a4d8: 9 iterations wasted on serial symmetry testing

**What happened:** The agent tested 8 symmetry hypotheses across iterations 2-9, one per iteration. Each test involved writing a fresh double-nested loop over the 30x30 grid.

**What should have happened:** A single batch-test iteration (see Section 2.1) would have tested all 8+ symmetries simultaneously. The winning pattern (point symmetry at axis 15.5) would have been found in iteration 2 instead of iteration 10, saving 8 iterations.

**Actual code (iter 2 -- tests only H/V reflection):**
```javascript
// Check horizontal reflection symmetry (left-right)
let hDiffs = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    if (inp[r][c] !== inp[r][W-1-c]) {
      hDiffs.push([r, c, inp[r][c], inp[r][W-1-c]]);
    }
  }
}
// Check vertical reflection symmetry (top-bottom)
let vDiffs = [];
// ... (same loop again for vertical)
```

**Better code (tests all symmetries at once):**
```javascript
const symmetries = {
  'h-reflect': (r,c,H,W) => [r, W-1-c],
  'v-reflect': (r,c,H,W) => [H-1-r, c],
  '180-rot':   (r,c,H,W) => [H-1-r, W-1-c],
  'point-31':  (r,c,H,W) => [31-r, 31-c],
};
// Also try all pair distances from 20 to 35
for (let d = 20; d <= 35; d++) {
  symmetries[`pair-${d}`] = (r,c,H,W) => [d-r, d-c];
}
const results = {};
for (const [name, fn] of Object.entries(symmetries)) {
  let match = 0, total = 0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const [mr, mc] = fn(r, c, H, W);
      if (mr >= 0 && mr < H && mc >= 0 && mc < W) {
        total++;
        if (inp[r][c] === inp[mr][mc]) match++;
      }
    }
  results[name] = { match, total, pct: (match/total*100).toFixed(1) };
}
// Sort and print top 5
Object.entries(results)
  .sort((a,b) => parseFloat(b[1].pct) - parseFloat(a[1].pct))
  .slice(0, 5)
  .forEach(([name, s]) => console.log(`${name}: ${s.pct}% (${s.match}/${s.total})`));
```

### 3.2 arc-aa4ec2a5 (baseline): 10 function redefinitions, 0 implementations

**What happened:** The agent redefined `findComponents()` 9 times and `bfs()` 10 times across 20 iterations. Each redefinition was nearly identical -- BFS over the grid to find connected components. But the agent never built on previous iterations' work; it re-derived the component list from scratch every time.

**What should have happened:** Define utility functions once in iteration 1, store them on `globalThis`, and reuse:

```javascript
// Iteration 1: Define and store utilities
function findComponents(grid) { /* BFS */ }
function getBBox(cells) { /* bounding box */ }
globalThis.utils = { findComponents, getBBox };
globalThis.task = JSON.parse(context);

// All subsequent iterations:
const { findComponents, getBBox } = globalThis.utils;
const comps = findComponents(globalThis.task.train[0].input);
// ... new analysis code only
```

### 3.3 arc-36a08778 (baseline): 20 iterations of analysis, 0 implementations

**What happened:** The baseline agent discovered the correct "beam propagation" pattern at iteration 19 with the statement: "Pattern verified! Now let me code the algorithm." But the iteration ended with only a `console.log` statement rather than actual code. Budget exhausted.

**What the drivers version did differently:** It implemented a (buggy) first version at iteration 9, tested it (1/6 pass), debugged through 4 revisions, and achieved 6/6 by iteration 18. The key difference was committing to implementation with 10 iterations remaining rather than waiting for perfect understanding.

**What should have been done:** Even a partial implementation at iteration 10 would have been informative:

```javascript
// "Good enough" implementation at iter 10 (even if buggy):
function solve(grid) {
  const H = grid.length, W = grid[0].length;
  const out = grid.map(r => [...r]);

  // Find initial 6-lines (2-cell vertical at top)
  const initCols = [];
  for (let c = 0; c < W; c++) {
    if (grid[0][c] === 6 && grid[1][c] === 6) initCols.push(c);
  }

  // Find horizontal 2-segments
  const segs = [];
  for (let r = 0; r < H; r++) {
    let c = 0;
    while (c < W) {
      if (grid[r][c] === 2) {
        let start = c;
        while (c < W && grid[r][c] === 2) c++;
        segs.push({ r, c1: start, c2: c-1 });
      } else c++;
    }
  }

  // TODO: implement chaining logic
  // For now, just draw rectangles around each segment
  for (const seg of segs) {
    // ... naive rectangle drawing
  }
  return out;
}

// Test immediately:
verify(solve);  // Even 0/6 is informative!
```

### 3.4 arc-a251c730 (baseline): Perfect validation, never called return()

**What happened:** The baseline agent validated its solution perfectly on both training examples at iteration 11. It then spent iterations 12-19 refining pattern extraction logic for the test case, generating pixel-perfect output at iteration 19, but **never called `return()`** to submit the answer.

**What should have happened:** As soon as training validation passes, generate and return the test answer:

```javascript
// When training passes:
if (verify(solve)) {
  const testOutput = solve(task.test[0].input);
  console.log("Test output generated. Returning.");
  return(JSON.stringify([testOutput]));  // SUBMIT IMMEDIATELY
}
```

### 3.5 arc-446ef5d2 (drivers): 19 explore iterations, 0 extract iterations

**What happened:** Despite having a `exploration-budget` driver, the agent spent 19 of 20 iterations in the explore phase with 0 extract iterations and 0 implementation attempts. It identified the correct assembly pattern at iteration 9 but continued analyzing edge cases for 11 more iterations without ever writing a `solve()` function.

**What should have happened:** The exploration-budget driver should have hard-stopped exploration by iteration 12 and forced implementation. Even an incomplete implementation would have provided useful diagnostic information.

### 3.6 arc-195c6913 (drivers): Near-miss with no partial-match scoring

**What happened:** The agent got within 1 cell diff on Train 0 but 52/93 diffs on other training examples. Without a quantitative partial-match score, it couldn't tell that the Train 0 solution was 99% correct and could be used as a debugging reference for the other examples.

**What should have happened:** A partial-match scorer would have revealed:
```
Train 0: 92/93 cells correct (98.9%) -- 1 cell off
Train 1: 41/93 cells correct (44.1%) -- systematic error
Train 2: 38/93 cells correct (40.9%) -- systematic error
```

This pattern (one example nearly perfect, others systematically wrong) suggests the transform works for a special case but has a generalisation bug. The 1-cell-off Train 0 is the debugging target.

---

## 4. Patterns from Successful Trajectories

### 4.1 The Winning Template

All 13 successful run-026 tasks and 8 successful run-027 tasks share a common structure:

**Phase 1 (Iterations 1-3): Parse and Explore**
- Parse task data once, store in variable
- Print training grids
- Extract structural features (dimensions, colors, dividers, components)

**Phase 2 (Iterations 3-8): Hypothesis Formation and Testing**
- Form hypothesis based on structural analysis
- Test hypothesis **with code**, not just reasoning
- If hypothesis fails, extract diagnostic info from the failure

**Phase 3 (Iterations 6-14): Implementation and Verification**
- Write `transform()` or `solve()` function
- Run full training verification: `Train 0: PASS, Train 1: PASS, ...`
- If any fail, print row-by-row diffs
- Iterate on transform with targeted fixes

**Phase 4 (Final 2-3 iterations): Apply and Return**
- Apply validated transform to test input(s)
- Sanity-check test output (dimensions, value ranges)
- Call `return(JSON.stringify(testOutputs))`

### 4.2 Quantitative Success Predictors

From the code-level analysis:

| Code Pattern | Success Rate |
|---|:-:|
| Has PASS/FAIL verification loop | 19/19 (100%) in run-026 successes |
| Has row-by-row diff on failure | 13/13 (100%) in run-026 successes |
| Defines transform function | 13/13 (100%) in run-026 successes |
| Re-verifies after every change | 11/13 (85%) in run-026 successes |
| Never implements (`0 extract iters`) | 0/40 successes across both runs |

**The single strongest predictor:** Having a `PASS/FAIL` verification loop. Every single success in run-026 had one. Zero successes in run-027 had one (the baseline succeeded through manual inspection, which works but is slower and less reliable).

### 4.3 Efficient Variable Persistence Pattern

The fastest solves persist variables across iterations. The optimal pattern:

```
Iter 0: const task = JSON.parse(context);  // Parse once
Iter 1: // Use `task` directly, define analysis functions
Iter 2-N: // Reference `task`, call previously-defined functions
Final iter: return(JSON.stringify(answer));  // Use persisted answer variable
```

From `arc-6e453dd6` (baseline, solved in 8 iters):
```
Iter 0: const task = JSON.parse(context);  // Parse
Iter 1-4: // Analysis code referencing `task`
Iter 5: function solve(grid) { ... }  // Define solve
Iter 6: const testResult = solve(task.test[0].input);  // Use BOTH persisted vars
Iter 7: return(testResult);  // Return persisted result
```

This is textbook REPL efficiency: define once, reuse many times.

---

## 5. Proposed "REPL Discipline" Driver

Based on the findings above, here is a proposed driver that teaches agents to use the REPL more effectively.

### Driver: `repl-discipline`

```
# REPL Discipline

You have a PERSISTENT Node.js REPL. Variables, functions, and state carry across iterations.
Use this to your advantage by following these rules:

## Rule 1: Parse Once, Reuse Always

In your FIRST iteration, parse the task data and store it:

    const task = JSON.parse(context);

In ALL subsequent iterations, reference `task` directly. Do NOT call `JSON.parse(context)` again.

## Rule 2: Build a Verification Harness Early

By iteration 2, define and store a verification function:

    function verify(transformFn) {
      let pass = 0;
      for (let i = 0; i < task.train.length; i++) {
        const pred = transformFn(task.train[i].input);
        const exp = task.train[i].output;
        if (JSON.stringify(pred) === JSON.stringify(exp)) {
          console.log(`Train ${i}: PASS`);
          pass++;
        } else {
          let diffs = 0, total = exp.length * exp[0].length;
          for (let r = 0; r < exp.length; r++)
            for (let c = 0; c < exp[0].length; c++)
              if (pred?.[r]?.[c] !== exp[r][c]) diffs++;
          console.log(`Train ${i}: FAIL (${diffs}/${total} cells wrong, ${((total-diffs)/total*100).toFixed(1)}% correct)`);
        }
      }
      console.log(`\nScore: ${pass}/${task.train.length}`);
      return pass === task.train.length;
    }

Then in every subsequent iteration after writing or modifying a transform:

    if (verify(transform)) {
      const answer = task.test.map(t => transform(t.input));
      return(JSON.stringify(answer));
    }

## Rule 3: Define Utility Functions Once

If you write a utility function (BFS, flood fill, connected components, grid copy, etc.),
define it ONCE and reuse it. Never re-write the same function in a later iteration.
If you need to modify it, reference the existing definition and make targeted changes.

## Rule 4: Batch-Test Hypotheses

When exploring multiple hypotheses (e.g., symmetry types, transform variants, parameter values),
test them ALL in a single iteration using a loop:

    const hypotheses = {
      'h-reflect': (r,c) => [r, W-1-c],
      'v-reflect': (r,c) => [H-1-r, c],
      '180-rot':   (r,c) => [H-1-r, W-1-c],
    };
    for (const [name, fn] of Object.entries(hypotheses)) {
      const score = testHypothesis(fn);
      console.log(`${name}: ${score}`);
    }

Do NOT test one hypothesis per iteration.

## Rule 5: Use Quantitative Scores, Not Visual Inspection

Never say "that looks right" or "let me check visually." Always compute:
- Cell-by-cell match percentage
- Row-by-row diff showing exact mismatches
- Dimension verification (predicted vs expected dimensions)

## Rule 6: Implement Before You Fully Understand

By iteration 8 (or halfway through your budget), you MUST have at least one
implementation attempt tested against training data. Even a partial, buggy
implementation is more informative than continued analysis.

A buggy implementation that scores 2/4 training examples tells you exactly
which cases work and which fail. Pure analysis tells you nothing quantitative.

## Rule 7: Store Intermediate Results

Expensive computations (connected components, color maps, structural analysis)
should be stored in variables that persist across iterations:

    // Iteration 3:
    const components = findComponents(task.train[0].input);
    globalThis.trainComponents = task.train.map(t => findComponents(t.input));

    // Iteration 7: (reuse without recomputing)
    const comps = globalThis.trainComponents;

## Rule 8: Regression Test After Every Change

After modifying your transform function, ALWAYS re-run verify() on ALL
training examples. Never assume a change that fixes one case doesn't break another.

Good pattern:
    iter 6: verify(transformV1)  -> 1/3 pass
    iter 7: verify(transformV2)  -> 0/3 pass (regression! revert change)
    iter 8: verify(transformV3)  -> 2/3 pass
    iter 9: verify(transformV4)  -> 3/3 pass -> return answer

## Rule 9: Return Immediately When Training Passes

The moment verify() returns true (all training examples pass), generate the test
output and call return(). Do not continue exploring or "double-checking."

    if (verify(transform)) {
      const answer = task.test.map(t => transform(t.input));
      return(JSON.stringify(answer));
    }
```

### Expected Impact

Based on the patterns observed:

1. **Rule 1 (parse once):** Saves ~50-200 tokens per iteration. Over 15 iterations, saves ~1500 tokens.

2. **Rule 2 (verify harness):** This is the highest-impact rule. The verify loop is present in 100% of run-026 successes and 0% of run-027 successes. Instilling this as a default behavior should convert at least some of the baseline's manual-inspection trajectories into structured-verification trajectories.

3. **Rule 3 (define once):** Prevents the `findComponents` x9 redefinition pattern. Saves ~300-500 tokens per avoidable redefinition, and more importantly saves the reasoning overhead of "deciding" to write the same function again.

4. **Rule 4 (batch test):** Directly addresses the `arc-0934a4d8` pattern of testing one symmetry per iteration. Could save 3-8 iterations on tasks with multiple candidate transforms.

5. **Rule 5 (quantitative scores):** Addresses the `arc-195c6913` near-miss problem. Partial-match scoring makes incremental refinement possible.

6. **Rule 6 (implement early):** Directly addresses the analysis-paralysis failure mode that caused all 12 baseline timeouts. Forcing implementation by the halfway point converts "understood but never coded" into "coded but buggy," which is strictly better.

7. **Rule 8 (regression test):** Already practiced by 85% of run-026 successes. Making it explicit should increase adoption to ~100%.

8. **Rule 9 (return immediately):** Directly addresses the `arc-a251c730` failure where perfect training validation at iter 11 was followed by 9 more iterations of refinement without ever calling return().

### Driver Interaction with Existing Drivers

This driver complements the existing suite:

- **verify-all-examples + verify-before-return:** The `repl-discipline` driver provides the *code template* for verification. The existing drivers provide the *behavioral mandate* to verify. Together they ensure both the habit and the tool.

- **exploration-budget:** The `repl-discipline` Rule 6 reinforces the exploration ceiling with a specific code-level instruction: "have at least one implementation attempt by iteration 8."

- **deadline-return:** The `repl-discipline` Rule 9 reinforces return discipline with the specific pattern: `if (verify(transform)) { return(...) }`.

- **one-block-per-iteration:** Compatible. Each rule produces one focused code block per iteration.

---

## Appendix: Key Data Points

### A. Re-Parse Frequency Across Runs

| Category | Parse-Once Tasks | Every-Iter Tasks | Mean Reparses/Task |
|----------|:-:|:-:|:-:|
| Run-026 Successes | 4/13 | 3/13 | 7.2 |
| Run-026 Failures | 2/7 | 3/7 | 6.7 |
| Run-027 Successes | 6/8 | 0/8 | 1.2 |
| Run-027 Failures | 7/12 | 1/12 | 4.0 |

### B. Function Definitions Per Task

| Category | Mean FnDefs | Tasks with >5 FnDefs |
|----------|:-:|:-:|
| Run-026 Successes | 4.2 | 3/13 |
| Run-026 Failures | 7.3 | 4/7 |
| Run-027 Successes | 3.0 | 1/8 |
| Run-027 Failures | 4.2 | 5/12 |

Failed tasks define more functions because they keep starting over rather than building incrementally.

### C. Code Volume Comparison

| Category | Mean Total Code (chars) | Mean Code/Iter (chars) |
|----------|:-:|:-:|
| Run-026 Successes | 29,125 | 2,400 |
| Run-026 Failures | 47,865 | 2,500 |
| Run-027 Successes | 24,365 | 1,900 |
| Run-027 Failures | 41,650 | 2,100 |

Failures generate ~60% more total code but at similar per-iteration rates -- they simply have more iterations (because they time out at 20) and spend those iterations on analysis rather than implementation.

### D. The Critical arc-aa4ec2a5 Comparison

This task perfectly illustrates the REPL discipline gap:

| Metric | Run-026 (drivers, score=1) | Run-027 (baseline, score=0) |
|--------|:-:|:-:|
| Iterations | 12 | 20 |
| JSON.parse calls | 1 | 20 |
| findComponents definitions | 1 | 9 |
| bfs definitions | 1 | 10 |
| PASS/FAIL verify loop | Yes | No |
| Breakthrough iteration | 5 | 19 |
| Implementation attempts | 3 | 0 |
| Explore iterations | 6 | 19 |
| Extract iterations | 4 | 0 |

The drivers version parsed once, defined utilities once, used structured verification, implemented early, and submitted with 8 iterations to spare. The baseline re-derived everything from scratch every iteration, never implemented, and ran out of time.
