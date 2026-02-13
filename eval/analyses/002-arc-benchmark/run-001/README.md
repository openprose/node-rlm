# Run 001: Baseline (No Drivers)

## Configuration

| Parameter       | Value                            |
| --------------- | -------------------------------- |
| Model           | `anthropic/claude-sonnet-4.5`    |
| Max Iterations  | 25                               |
| Max Depth       | 2                                |
| Concurrency     | 5                                |
| Plugins         | **None**                         |
| Tasks           | 5 (first 5 ARC-AGI-2 evaluation) |
| Timestamp       | 2026-02-13T02:56:12Z             |
| Total Wall Time | ~1,192s (~20 min)                |
| Est. Cost       | ~$6.50                           |

## Results

| Task ID        | Score | Iters | Wall Time | Verdict      |
| -------------- | ----- | ----- | --------- | ------------ |
| arc-142ca369   | 0     | 3     | 70s       | wrong-answer |
| arc-0934a4d8   | 0     | 25    | 159s      | timeout      |
| arc-135a2760   | 0     | 25    | 224s      | timeout      |
| arc-136b0064   | 0     | 25    | 252s      | timeout      |
| arc-13e47133   | 0     | 25    | 487s      | timeout      |

**Aggregate: 0/5 (0%)**

## Key Findings

1. **The return() problem:** 4/5 tasks timed out without calling return(). The model treats return() as a declaration of correctness, not a deadline submission.
2. **Correct rule, wrong implementation:** 3/5 tasks identified the correct transformation rule but couldn't implement it algorithmically.
3. **No plugins loaded:** This run had zero driver or app plugins — the model was operating with no strategic guidance.
