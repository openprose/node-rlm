# Triggering Evals via GitHub Actions

How to kick off eval runs remotely using the `gh` CLI.

For local runs, CLI options, plugin system, and result analysis, see [eval/README.md](../eval/README.md).
For dataset management, see [docs/EVAL_DATA.md](EVAL_DATA.md).
For past run analyses, see [eval/analyses/README.md](../eval/analyses/README.md).

## Best known configuration (65% — run-026)

```bash
gh workflow run eval.yml \
  -f benchmark=arc \
  -f model="anthropic/claude-opus-4-6" \
  -f max-iterations=20 \
  -f max-depth=2 \
  -f max-tasks=20 \
  -f concurrency=5 \
  -f max-blocks-per-iteration=1 \
  -f analyze=true \
  -f drivers="one-block-per-iteration,deadline-return,verify-all-examples,verify-before-return,hypothesis-budget,exploration-budget,arc-helper-library,overlap-testing,json-stringify-return" \
  -f selected-problems="0934a4d8,135a2760,136b0064,195c6913,247ef758,2ba387bc,36a08778,446ef5d2,4e34c42c,5961cc34,6e453dd6,78332cb0,7ed72f31,89565ca0,8f3a5a89,a251c730,aa4ec2a5,b99e7126,cbebaa4b,db695cfb"
```

| Parameter | Value |
|---|---|
| Drivers (9) | one-block-per-iteration, deadline-return, verify-all-examples, verify-before-return, hypothesis-budget, exploration-budget, arc-helper-library, overlap-testing, json-stringify-return |
| Model | claude-opus-4-6 |
| Iterations | 20 |
| Max depth | 2 |
| Concurrency | 5 |
| Blocks/iteration | 1 |
| Score | **13/20 (65%)** |
| Commit | `e40547e` |
| Run ID | `21996621690` |

## Basic syntax

```bash
gh workflow run eval.yml -f benchmark=<bench> -f model=<model> [flags...]
```

## Workflow inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `benchmark` | yes | — | `oolong`, `s-niah`, or `arc` |
| `model` | yes | `qwen/qwen3-coder` | Provider/model ID for OpenRouter |
| `max-tasks` | no | all | Limit number of tasks |
| `max-iterations` | no | `15` | Max REPL iterations per task |
| `max-depth` | no | `1` | Max recursion depth |
| `concurrency` | no | `5` | Parallel tasks |
| `drivers` | no | — | Comma-separated driver plugin names |
| `app` | no | — | App plugin name |
| `selected-problems` | no | all | ARC: comma-separated problem IDs |
| `max-blocks-per-iteration` | no | — | Use `1` for single-block enforcement |
| `attempts` | no | `1` | Attempts per task for pass@N (e.g., `2` for pass@2) |
| `analyze` | no | `true` | Run trajectory distillation after eval |

## ARC task IDs

ARC problem IDs are **raw hex** (e.g. `0934a4d8`), not prefixed. The analysis artifacts use `arc-` prefixed filenames (e.g. `arc-0934a4d8.json`), but the eval harness and `--selected-problems` flag expect the raw ID.

## Examples

### ARC with composable drivers (no app)

```bash
gh workflow run eval.yml \
  -f benchmark=arc \
  -f model="anthropic/claude-opus-4-6" \
  -f max-iterations=20 \
  -f max-depth=2 \
  -f max-tasks=20 \
  -f concurrency=5 \
  -f max-blocks-per-iteration=1 \
  -f analyze=true \
  -f drivers="one-block-per-iteration,deadline-return,verify-all-examples,verify-before-return,hypothesis-budget,exploration-budget,arc-helper-library,overlap-testing,json-stringify-return" \
  -f selected-problems="0934a4d8,135a2760,136b0064,195c6913,247ef758,2ba387bc,36a08778,446ef5d2,4e34c42c,5961cc34,6e453dd6,78332cb0,7ed72f31,89565ca0,8f3a5a89,a251c730,aa4ec2a5,b99e7126,cbebaa4b,db695cfb"
```

### ARC baseline (no drivers, no app)

```bash
gh workflow run eval.yml \
  -f benchmark=arc \
  -f model="anthropic/claude-opus-4-6" \
  -f max-iterations=20 \
  -f max-depth=2 \
  -f max-tasks=20 \
  -f concurrency=5 \
  -f max-blocks-per-iteration=1 \
  -f analyze=true \
  -f selected-problems="0934a4d8,135a2760,136b0064,195c6913,247ef758,2ba387bc,36a08778,446ef5d2,4e34c42c,5961cc34,6e453dd6,78332cb0,7ed72f31,89565ca0,8f3a5a89,a251c730,aa4ec2a5,b99e7126,cbebaa4b,db695cfb"
```

### OOLONG with Gemini Flash

```bash
gh workflow run eval.yml \
  -f benchmark=oolong \
  -f model="google/gemini-2.5-flash" \
  -f max-iterations=15 \
  -f concurrency=5
```

## Monitoring runs

```bash
# List recent runs
gh run list --workflow=eval.yml --limit=5

# Check a specific run
gh run view <run-id> --json status,conclusion,jobs

# Stream logs
gh run watch <run-id>

# View logs after completion
gh run view <run-id> --log
```

## Downloading artifacts

```bash
gh run download <run-id> -n eval-arc-<run-number>
gh run download <run-id> -n trajectory-analysis-arc-<run-number>
```
