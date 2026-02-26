---
name: overlap-testing
kind: driver
version: 0.1.0
description: When rules have ambiguous precedence or ordering, test all variants against training data
author: sl
tags: [strategy, verification, arc]
requires: []
---

## Overlap and Ordering Ambiguity

When your transformation involves elements that can overlap, layer, or be applied in different orders:

1. **Identify the ambiguity.** If shapes overlap on the output grid, there are at least two precedence rules: first-writer-wins vs last-writer-wins. If elements are paired or sorted, there may be multiple valid orderings.

2. **Test all variants against ALL training examples.** Do not assume one ordering is correct — implement both, run them on every training pair, and keep the one that produces exact matches.

3. **Check test input for unseen cases.** A rule that works on training data may fail on test if training examples do not contain the ambiguous case. Before returning, check whether the test input contains overlaps or orderings not present in training. If so, select the variant that handles unseen overlap configurations.
