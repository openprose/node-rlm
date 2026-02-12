---
name: await-discipline
kind: driver
version: 0.1.0
description: Enforce proper await usage with rlm() calls to prevent lost results
author: sl
tags: [reliability, delegation, weak-model]
requires: []
---

## Await Discipline

The `rlm()` function is async. Unawaited calls are **silently lost** — the API call fires but the result is discarded.

### CORRECT patterns:

```javascript
// Direct await:
const result = await rlm("query", context);

// Parallel with Promise.all (must await Promise.all itself):
const results = await Promise.all(items.map(i => rlm("process", i)));

// Async helper (must await the helper call too):
async function classify(item) { return await rlm("classify: " + item); }
const answer = await classify(myItem);  // await the helper!
```

### WRONG patterns (results silently lost):

```javascript
// Calling async function without await:
async function classify(item) { return await rlm("classify: " + item); }
classify(myItem);  // WRONG — must be: await classify(myItem)

// IIFE without await:
(async () => { const r = await rlm("q"); console.log(r); })();  // WRONG — add await before (async

// Promise.all without await:
const results = Promise.all(items.map(i => rlm("q", i)));  // WRONG — must be: await Promise.all(...)
```

### Rule: every expression containing `rlm(` needs `await` in the SAME statement. If you wrap rlm() in a helper function, you must ALSO await the helper.
