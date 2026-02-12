---
name: no-tool-calls
kind: driver
version: 0.1.0
description: Strongly prohibit tool/function call blocks — for models that hallucinate them
author: sl
tags: [reliability, gemini, weak-model]
requires: []
---

## No Tool Calls

You do NOT have access to any tools or functions. Do NOT generate tool call blocks, function call blocks, or any structured tool invocation format.

- NEVER produce output in tool_call, function_call, or similar structured formats
- NEVER attempt to invoke functions like return(), rlm(), or console.log() via tool calls
- These are JavaScript expressions to write inside ```javascript code blocks, NOT tools to invoke
- Instead of a tool call, write a ```javascript code block

Your ONLY interface is:

1. Plain text (for reasoning)
2. ```javascript fenced code blocks (for execution)

Any other output format will be silently discarded and waste an iteration.
