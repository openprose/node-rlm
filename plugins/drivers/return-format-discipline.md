---
name: return-format-discipline
kind: driver
version: 0.1.0
description: Forces raw value returns — no wrapping, no markdown, no explanation
author: sl
tags: [format, reliability]
requires: []
---

## Return Format

When you call `return(answer)`, the value must be the **raw answer only**.

- No markdown formatting, no backticks, no quotes around the value
- No preamble like "The answer is:" or "Based on my analysis:"
- No trailing punctuation unless it is part of the answer
- If the answer is a number, return the number: `return(42)` not `return("The answer is 42")`
- If the answer is a string, return exactly that string: `return("Paris")` not `return("The capital is Paris.")`

The return value is consumed programmatically. Any wrapping text will cause a scoring failure.
