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

// The coordinator diffs the reports itself — structural work, not a slot.
// Compare findings, classify agreements and discrepancies.
const reportAStr = String(reportA);
const reportBStr = String(reportB);

// Use the coordinator's own reasoning to produce the structured diff.
// Parse both reports, identify overlapping and divergent findings.
const agreed = [];
const discrepancies = [];

// Split reports into findings (heuristic: line-by-line or paragraph-by-paragraph)
const findingsA = reportAStr.split(/\n+/).filter(l => l.trim());
const findingsB = reportBStr.split(/\n+/).filter(l => l.trim());

for (const f of findingsA) {
  const match = findingsB.some(fb => fb.includes(f.trim()) || f.includes(fb.trim()));
  if (match) {
    agreed.push(f.trim());
  } else {
    discrepancies.push({ source: "a_only", finding: f.trim() });
  }
}
for (const f of findingsB) {
  const alreadyAgreed = agreed.some(a => f.includes(a) || a.includes(f.trim()));
  if (!alreadyAgreed) {
    discrepancies.push({ source: "b_only", finding: f.trim() });
  }
}

const total = agreed.length + discrepancies.length;
const confidence = total > 0 ? agreed.length / total : 0;

const result = { agreed, discrepancies, confidence };
__compositeState.result = result;
return(result);
```

## Notes

This is a seed pattern. Neither witness knows the other exists. Agreements between independent observers are high-confidence findings. Discrepancies are signal about data ambiguity — not errors in individual observers. The parent should reason about discrepancies rather than averaging them away.
