# Run 002: Full Driver Stack

## Configuration

| Parameter       | Value                            |
| --------------- | -------------------------------- |
| Model           | `anthropic/claude-sonnet-4.5`    |
| Max Iterations  | 50                               |
| Max Depth       | 1                                |
| Concurrency     | 1                                |
| App             | `arc-solver`                     |
| Drivers         | `one-block-per-iteration`, `deadline-return`, `verify-all-examples`, `hypothesis-budget`, `arc-helper-library` |
| Plugin chars    | 17,049                           |
| Tasks           | 2 (same first 2 as run-001)      |
| Timestamp       | 2026-02-13T03:44:40Z             |
| Total Wall Time | 476s (~8 min)                    |
| Est. Cost       | $2.90                            |

## Results

| Task ID        | Score | Iters | Wall Time | Verdict      | vs Run 001 |
| -------------- | ----- | ----- | --------- | ------------ | ---------- |
| arc-0934a4d8   | 0     | 50    | 368s      | timeout      | Still timeout (25 -> 50 iters) |
| arc-135a2760   | 0     | 13    | 108s      | wrong-answer | Improved: returned answer (was timeout) |

**Aggregate: 0/2 (0%)**

## Comparison with Run 001

### arc-0934a4d8: No improvement
- Run 001: 25 iters, timeout, no return
- Run 002: 50 iters, timeout, no return
- Had 3/4 solution at iter 45 but never submitted
- **Driver compliance: 1/5** (only one-block-per-iteration)
- deadline-return completely ignored — no budget awareness at any iteration

### arc-135a2760: Structural improvement, still wrong
- Run 001: 25 iters, timeout, no return
- Run 002: 13 iters, returned answer (format destroyed by harness bug)
- Found correct rule at iter 3, verified 2/2 on training at iter 11
- **Driver compliance: 2/5** (one-block-per-iteration + partial verify-all-examples)
- Wasted 7 iters reimplementing `findRepeatingTile` (helper library ignored)

## Critical Findings

### 1. Drivers were loaded but ignored
The config confirms 17,049 chars of plugin content was injected. The model received all 5 drivers plus the arc-solver app. Despite this, it showed **zero evidence of following driver protocols:**
- No `SCOREBOARD:` logs
- No `HYPOTHESIS COMPARISON:` logs
- No `Iteration X of N. Remaining:` logs
- No `DEADLINE CANDIDATE:` logs
- No helper library functions copied or used

### 2. Harness serialization bug discovered
`src/rlm.ts:378` uses `String(returnValue)` which flattens 2D arrays:
```javascript
String([[1,2],[3,4]])  // => "1,2,3,4"  (wrong)
JSON.stringify([[1,2],[3,4]])  // => "[[1,2],[3,4]]"  (correct)
```
This means **any correctly-solved ARC task would still score 0** if the model returns a native array. Must fix before next run.

### 3. The driver compliance problem
The model doesn't refuse to follow drivers — it simply doesn't engage with them. Possible causes:
- 17K chars of plugin content may get lost in the system prompt
- Drivers use declarative language ("you must", "always") but the model's own reasoning patterns override
- No in-context examples of driver-compliant behavior
- The arc-solver app prompt may dominate attention over the driver instructions
