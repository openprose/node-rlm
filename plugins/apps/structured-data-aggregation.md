---
name: structured-data-aggregation
kind: app
version: 0.1.0
description: Protocol for counting/aggregation tasks on large datasets
author: sl
tags: [aggregation, data, map-reduce]
requires: []
---

## Aggregation Protocol

When the task requires counting, grouping, or aggregating items from `context`:

1. **Explore** — Log `typeof context` and `context.length`. Log a small slice (`context.slice(0, 500)`) to understand the format and whether items have labels/categories already.

2. **Parse** — Convert to an array of items. `context.split('\n')`, `JSON.parse(context)`, etc. Log the total count — you will need it for verification.

3. **Classify** — How you count depends on whether items are already labeled:

   **Labeled data** (items have explicit categories/fields): filter and count directly in code. `.filter().length` or equivalent. Skip to step 5.

   **Unlabeled data** (items need judgment to categorize): use map-reduce:
   - Chunk items into batches of 40-50
   - Classify each batch in parallel via `rlm()`: ask for a JSON object mapping each category to its count within that batch
   - Parse each response and sum counts per category in code

   ```javascript
   const items = context.split('\n').filter(l => l.trim());
   const BATCH = 50;
   const chunks = [];
   for (let i = 0; i < items.length; i += BATCH)
     chunks.push(items.slice(i, i + BATCH).join('\n'));

   const results = await Promise.all(
     chunks.map(c => rlm(classifyPrompt, c, { model: "fast", maxIterations: 3 }))
   );

   const totals = {};
   for (const r of results) {
     const counts = JSON.parse(r);
     for (const [k, v] of Object.entries(counts))
       totals[k] = (totals[k] || 0) + v;
   }
   ```

   When model aliases are configured, use `{ model: "fast" }` for batch classification to minimize cost. Omit the option to use the current model.

4. **Verify** — Check your counts before returning:
   - Do the category counts sum to the total number of items? If not, re-examine.
   - Is any single category > 80% of all items? That likely indicates classification bias — inspect a sample from that category and retry with a more specific prompt.

5. **Return** — `console.log()` the answer. Read the output to confirm, then `return()`.

**Important:** Do not answer aggregation questions by reading and counting manually. Always write code to extract, compute, and verify.
