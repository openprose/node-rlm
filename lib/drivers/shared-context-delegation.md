---
name: shared-context-delegation
kind: driver
version: 0.1.0
description: Pass data between parent and child agents via persistent sandbox variables, not bloated prompts
author: sl
tags: [strategy, delegation, efficiency, cost-control]
requires: []
---

## Shared Context Delegation

When delegating via `rlm()`, use the shared sandbox to pass data — not giant prompt strings. Every agent runs in the same persistent JavaScript context: a variable you set before calling `rlm()` is readable by the child, and a variable the child sets is readable by you after it returns.

### The rule

**Prompts and return values should be short summaries with pointers to sandbox variables.** Never inline large data in the `rlm()` query, and never expect a child to return a large structured result as its return string.

### Parent → Child: write data, pass a pointer

Before calling `rlm()`, write the full task spec and any large data to a well-named persistent variable. The prompt tells the child where to look.

```javascript
// BAD — bloated prompt, wastes tokens, may hit limits
const result = await rlm(
  `Here are 50 items to process:\n${JSON.stringify(allItems)}\n\n` +
  `For each item, compute X, Y, Z. Here are the detailed rules:\n${longRulesText}\n\n` +
  `Return a JSON array of results.`,
  __ctx.shared.data
);

// GOOD — pointer-based, prompt stays small
__task_analysis = {
  items: allItems,
  rules: parsedRules,
  expectedFormat: { x: "number", y: "string", z: "boolean" },
};
const summary = await rlm(
  `Process all items according to the task spec in __task_analysis. ` +
  `Write structured results to __result_analysis. Return a short summary.`,
  __ctx.shared.data,
  { systemPrompt: "You are a batch processor. Read __task_analysis for your full instructions." }
);
console.log(summary);
const results = __result_analysis; // structured data, no parsing needed
```

### Child → Parent: write results, return a summary

The child stores structured output in a known variable and returns a brief summary. The parent reads the variable — no JSON.parse on a giant string.

```javascript
// Inside the child's code:
const task = __task_analysis;
const results = task.items.map(item => {
  // ... compute per the rules in task.rules ...
  return { id: item.id, x: computedX, y: computedY, z: computedZ };
});
__result_analysis = { items: results, stats: { total: results.length, passed: passCount } };
console.log(`Processed ${results.length} items, ${passCount} passed.`);
return(`Processed ${results.length} items. ${passCount} passed. Full results in __result_analysis.`);
```

### Read-only root data

`__ctx.shared.data` is frozen and available at every depth. Children can always access the original task data — never re-serialize it into prompts.

```javascript
// BAD — re-sending root data the child already has
const r = await rlm(`Analyze this: ${JSON.stringify(JSON.parse(__ctx.shared.data))}`, ...);

// GOOD — child reads __ctx.shared.data directly
const r = await rlm(
  `Analyze the root task data (available in __ctx.shared.data). ` +
  `Focus on the "metadata" field. Write findings to __result_meta.`
);
```

### Naming convention

Use double-underscore prefixed names with the child's role to avoid collisions:

- `__task_{role}` — parent writes before `rlm()`, child reads
- `__result_{role}` — child writes before returning, parent reads after
- For parallel children, include an index: `__task_verify_0`, `__task_verify_1`

### When this matters most

- **Large datasets** — items, grids, tables. Write once, read by pointer.
- **Structured results** — child produces objects/arrays. Parent reads the variable directly instead of parsing a return string.
- **Multi-step pipelines** — child A writes `__result_a`, child B reads it. The parent orchestrates without shuttling data through prompts.

### When it does NOT apply

- If the prompt and expected return are both short (a sentence each), inline is fine.
