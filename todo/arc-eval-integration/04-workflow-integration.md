# ARC GitHub Actions Workflow Integration Plan

How to add ARC-AGI-2 to the existing `eval.yml` workflow.

## Current Workflow Structure

The existing `eval.yml` has:
1. A `workflow_dispatch` trigger with inputs for benchmark, model, and various options
2. An `eval` job that:
   - Caches OOLONG data (conditional on `inputs.benchmark == 'oolong'`)
   - Downloads data if cache misses
   - Runs the eval
   - Analyzes results
   - Uploads artifacts
3. An `analyze` job that runs trajectory analysis with Claude

## Changes to `eval.yml`

### 1. Add `arc` to Benchmark Choices

```yaml
on:
  workflow_dispatch:
    inputs:
      benchmark:
        description: Benchmark to run
        required: true
        type: choice
        options:
          - oolong
          - s-niah
          - arc          # <-- Add this
```

### 2. Add ARC-Specific Inputs (Optional)

```yaml
      selected-problems:
        description: "ARC: Comma-separated problem IDs (default: all)"
        required: false
```

### 3. Add ARC Data Caching Step

Add these steps alongside the existing OOLONG caching:

```yaml
      - name: Cache ARC eval data
        if: inputs.benchmark == 'arc'
        id: cache-arc
        uses: actions/cache@v4
        with:
          path: eval/data/arc
          key: arc-eval-data-v1

      - name: Download ARC dataset
        if: inputs.benchmark == 'arc' && steps.cache-arc.outputs.cache-hit != 'true'
        run: npx tsx eval/download.ts --dataset arc
```

### 4. Update the Run Eval Step

The existing run step dynamically builds the `ARGS` string. Add ARC-specific argument handling:

```yaml
      - name: Run eval
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          NODE_OPTIONS: --max-old-space-size=4096
        run: |
          ARGS="--benchmark ${{ inputs.benchmark }} --model ${{ inputs.model }}"
          ARGS="$ARGS --max-iterations ${{ inputs.max-iterations }}"
          ARGS="$ARGS --max-depth ${{ inputs.max-depth }}"
          ARGS="$ARGS --concurrency ${{ inputs.concurrency }}"
          if [ -n "${{ inputs.max-tasks }}" ]; then
            ARGS="$ARGS --max-tasks ${{ inputs.max-tasks }}"
          fi
          if [ -n "${{ inputs.drivers }}" ]; then
            ARGS="$ARGS --drivers ${{ inputs.drivers }}"
          fi
          if [ -n "${{ inputs.app }}" ]; then
            ARGS="$ARGS --app ${{ inputs.app }}"
          fi
          if [ -n "${{ inputs.selected-problems }}" ]; then
            ARGS="$ARGS --selected-problems ${{ inputs.selected-problems }}"
          fi
          npx tsx eval/run.ts $ARGS
```

### 5. Increase Timeout for ARC

ARC tasks can take much longer than OOLONG tasks. The current 90-minute timeout may not be sufficient for a full 120-task run.

```yaml
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 240    # <-- Increase from 90 to 240 (4 hours)
```

Alternatively, keep the 90-minute timeout and rely on `--max-tasks` to limit runs in CI:
- For CI smoke tests: `--max-tasks 10` (should complete in ~20 minutes)
- For full runs: use a longer timeout or run locally

## Full Updated `eval.yml`

