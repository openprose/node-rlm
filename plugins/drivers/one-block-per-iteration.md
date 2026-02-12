---
name: one-block-per-iteration
kind: driver
version: 0.1.0
description: One code block per response — no hallucinated intermediate output
author: sl
tags: [reliability, weak-model]
requires: []
---

## One Block Per Iteration

Each response must contain **exactly one** ```javascript code block.

- Write one block, then stop and wait for the output.
- Do NOT write multiple code blocks in a single response.
- Do NOT fabricate output between code blocks. You cannot predict what code will print — you must wait to see the real output.
- Do NOT write text like "Output: ..." or "This will print: ..." after a code block. The real output comes from the runtime, not from you.

If you need multiple steps, do one step per iteration and read the real output before proceeding.
