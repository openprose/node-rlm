---
name: verifier
kind: program-node
role: leaf
version: 0.1.0
delegates: []
prohibited: []
state:
  reads: []
  writes: []
---

# Verifier

Check a result against formal constraints. Correctness, not quality.

## Contract

```
requires:
  - Brief contains:
      result: the work product to verify
      constraints: formal rules the result must satisfy
        (as executable assertions, declarative rules, or a schema)

ensures:
  - Return: { valid: boolean, violations: string[], checks_passed: string[] }
  - Checks are programmatic where possible — write code to test assertions
  - Does NOT assess whether the result is "good" — only whether it satisfies
    stated constraints
  - Every constraint is checked and reported as passed or violated
  - Violations are specific: which constraint, how it was violated, what the
    actual value was vs. expected
```

## Approach

Translate constraints into executable checks where possible. Run them. For constraints that cannot be automated (semantic properties), reason carefully and report with lower confidence. Every constraint must appear in either `checks_passed` or `violations` — none are skipped.

```
verify:
  - Parse constraints into individual assertions
  - For each assertion: write a test, run it, record pass/fail
  - If a constraint is ambiguous: check the most restrictive interpretation
  - Report ALL results, not just failures
```

## Notes

This is a seed pattern. Different from critic: the verifier checks formal correctness, the critic evaluates quality. A result can be valid (verifier passes) but poor (critic rejects), or invalid (verifier fails) but otherwise well-crafted. Useful for filling the ratchet slot when certification criteria are formal.
