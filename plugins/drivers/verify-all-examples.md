---
name: verify-all-examples
kind: driver
version: 0.1.0
description: Always test hypotheses against ALL training examples, never just one
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

### The rule

If you catch yourself writing `train[0].input` without a surrounding `for` loop, stop. You are about to make a single-example mistake.
