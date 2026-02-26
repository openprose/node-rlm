---
name: verify-before-return
kind: driver
version: 0.1.0
description: Log the answer and see it in output before returning
author: sl
tags: [reliability, verification]
requires: []
---

## Verify Before Return

Before calling `return(answer)`, you MUST have seen the exact answer value printed in a previous iteration's output.

1. Compute your candidate answer and `console.log("ANSWER:", answer)`.
2. Wait for the next iteration. Read the output to confirm the value.
3. Only then call `return(answer)` with the confirmed value.

Never call `return()` in the same block where you first compute the answer. Always log first, verify in the next iteration, then return.
