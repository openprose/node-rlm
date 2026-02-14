# RLM Trajectory Annotation Summary

**Date:** 2026-02-13
**Benchmark:** ARC (Abstraction and Reasoning Corpus)
**Model:** Claude Opus 4.6
**Total Tasks:** 20
**Annotation Format:** v2 (canonical format from docs/TRAJECTORY_FORMAT.md)

## Completion Status

✅ **All 20 trajectories successfully annotated**

## Files Generated

1. **`eval/trajectory-analysis/sample.json`** - Task metadata for all 20 tasks
2. **`eval/trajectory-analysis/trajectories/*.md`** - 20 annotated trajectory files (4,155 total lines)

## Task Outcomes Distribution

| Outcome | Count | Tasks |
|---------|-------|-------|
| Perfect (score=1.0) | 9 | arc-247ef758, arc-2ba387bc, arc-5961cc34, arc-a251c730, arc-aa4ec2a5, arc-db695cfb, arc-b99e7126, arc-cbebaa4b, arc-8f3a5a89 |
| Timeout | 4 | arc-135a2760, arc-195c6913, arc-4e34c42c, arc-0934a4d8 |
| Wrong Answer | 4 | arc-6e453dd6, arc-7ed72f31, arc-78332cb0, arc-36a08778 |
| Error | 3 | arc-136b0064, arc-446ef5d2, arc-89565ca0 |

**Success Rate:** 45% (9/20 tasks achieved perfect scores)

## Annotation Quality

Each trajectory annotation includes:

### Required Components (v2 format)
- ✅ YAML frontmatter with all required fields
  - taskId, score, iterations, wallTimeMs
  - answerType, taskGroup, answer, expected, error
  - patterns, failureMode, verdict
- ✅ Control Flow with phase:sub-phase labels
- ✅ Hypothesis Log (where applicable)
- ✅ Phase Analysis
- ✅ Root Cause (failures) or Success Factors (perfect scores)
- ✅ What Would Have Helped section

### Optional Computed Fields
- hypothesesTested, hypothesesRejected
- breakthroughIter
- itersOnRejectedHypotheses
- itersExplore, itersExtract, itersVerify, itersWasted
- implementationAttempts

## Key Behavioral Patterns Observed

### Common Success Patterns
- **systematic-analysis** - Thorough exploration before implementation
- **incremental-refinement** - Iterative improvement of solutions
- **verification** - Testing on training data before submission
- **hypothesis-testing** - Systematic testing of multiple approaches

### Common Failure Patterns
- **hypothesis-churn** - Rapidly switching between approaches without depth
- **timeout** - Hitting iteration limit before completing solution
- **delegation-context-loss** - Child agents lacking necessary context
- **no-verification** - Returning answers without validation
- **training-overfitting** - Solutions that work on training but fail on test

## Next Steps

These annotated trajectories are ready for:
1. **Statistical analysis** - Aggregate patterns across tasks
2. **Synthesizer input** - Feed to LLM synthesizer for cross-run insights
3. **Failure mode taxonomy** - Identify common failure patterns
4. **Success factor analysis** - Understand what leads to perfect scores

## Annotation Methodology

All annotations were generated using:
- **Model:** Claude Sonnet 4.5
- **Approach:** Parallel background agents (2 batches of 10)
- **Format:** Canonical v2 format from docs/TRAJECTORY_FORMAT.md
- **Evidence:** All assertions backed by quotes from actual trace data
- **Precision:** No speculation beyond what trace evidence shows
