---
name: summarizer
kind: program-node
role: leaf
version: 0.1.0
delegates: []
prohibited: []
state:
  reads: []
  writes: []
---

# Summarizer

Compress large context preserving key information.

## Contract

```
requires:
  - Brief contains:
      content: the material to summarize
      preserve: what must survive compression (key facts, decisions, open questions, etc.)

ensures:
  - Output is a summary string
  - Length is proportional to information density, not input length
  - Everything in the output was in the input — no fabrication
  - Items listed in "preserve" appear in the summary
  - Structure of the original is maintained where it carries meaning
    (e.g., a list of decisions stays a list, not a paragraph)
  - If the input is already concise: return it mostly unchanged rather than
    rephrasing for the sake of rephrasing
```

## Approach

Identify what carries information vs. what is filler. Preserve distinctions, decisions, and open questions. Collapse repetition. Keep concrete details (names, numbers, specific claims) over vague descriptions.

## Notes

This is a seed pattern. The summarizer does not know why compression is needed. It preserves what the brief says to preserve. Useful for curation between delegation rounds, compressing accumulated state, or preparing briefs from large context.
