# RLM Trajectory Analysis Summary

**Run:** arc_anthropic_claude-opus-4-6_2026-02-13T19-50-35-182Z
**Date:** 2026-02-13
**Total Tasks:** 20

## Overview

All 20 ARC task trajectories have been annotated following the v2 trajectory format specification.

## Task Breakdown

**Perfect Scores (10 tasks):**
- arc-247ef758 (11 iterations)
- arc-136b0064 (18 iterations)
- arc-2ba387bc (17 iterations)
- arc-6e453dd6 (10 iterations)
- arc-5961cc34 (10 iterations)
- arc-8f3a5a89 (14 iterations)
- arc-a251c730 (13 iterations)
- arc-aa4ec2a5 (14 iterations)
- arc-db695cfb (12 iterations)
- arc-b99e7126 (18 iterations)

**Failed Tasks (10 tasks):**
- arc-135a2760 (20 iterations - wrong/timeout)
- arc-0934a4d8 (20 iterations - error)
- arc-195c6913 (20 iterations - error)
- arc-36a08778 (20 iterations - error)
- arc-446ef5d2 (20 iterations - error)
- arc-7ed72f31 (18 iterations - wrong/timeout)
- arc-4e34c42c (20 iterations - error)
- arc-78332cb0 (20 iterations - wrong/timeout)
- arc-89565ca0 (20 iterations - wrong/timeout)
- arc-cbebaa4b (20 iterations - wrong/timeout)

## Files Generated

- `sample.json` - Complete list of all tasks with metadata
- `trajectories/*.md` - 20 annotated trajectory files (236K total)
- Each trajectory includes:
  - YAML frontmatter with required and computed fields
  - Task summary
  - Control flow with phase labels, hypothesis links, and outcome markers
  - Hypothesis log (for multi-hypothesis tasks)
  - Phase analysis
  - Root cause analysis (failures) or success factors (perfect scores)
  - What Would Have Helped section

## Annotation Format

All annotations follow the v2 trajectory format specification from `docs/TRAJECTORY_FORMAT.md`:
- Control flow lines use `PHASE:sub-phase [Hx] outcome` format
- Hypothesis logs track tested hypotheses as first-class entities
- Computed frontmatter fields enable cross-run statistical aggregation
- Pattern and failure mode vocabularies applied consistently

## Next Steps

These annotated trajectories can now be:
1. Synthesized into driver improvements
2. Analyzed for common failure modes
3. Used for statistical aggregation across runs
4. Fed into LLM synthesizers for pattern extraction
