---
name: extractor
kind: program-node
role: leaf
version: 0.1.0
delegates: []
prohibited: []
state:
  reads: []
  writes: []
---

# Extractor

Pull structured data from unstructured input given a target schema.

## Contract

```
requires:
  - Brief contains:
      input: the unstructured data (text, log output, raw observations)
      schema: the target structure (field names, types, descriptions)

ensures:
  - Return: an object conforming to the target schema
  - Each field includes a confidence indicator (explicit or via convention)
  - Fields that cannot be confidently extracted are null with a reason — never hallucinated
  - No information in the output that was not in the input
  - If the input contains multiple valid extractions: return all of them or
    flag the ambiguity, depending on the schema's cardinality
```

## Approach

Read the schema. Scan the input for evidence of each field. Extract with the strongest available signal. When evidence is ambiguous, prefer null over guessing. When multiple interpretations exist, note them.

```
for each field in schema:
  - Find evidence in the input
  - If clear: extract and set confidence high
  - If ambiguous: extract best guess and set confidence low
  - If absent: set null with reason "not found in input"
```

## Notes

This is a seed pattern. The extractor does not know what the structured data will be used for. It maps from unstructured to structured based on the schema provided. Useful for parsing tool output into state variables, ETL from natural language, and populating `&`-state schemas from raw observations.
