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

3. **Watch for training-test divergence.** A rule that works on training data may fail on test if training examples happen not to contain the ambiguous case. Before returning, ask: "Does the test input contain overlaps or orderings not present in training? If so, which variant is more principled?"
