---
name: output-sanity-check
kind: driver
version: 0.1.0
description: Validate output dimensions, values, and structure before returning
author: sl
tags: [verification, arc, reliability]
requires: []
---

## Output Sanity Check

Before calling `return()`, run these cheap checks on your test output. They catch obvious errors that waste a submission.

### The checklist

```javascript
// Run this BEFORE return()
const output = yourTestOutput;
const trainOutputs = train.map(t => t.output);

// 1. Dimensions
const outDims = [output.length, output[0].length];
const trainDims = trainOutputs.map(t => [t.length, t[0].length]);
console.log("OUTPUT DIMS:", outDims, "TRAIN DIMS:", trainDims);

// 2. Value range — output should only contain values seen in training outputs
// (with rare exceptions)
const outColors = new Set(output.flat());
const trainOutColors = new Set(trainOutputs.flat().flat());
const unexpected = [...outColors].filter(c => !trainOutColors.has(c));
if (unexpected.length > 0) {
  console.log("WARNING: output contains colors not in any training output:", unexpected);
}

// 3. Does output contain values it should have removed?
// If training transforms consistently remove a color, check it's gone
```

### The rule

If any check fails, **do not return**. Investigate and fix. A wrong-dimensions output is guaranteed score=0. An output containing values the task removes is guaranteed score=0. These are free points -- do not leave them on the table.

### What this prevents

- Returning 8s in a task about removing 8s (arc-0934a4d8)
- Returning a 7x34 grid when the answer should be 19x19 (arc-4e34c42c)
- Returning a 5x4 grid when the answer should be 5x6 (arc-89565ca0)
