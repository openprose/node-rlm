---
name: recursive-delegation-strategy
kind: app
version: 0.1.0
description: Depth-aware delegation strategy for classification and aggregation tasks
author: sl
tags: [delegation, aggregation, strategy]
requires: []
---

## Recursive Delegation Strategy

### Overview

You are the root orchestrator. You split work, delegate to children, and aggregate results. When delegating, instruct children to solve their subtasks directly — they should NOT re-delegate via `rlm()`. Children MAY use `llm()` for simple sub-questions (e.g., classify a single ambiguous item).

### When to delegate

**Delegate** when:
- Subjective classification of >20 items (sentiment, topic, category)
- The classification requires understanding meaning, not pattern matching
- Keyword/regex would be unreliable

**Do it yourself** when:
- Labels already exist in the data
- Task is structural (filter, count, extract)
- Fewer than 15 items to classify

### Fan-out structure

**Option A: REPL children via `rlm()` (when `__rlm.maxDepth >= 2`)**

Children have `__ctx.shared.data` access. Pass index ranges, NOT data:

```javascript
const lines = __ctx.shared.data.split('\n');
const chunkSize = 25;
const chunks = [];
for (let i = 0; i < lines.length; i += chunkSize) {
  chunks.push({ start: i, end: Math.min(i + chunkSize, lines.length) });
}
const results = await Promise.all(chunks.map(chunk =>
  rlm(
    `Classify lines ${chunk.start}-${chunk.end - 1} from __ctx.shared.data into categories: [LIST]. ` +
    `Read via __ctx.shared.data.split('\\n').slice(${chunk.start}, ${chunk.end}). ` +
    `Return ONLY a JSON array: [{"idx": 0, "label": "cat"}, ...]`
  )
));
```

**Option B: Flat children via `rlm()` (when `__rlm.maxDepth === 1`)**

Children are one-shot with no sandbox. Pass data as context, keep chunks to 10-15:

```javascript
const items = context.split('\n').filter(l => l.trim());
const chunkSize = 12;
const chunks = [];
for (let i = 0; i < items.length; i += chunkSize) {
  chunks.push(items.slice(i, i + chunkSize).join('\n'));
}
const results = await Promise.all(chunks.map((chunk, idx) =>
  rlm(
    `Classify each item into exactly one of: [LIST]. ` +
    `Return ONLY a JSON array: [{"idx": N, "label": "cat"}, ...]. Indices start at ${idx * chunkSize}.`,
    chunk
  )
));
```

**Option C: `llm()` for individual classification**

For per-item classification where each item is independent:

```javascript
const items = context.split('\n').filter(l => l.trim());
const labels = await Promise.all(items.map((item, i) =>
  llm(`Classify into exactly one of [A, B, C, D]. Reply with ONLY the category label.`, item)
));
console.log("Labels:", JSON.stringify(labels));
```

`llm()` costs 1 API call per item (vs 3-7 for `rlm()`). Use it when each item can be classified without multi-step reasoning.

### Aggregation and failure handling

```javascript
const allLabels = [];
const failed = [];
for (let i = 0; i < results.length; i++) {
  try {
    const parsed = JSON.parse(results[i]);
    allLabels.push(...parsed.map(r => r.label));
  } catch (e) {
    console.log("Chunk", i, "failed:", results[i].slice(0, 100));
    failed.push(i);
  }
}
console.log("Classified:", allLabels.length, "Failed chunks:", failed.length);
```

**If children return garbage:** Classify the failed items yourself in the next iteration. Do NOT re-delegate the entire batch.

```javascript
// Re-classify failed chunk items yourself using llm()
for (const chunkIdx of failed) {
  const start = chunkIdx * chunkSize;
  const end = Math.min(start + chunkSize, items.length);
  for (let i = start; i < end; i++) {
    const label = await llm("Classify into one of [LIST]. Reply with ONLY the label.", items[i]);
    allLabels.splice(i, 0, label.trim());
  }
}
```

### What NOT to do

- **Do not use keyword regex for subjective classification** — "starts with Who" misses edge cases
- **Do not send all items in one call** — one child with 300+ items produces unreliable results
- **Do not re-run from scratch on failure** — fix only the failed items
- **Do not re-send the full dataset as context** when children have `__ctx.shared.data`
- **Do not chunk below 8 items** — the delegation overhead is not worth it
- **Instruct children not to re-delegate** — tell them to solve subtasks directly
