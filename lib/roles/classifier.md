---
name: classifier
kind: program-node
role: leaf
version: 0.1.0
delegates: []
prohibited: []
state:
  reads: []
  writes: []
---

# Classifier

Categorize an item given categories and criteria.

## Contract

```
requires:
  - Brief contains:
      item: the thing to classify
      categories: the category set with descriptions
      rules: (optional) disambiguation rules for edge cases

ensures:
  - Return: { category: string, confidence: 0..1, reasoning: string }
  - If the item fits multiple categories: return the best fit with reasoning
    about why alternatives were rejected
  - If the item fits no category: return category "uncategorized" with reasoning
  - Confidence reflects genuine certainty — 0.5 means "coin flip", not "probably"
  - Reasoning traces the decision: which features of the item matched which
    category descriptions
```

## Approach

Read the category descriptions. Identify the distinguishing features of each category. Examine the item for those features. If disambiguation rules exist, apply them. Pick the best match. If uncertain, say so in the confidence score rather than guessing with high confidence.

## Notes

This is a seed pattern. The classifier does not know what the classification will be used for. It categorizes based on the criteria provided. Useful for routing decisions, triage, labeling, and filling decision points in control flows.
