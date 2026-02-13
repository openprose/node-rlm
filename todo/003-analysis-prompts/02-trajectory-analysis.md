# Cross-Run Trajectory Analysis (Qualitative-Quantitative)

**Agent**: Opus 4.6
**Output files**:
- `eval/analyses/003-opus-arc-feb13/trajectory-classification.yml`
- `eval/analyses/003-opus-arc-feb13/trajectory-analysis-findings.md`

---

You are performing a comprehensive qualitative-quantitative trajectory analysis across ~40 ARC-AGI-2 task attempts.

## Context

Project at /home/user/node-rlm. Two matched-pair eval runs in:
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-022/` - 20 ARC tasks, Opus 4.6, WITH arc-solver.md plugin, 45% score (9/20), mean 15.75 iters, $13.38 cost
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-023/` - 20 ARC tasks, Opus 4.6, WITHOUT arc-solver.md plugin, 50% score (10/20), mean 14.05 iters, $10.98 cost

Each run has `trajectories/` (annotated .md files with YAML frontmatter containing taskId, score, iterations, wallTimeMs, answerType, taskGroup, answer, expected, error, patterns, failureMode, verdict), `results/` (JSON), `analysis.txt`.

The same 20 ARC task IDs are used in both runs (matched-pair design). Task IDs: arc-0934a4d8, arc-135a2760, arc-136b0064, arc-195c6913, arc-247ef758, arc-2ba387bc, arc-36a08778, arc-446ef5d2, arc-4e34c42c, arc-5961cc34, arc-6e453dd6, arc-78332cb0, arc-7ed72f31, arc-89565ca0, arc-8f3a5a89, arc-a251c730, arc-aa4ec2a5, arc-b99e7126, arc-cbebaa4b, arc-db695cfb

Related context:
- Trajectory format spec: `/home/user/node-rlm/docs/TRAJECTORY_FORMAT.md`
- ARC solver plugin: `/home/user/node-rlm/plugins/apps/arc-solver.md`
- System prompt: `/home/user/node-rlm/src/system-prompt.ts`
- Previous Opus analysis: `/home/user/node-rlm/eval/analyses/002-arc-benchmark/opus-trajectory-analysis.md`
- Driver plugins: `/home/user/node-rlm/plugins/drivers/` (various .md files)

## Phase 1: Read ALL trajectories, develop classification taxonomy

Read all trajectory files across both runs. As you read, develop a taxonomy of interesting features/labels to classify. These should emerge organically from the data — don't force predefined categories. Consider things like:
- Solving approach/strategy used (brute force, pattern matching, transformation discovery, etc.)
- Whether the model used helper functions from arc-solver.md (run-022 only)
- Iteration efficiency patterns (solved early, solved late, ran out of time)
- Error recovery patterns (recovered from mistakes vs. cascading failures)
- Quality of hypothesis formation and testing
- Whether the model understood the task correctly
- Delegation/recursion usage
- Code quality and debugging approach

Save the full classification as a YAML file at:
`/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/trajectory-classification.yml`

The YAML should have each task attempt as an entry (keyed by run+taskId) with all your classification labels applied.

## Phase 2: Statistical analysis

Analyze correlations and patterns:
- Which features correlate with success (score=1) vs failure (score=0)?
- Which features differ between run-022 (with arc-solver) vs run-023 (without)?
- Per-task matched-pair comparison: for each of the 20 tasks, compare the two attempts
- Which tasks were solved in both runs, only one run, or neither?
- What predicts iteration efficiency?
- Are there clusters of similar strategies or failure modes?

## Phase 3: Write findings

Write to: `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/trajectory-analysis-findings.md`

This should include:
1. **Classification taxonomy** — the labels you chose and why
2. **Key statistical findings** — with actual numbers and percentages
3. **Matched-pair analysis** — per-task comparison between runs
4. **What patterns work** — which strategies/behaviors correlate with success
5. **Circumstantial factors** — when does arc-solver help vs. hurt?
6. **Recommendations** for:
   - Updates to arc-solver.md plugin
   - Changes to the system prompt
   - Improvements to the RLM harness itself
   - Changes to driver plugins

Be rigorous and evidence-based. Reference specific task IDs and quote specific behaviors from the trajectories.
