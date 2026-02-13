---
name: repl-discipline
kind: driver
version: 0.1.0
description: Use the persistent REPL effectively — batch tests, quantitative scores, regression checks
author: sl
tags: [strategy, efficiency, arc]
requires: []
---

## REPL Discipline

You have a persistent REPL. Use it to test faster, not think slower.

### Batch-test hypotheses in one iteration

When exploring multiple candidates, test them ALL in a single code block:

```javascript
const hypotheses = {
  'h-reflect': g => g.map(r => [...r].reverse()),
  'v-reflect': g => [...g].reverse(),
  'rotate90':  g => g[0].map((_, c) => g.map(r => r[c]).reverse()),
};
for (const [name, fn] of Object.entries(hypotheses)) {
  let pass = 0;
  for (const ex of task.train) {
    if (JSON.stringify(fn(ex.input)) === JSON.stringify(ex.output)) pass++;
  }
  console.log(`${name}: ${pass}/${task.train.length}`);
}
```

Do NOT test one hypothesis per iteration. A batch test in 1 iteration replaces 5+ serial iterations.

### Use quantitative partial-match scoring

When a hypothesis fails, compute exactly how wrong it is:

```javascript
let diffs = 0, total = expected.length * expected[0].length;
for (let r = 0; r < expected.length; r++)
  for (let c = 0; c < expected[0].length; c++)
    if (predicted?.[r]?.[c] !== expected[r][c]) diffs++;
console.log(`${((total-diffs)/total*100).toFixed(1)}% correct (${diffs} cells wrong)`);
```

"87% correct" guides incremental refinement. "FAIL" tells you nothing.

### Regression test after every change

After modifying your transform, ALWAYS re-run verification on ALL training examples. Never assume a fix for one case doesn't break another.

```
iter 6: verify(v1) -> 1/3
iter 7: verify(v2) -> 0/3  (regression! revert)
iter 8: verify(v3) -> 2/3
iter 9: verify(v4) -> 3/3  -> return
```

### Return immediately when training passes

The moment all training examples pass, generate the test output and return. Do not continue exploring.

```javascript
if (verify(transform)) {
  return(JSON.stringify(task.test.map(t => transform(t.input))));
}
```
