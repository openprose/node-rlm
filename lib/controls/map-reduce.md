---
name: map-reduce
kind: program-node
role: coordinator
version: 0.1.0
slots: [mapper, reducer]
delegates: []
prohibited: []
state:
  reads: [&controlState]
  writes: [&controlState]
---

# Map-Reduce

Split input, delegate chunks to mappers, merge results with a reducer.

## Shape

```
shape:
  self: [partition input into chunks, fan out to mappers, collect results, delegate to reducer]
  delegates:
    mapper: [process one chunk of the input]
    reducer: [merge all mapper outputs into a single result]
  prohibited: none
```

## Contract

```
requires:
  - &controlState exists at __controlState with:
      mapper: string         -- component name for each mapper
      reducer: string        -- component name for the reducer
      task_brief: string     -- overall task description
      chunks: any[]          -- the pre-partitioned input chunks

ensures:
  - Each mapper receives one chunk and the overall task brief as context
  - Mapper does not know other mappers exist or what chunks they received
  - Reducer receives ALL mapper outputs and the overall task brief
  - Reducer reasons about how to merge — handles conflicts and overlaps
  - &controlState.result contains the merged output
  - &controlState.mapper_results contains individual mapper outputs
```

## Delegation

```javascript
const { mapper, reducer, task_brief, chunks } = __controlState;

// Map phase — one delegation per chunk
const mapperResults = [];
for (let i = 0; i < chunks.length; i++) {
  const mapBrief = `${task_brief}\n\nProcess this chunk (${i + 1} of ${chunks.length}):\n${typeof chunks[i] === 'string' ? chunks[i] : JSON.stringify(chunks[i])}`;
  const result = await rlm(mapBrief, null, { use: mapper });
  mapperResults.push(result);
}

// Reduce phase
const reduceBrief = `Merge these ${mapperResults.length} results into a single coherent output. Handle conflicts and overlaps.\n\nOverall task: ${task_brief}\n\nResults to merge:\n${mapperResults.map((r, i) => `--- Chunk ${i + 1} ---\n${r}`).join("\n\n")}`;
const merged = await rlm(reduceBrief, null, { use: reducer });

__controlState.result = merged;
__controlState.mapper_results = mapperResults;
return(merged);
```

## Notes

This is a seed pattern. The parent is responsible for partitioning the input into chunks before delegating to map-reduce. Mappers do not know other mappers exist. The reducer does not know it is part of a map-reduce pipeline. If true parallelism is needed, the map phase can use `Promise.all` — the sandbox supports it.
