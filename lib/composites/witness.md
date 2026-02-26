---
name: witness
kind: program-node
role: coordinator
version: 0.1.0
slots: [witness_a, witness_b]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Witness

Two agents independently observe the same data. Discrepancies flag ambiguity.

## Shape

```
shape:
  self: [delegate to both witnesses, diff their reports, classify agreements and discrepancies]
  delegates:
    witness_a: [observe and report on the data]
    witness_b: [observe and report on the data — independently]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      witness_a: string     -- component name for first witness
      witness_b: string     -- component name for second witness
      task_brief: string    -- the data to observe and what to report on

ensures:
  - Both witnesses receive IDENTICAL briefs
  - Neither witness knows another witness exists
  - After both return, diff their reports:
      agreed: findings present in both reports
      discrepancies: findings that differ or appear in only one
      confidence: proportion of agreement
  - Returns { agreed, discrepancies, confidence }
  - &compositeState.result contains the diff
  - &compositeState.reports contains both raw reports
```

## Delegation

```javascript
const { witness_a, witness_b, task_brief } = __compositeState;

// Both witnesses get the same brief
const reportA = await rlm(task_brief, null, { use: witness_a });
const reportB = await rlm(task_brief, null, { use: witness_b });

__compositeState.reports = { a: reportA, b: reportB };

// Diff the reports — use the model's own reasoning to classify
const diffBrief = `Compare these two independent observation reports of the same data.\n\nIdentify:\n1. Findings both reports agree on\n2. Discrepancies — findings that differ or appear in only one report\n3. Overall confidence (proportion of agreement)\n\nReport A:\n${reportA}\n\nReport B:\n${reportB}`;

// The coordinator itself performs the diff — this is structural work, not a slot
const diffAnalysis = `Agreements are high-confidence. Discrepancies flag genuinely ambiguous or hard-to-interpret data.`;

__compositeState.result = { report_a: reportA, report_b: reportB };
return({ report_a: reportA, report_b: reportB });
```

## Notes

This is a seed pattern. Neither witness knows the other exists. Agreements between independent observers are high-confidence findings. Discrepancies are signal about data ambiguity — not errors in individual observers. The parent should reason about discrepancies rather than averaging them away.
