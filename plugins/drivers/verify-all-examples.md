---
name: verify-all-examples
kind: driver
version: 0.2.0
description: Test against ALL examples during development, and re-verify as a hard gate before return()
author: sl
tags: [strategy, verification, arc]
requires: []
---

## Verify All Examples

Never test a hypothesis on a single example. Always test against **every** training example in a single pass.

### The pattern

Every time you write a candidate transformation, wrap it in a verification loop:

```javascript
let correct = 0;
const results = [];
for (let i = 0; i < train.length; i++) {
  const predicted = transform(train[i].input);
  const expected = train[i].output;
  const match = JSON.stringify(predicted) === JSON.stringify(expected);
  console.log(`Train ${i}: ${match ? "PASS" : "FAIL"}`);
  if (!match && predicted && expected) {
    // Show first row diff for quick diagnosis
    console.log("  Expected row 0:", JSON.stringify(expected[0]));
    console.log("  Got row 0:     ", JSON.stringify(predicted[0]));
  }
  if (match) correct++;
  results.push({ i, match });
}
console.log(`Score: ${correct}/${train.length}`);
```

### Log a running scoreboard

Maintain a hypothesis scoreboard across iterations. After each verification pass, log:

```
SCOREBOARD:
  Hypothesis 1 (reflection):     2/4
  Hypothesis 2 (color mapping):  1/4
  Hypothesis 3 (region extract): 3/4  <-- best so far
```

This prevents you from abandoning a 3/4 hypothesis for an untested one.

### What this prevents

- Analyzing only Train 0 in depth while ignoring Train 1-3
- Believing a hypothesis works because it matches one example
- Cycling through hypotheses without knowing which one scored best
- Losing track of your best candidate when exploring alternatives

### Verification gate before return()

**NEVER call `return()` unless your solution scores N/N on all training examples** — or you have explicitly accepted the failures you cannot fix.

In the iteration immediately before returning, re-run the full verification loop above on your final implementation. Do not trust an earlier pass — late-iteration refactors, variable renames, and off-by-one fixes can silently break a previously-passing solution.

The sequence is:
1. Run the full verification loop. See `Score: N/N` in the output.
2. If any example fails, fix it. Do NOT return a solution with known training failures unless you are in deadline mode and out of iterations.
3. Only after seeing N/N (or consciously accepting a known gap at the deadline), call `return()`.

This gate is the single strongest predictor of success. Solutions verified against all ground truth before returning succeed at 4x the rate of unverified returns.

### The rule

If you catch yourself writing `train[0].input` without a surrounding `for` loop, stop. You are about to make a single-example mistake.
