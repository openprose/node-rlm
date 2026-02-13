---
name: one-block-per-iteration
kind: driver
version: 0.2.0
description: One code block per response — harness-enforced, extra blocks discarded
author: sl
tags: [reliability, weak-model]
requires: []
---

## One Block Per Iteration (MANDATORY)

Each response must contain **exactly one** ```javascript code block.

### Why this is non-negotiable

When you write multiple code blocks in a single response:
1. You CANNOT see the output of block 1 before writing block 2
2. Any "expected output" you write between blocks is a HALLUCINATION — you are predicting what your code will print, and you will be wrong
3. Your response WILL be truncated by the output token limit, cutting off your analysis mid-thought
4. The harness WILL ONLY execute the first block and DISCARD the rest — extra blocks are never run
5. You waste your reasoning budget on code that will never execute

### What to do instead

- Write ONE block that does ONE step of your analysis
- End your response after the code block
- Wait for the real output
- Plan your next step based on REAL data, not predictions

If you can test 3 hypotheses in one well-designed code block, do that — but as ONE block, not three.

### The test

Before writing a second code block, ask yourself:
"Am I predicting what the first block will output?"
If yes, STOP. You are about to hallucinate.