```yaml
name: Eval

on:
  workflow_dispatch:
    inputs:
      benchmark:
        description: Benchmark to run
        required: true
        type: choice
        options:
          - oolong
          - s-niah
          - arc
      model:
        description: "Model (provider/id, e.g. google/gemini-2.5-flash)"
        required: true
        default: qwen/qwen3-coder
      max-tasks:
        description: Max tasks (blank = all)
        required: false
      max-iterations:
        description: Max REPL iterations per task
        required: false
        default: "15"
      max-depth:
        description: Max recursion depth
        required: false
        default: "1"
      concurrency:
        description: Parallel tasks
        required: false
        default: "5"
      drivers:
        description: "Comma-separated driver plugins"
        required: false
      app:
        description: "App plugin name"
        required: false
      selected-problems:
        description: "ARC: comma-separated problem IDs"
        required: false
      analyze:
        description: Run trajectory analysis after eval
        type: boolean
        default: true

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      # --- OOLONG data ---
      - name: Cache OOLONG eval data
        if: inputs.benchmark == 'oolong'
        id: cache-oolong
        uses: actions/cache@v4
        with:
          path: eval/data/oolong
          key: oolong-eval-data-v1

      - name: Download OOLONG dataset
        if: inputs.benchmark == 'oolong' && steps.cache-oolong.outputs.cache-hit != 'true'
        run: npx tsx eval/download.ts --from-release

      # --- ARC data ---
      - name: Cache ARC eval data
        if: inputs.benchmark == 'arc'
        id: cache-arc
        uses: actions/cache@v4
        with:
          path: eval/data/arc
          key: arc-eval-data-v1

      - name: Download ARC dataset
        if: inputs.benchmark == 'arc' && steps.cache-arc.outputs.cache-hit != 'true'
        run: npx tsx eval/download.ts --dataset arc

      # --- Run eval ---
      - name: Run eval
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          NODE_OPTIONS: --max-old-space-size=4096
        run: |
          ARGS="--benchmark ${{ inputs.benchmark }} --model ${{ inputs.model }}"
          ARGS="$ARGS --max-iterations ${{ inputs.max-iterations }}"
          ARGS="$ARGS --max-depth ${{ inputs.max-depth }}"
          ARGS="$ARGS --concurrency ${{ inputs.concurrency }}"
          if [ -n "${{ inputs.max-tasks }}" ]; then
            ARGS="$ARGS --max-tasks ${{ inputs.max-tasks }}"
          fi
          if [ -n "${{ inputs.drivers }}" ]; then
            ARGS="$ARGS --drivers ${{ inputs.drivers }}"
          fi
          if [ -n "${{ inputs.app }}" ]; then
            ARGS="$ARGS --app ${{ inputs.app }}"
          fi
          if [ -n "${{ inputs.selected-problems }}" ]; then
            ARGS="$ARGS --selected-problems ${{ inputs.selected-problems }}"
          fi
          npx tsx eval/run.ts $ARGS

      - name: Analyze results
        run: npx tsx eval/analyze.ts

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-${{ inputs.benchmark }}-${{ github.run_number }}
          path: eval/results/
          retention-days: 90

  analyze:
    if: inputs.analyze == true
    needs: [eval]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Download eval results
        uses: actions/download-artifact@v4
        with:
          name: eval-${{ inputs.benchmark }}-${{ github.run_number }}
          path: eval/results/

      - name: Install OpenProse skill
        run: |
          git clone --depth 1 https://github.com/openprose/prose.git /tmp/prose
          mkdir -p .claude/skills
          cp -r /tmp/prose/skills/open-prose .claude/skills/open-prose

      - name: Trajectory analysis
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          claude_args: '--allowedTools Bash Write Read Glob Grep Edit Skill'
          prompt: |
            Find the most recent .json file in eval/results/ and run:
            prose run .prose/analyze-trajectories.prose
            Input results_path: <that file>
            Input output_dir: eval/trajectory-analysis

      - name: Upload trajectory analysis
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: trajectory-analysis-${{ inputs.benchmark }}-${{ github.run_number }}
          path: eval/trajectory-analysis/
          retention-days: 90
```

## Cache Key Strategy

| Benchmark | Cache Path | Cache Key | Size |
|:---|:---|:---|:---|
| OOLONG | `eval/data/oolong` | `oolong-eval-data-v1` | ~535 MB |
| ARC | `eval/data/arc` | `arc-eval-data-v1` | ~1.2 MB |
| S-NIAH | (no cache needed) | N/A | Generated at runtime |

### Cache Key Versioning

- Start with `arc-eval-data-v1`
- Bump to `v2` if the ARC data changes (unlikely for a fixed evaluation set)
- Keep the cache key in sync with `ARC_RELEASE_TAG` in `eval/download.ts`

## Data Download Step Details

The download step runs `npx tsx eval/download.ts --dataset arc`, which:
1. Fetches the `arc-agi-2-evaluation.tar.gz` asset from the GitHub Release
2. Extracts to `eval/data/arc/`
3. Verifies the two JSON files exist
4. Should complete in <5 seconds (the data is <200 KB compressed)

## Recommended CI Parameters for ARC

For CI runs (to keep costs and time reasonable):

| Parameter | CI Default | Full Run |
|:---|:---|:---|
| `max-tasks` | 10-20 | (blank = all 120) |
| `max-iterations` | 15-25 | 25-30 |
| `max-depth` | 1-2 | 2 |
| `concurrency` | 5-10 | 10 |
| `model` | anthropic/claude-opus-4-6 | anthropic/claude-opus-4-6 |

## Workflow Dispatch Example

To trigger from the CLI:

```bash
# Smoke test (10 tasks)
gh workflow run eval.yml \
  -f benchmark=arc \
  -f model=anthropic/claude-opus-4-6 \
  -f max-tasks=10 \
  -f max-iterations=25 \
  -f concurrency=10

# Full run (all 120 tasks)
gh workflow run eval.yml \
  -f benchmark=arc \
  -f model=anthropic/claude-opus-4-6 \
  -f max-iterations=25 \
  -f max-depth=2 \
  -f concurrency=10

# Specific problems
gh workflow run eval.yml \
  -f benchmark=arc \
  -f model=anthropic/claude-opus-4-6 \
  -f selected-problems="0934a4d8,135a2760" \
  -f max-iterations=30
```

## Notes on GitHub Actions Limits

- **Timeout:** GitHub Actions jobs have a 6-hour maximum. Our 180-minute timeout is well within this.
- **Disk space:** ARC data is tiny (<2 MB). No disk concerns.
- **Memory:** ARC tasks have small contexts. The `--max-old-space-size=4096` setting is more than adequate.
- **Cost:** The OpenRouter API key secret is already configured. No new secrets needed.
- **Concurrency:** GitHub Actions allows 20 concurrent jobs for public repos, but we only use 1 job for the eval run. The `concurrency` parameter controls in-process parallelism, not job-level parallelism.
