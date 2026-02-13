# 001: Sonnet 4.5 Plugin Comparison

A/B comparison of Sonnet 4.5 on OOLONG (trec_coarse, 131K context, 5 tasks) with and without the full plugin stack.

## Runs

| Run | Plugins | Model | Tasks | GitHub Actions |
|-----|---------|-------|-------|----------------|
| No plugins | None | anthropic/claude-sonnet-4.5 | 5 | [Run 21966432010](https://github.com/openprose/node-rlm/actions/runs/21966432010) |
| With plugins | all 5 drivers + structured-data-aggregation | anthropic/claude-sonnet-4.5 | 5 | [Run 21970444280](https://github.com/openprose/node-rlm/actions/runs/21970444280) |

**Eval artifacts:**
- [eval-oolong-18](https://github.com/openprose/node-rlm/actions/runs/21966432010) (no plugins)
- [eval-oolong-19](https://github.com/openprose/node-rlm/actions/runs/21970444280) (with plugins)

**Plugin stack (with-plugins run):**
- Drivers: no-tool-calls, one-block-per-iteration, await-discipline, return-format-discipline, verify-before-return
- App: structured-data-aggregation

## Config

Both runs used identical settings except for plugins:
- `--benchmark oolong`
- `--model anthropic/claude-sonnet-4.5`
- `--max-tasks 5`
- `--max-iterations 15`
- `--max-depth 1`
- `--concurrency 5`

## Results

| Task | No Plugins | With Plugins | Delta |
|------|-----------|-------------|-------|
| oolong-17000208 | 0.0 (timeout, 1 iter) | not in sample | - |
| oolong-17000209 | 1.0 (prior knowledge, 2 iter) | not in sample | - |
| oolong-17000210 | 0.0 (wrong direction, 6 iter) | 0.0 (timeout, 15 iter) | same score, different failure mode |
| oolong-17000211 | 0.0 (format error, 2 iter) | 1.0 (correct, 14 iter) | +1.0 |
| oolong-17000212 | 0.0 (timeout, 15 iter) | 0.0 (timeout, 15 iter) | same |

## Key Findings

1. **Plugins eliminated multi-block hallucination.** No-plugins tasks fabricated execution outputs between code blocks (5/5 tasks). With plugins, the one-block-per-iteration driver prevented this entirely.

2. **Plugins enabled successful delegation.** Task 17000211 went from score 0 (JSON.parse on plaintext, 2 iters) to score 1.0 (LLM classification with iterative prompt refinement, 14 iters). The model discovered that LLMs classify well but count poorly, and switched to an enumeration format.

3. **Plugins did not help with the "pivot to delegation" problem.** Tasks 17000210 and 17000212 still spent all 15 iterations searching for labels that don't exist, never attempting `llm()` classification. The structured-data-aggregation plugin was available but the model never invoked the pattern.

4. **No-plugins hallucination was replaced by plugins exploration paralysis.** Without plugins, the model rushed to wrong answers via hallucinated reasoning (2-6 iters). With plugins, the model was more disciplined but got stuck in exhaustive exploration (15 iters). Different failure mode, same score.

## Files

```
trajectories/
  no-plugins/          # 5 annotated trajectories from Run 18
    oolong-17000208.md
    oolong-17000209.md
    oolong-17000210.md
    oolong-17000211.md
    oolong-17000212.md
  with-plugins/        # 3 annotated trajectories from Run 19
    oolong-17000210.md
    oolong-17000211.md
    oolong-17000212.md
visualization.html     # Interactive visualization (open in browser)
```

## Trajectory Distillation

- No-plugins trajectories were produced by the OpenProse `analyze-trajectories.prose` pipeline (opus annotator + sonnet reviewer + sonnet synthesizer).
- With-plugins trajectories were produced by the simplified inline distillation (haiku selector + sonnet annotators via claude-code-action).

## Date

2026-02-13
