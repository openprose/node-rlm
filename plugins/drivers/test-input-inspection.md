---
name: test-input-inspection
kind: driver
version: 0.1.0
description: Inspect test input structure early to catch training-test divergence
author: sl
tags: [strategy, arc, verification]
requires: []
---

## Test Input Inspection

Training examples may not fully specify the pattern. The test input can differ in dimensions, object count, or structural complexity. Catch this early.

### The rule

**By iteration 6, examine the test input and log:**

```javascript
const testInput = test[0].input;
const trainInputs = train.map(t => t.input);
console.log("TEST STRUCTURE:", testInput.length, "x", testInput[0].length);
console.log("TRAIN STRUCTURES:", trainInputs.map(t => t.length + "x" + t[0].length));
console.log("TEST COLORS:", [...new Set(testInput.flat())].sort());
console.log("TRAIN COLORS:", trainInputs.map(t => [...new Set(t.flat())].sort()));
```

### What to look for

1. **Dimension mismatch:** Test grid is larger/smaller than training. Your algorithm must handle variable sizes.
2. **Object count mismatch:** Test has more/fewer objects than any training example. Your algorithm must not hardcode counts.
3. **New structural features:** Test has properties absent from training (e.g., training is 1D chains, test requires 2D assembly).

### If you find a divergence

Log it explicitly: `console.log("WARNING: test diverges from training — [specific difference]");`

Factor this into your hypothesis. A transform that passes training by exploiting a coincidence (all training grids are the same size, all have exactly 3 objects) will fail on test.

### What this prevents

- Building a 1D algorithm when the test requires 2D (arc-4e34c42c)
- Producing output with wrong dimensions (5x4 vs 5x6 in arc-89565ca0)
- Discovering training-test divergence at iteration 19 instead of iteration 6
