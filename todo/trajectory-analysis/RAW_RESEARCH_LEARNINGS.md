# Trajectory Analysis — Raw Research Learnings

## 1. What We Have: Trace Data Structure

Per-task, per-iteration, our eval harness captures:

```typescript
// src/rlm.ts:20-25
interface TraceEntry {
  reasoning: string;      // Full raw LLM response (markdown + code fences + prose)
  code: string[];          // Extracted code blocks (from ```javascript...```)
  output: string;          // Combined stdout from all code blocks this iteration
  error: string | null;    // Last stderr if execution error occurred
}

// eval/types.ts:11-21
interface EvalResult {
  taskId: string;
  answer: string;                    // Final return() value
  expected: string | string[];
  score: number;                     // 0-1 from scoring function
  iterations: number;
  trace: TraceEntry[];               // Array of above, one per REPL iteration
  wallTimeMs: number;
  charCount: { input: number; output: number };
  error?: string;                    // "RlmMaxIterationsError", etc.
}
```

**Refs:** `src/rlm.ts:20-25`, `eval/types.ts:11-21`, `eval/harness.ts:150-207`

### What's captured
- Full model response per iteration (reasoning field — includes prose + fenced code)
- Extracted executable code blocks
- Execution stdout/stderr
- Final answer, score, wall time, char counts
- Task metadata (taskGroup, task, answerType, etc. from OOLONG)

### What's NOT captured
- **Nested rlm()/llm() call traces** — child invocations only return `result.answer` to parent; full child trace is discarded (`src/rlm.ts:422`)
- **Variable bindings** — only stdout is captured, not JS variable state
- **Return value progression** — only final return
- **Delegation graph** — invocationId exists (`d1-c0.d2-c1` pattern) but not propagated to eval results
- **llm() call count/content** — not instrumented

**Implication:** At maxDepth=1 (our OOLONG config), there are no nested rlm() calls, so traces are complete. The gap is llm() calls — the model can fan out via llm() and we don't see those calls in the trace.

---

## 2. What the RLM Paper Tracks in Trajectories

From `~/code/trinity/RLMs/RLMs.md`, the paper identifies **4 emergent behavioral patterns**:

| Pattern | Description | Example |
|---------|-------------|---------|
| A: Filtering | Regex/code to narrow context before sub-calling | GPT-5 probes 1000-doc corpus with keywords |
| B: Chunking & Recursion | Decompose via sub-(R)LM calls | Qwen3-Coder: 1000s of per-line sub-calls vs GPT-5: ~10 calls |
| C: Verification | Sub-LM calls to verify answers | Sometimes redundant (5+ verification attempts) |
| D: Variable Stitching | Build output iteratively across iterations | For tasks exceeding output length limits |

**Key metrics the paper tracks:**
- Total API cost per trajectory
- Number of recursive sub-calls (GPT-5: ~10, Qwen3-Coder: 100s-1000s)
- Recursion depth (fixed at maxDepth=1 in their experiments)
- Iteration count per task
- Verification patterns (redundant vs. efficient)
- Runtime distribution (25th, 50th, 75th, 95th percentiles)

**Paper's trajectory examples (Appendix B):**
- B.1: GPT-5 on BrowseComp — 3 steps, efficient regex probe → sub-call → verify
- B.2: Qwen3-Coder on OOLONG-Pairs — 11 steps, repeats same work 5x, discards correct answer
- B.3: Qwen3-Coder on OOLONG — 1000s of per-line sub-calls (correct but wasteful)
- B.4: GPT-5 on CodeQA — partition-aggregate strategy on 900K token codebase

**Ref:** `~/code/trinity/RLMs/RLMs.md` (Section 3.1, Appendix B, Figures 4-9)

---

## 3. Existing Prose + CI Infrastructure

### Claude Code Action pattern
Both `node-rlm` and `unix-rlm-cloud` use the same workflow pattern:

```yaml
# .github/workflows/claude-pr-review.yml
- name: Install OpenProse skill
  run: |
    git clone --depth 1 https://github.com/openprose/prose.git /tmp/prose
    mkdir -p ~/.claude/skills
    cp -r /tmp/prose/skills/open-prose ~/.claude/skills/open-prose

- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    prompt: "prose run pr-review.prose"
```

**Refs:** `.github/workflows/claude-pr-review.yml`, `unix-rlm-cloud/.github/workflows/claude-review.yml`

### Existing prose programs in this repo
- `pr-review.prose` — basic PR review (simple, no agents)
- `.prose/controlled-burn.prose` — AI wart scanner (good reference: agents, pmap, inputs, triage flow)
- `.prose/tenet-sync.prose`, `.prose/true-form.prose` — exist but not examined

### controlled-burn.prose as template
The controlled-burn is the closest analog to what we want:
- **Discover** → scan targets
- **Fan-out** → pmap over directories with scanner agent
- **Human checkpoint** → input for review
- **Fan-out again** → pmap over items with fixer agent
- **Triage** → analyst agent classifies remaining items
- **Synthesize** → final summary

Our trajectory analysis pipeline would follow the same shape.

---

## 4. Result Data Availability

**Problem:** eval/results/ is empty locally — results only exist as GitHub Actions artifacts.

The last successful run (21949913718) produced results uploaded as artifact `eval-oolong-{run_number}`.

**Options for the prose program to access results:**
1. Download artifact via `gh run download` before running prose
2. Add a workflow step that downloads the artifact, then runs prose
3. Store results in the repo (committed or as a release asset)
4. Pass result file path as an `input` to the prose program

Option 1 or 2 is cleanest — the prose program takes a file path input.

**Ref:** `.github/workflows/eval.yml:68-74` (upload-artifact step)

---

## 5. Trajectory Annotation Format — Design Space

The format needs to be:
- **LLM-readable** (primary audience is Claude analyzing these)
- **Structured enough** for programmatic extraction
- **Rich enough** to capture control flow, delegation, verification patterns

### Candidates

**A. Annotated Markdown (with YAML frontmatter)**
```markdown
---
taskId: oolong-14000014
score: 1.0
iterations: 5
answerType: COMPARISON
expected: "more common than"
answer: "more common than"
wallTimeMs: 55700
patterns: [filtering, verification]
failure_point: null
---

# Trajectory: oolong-14000014

## Task
Compare frequency of two labels in the TREC-coarse dataset.

## Control Flow Summary
1. Context exploration (iter 1-2): grep/regex to understand data format
2. Data extraction (iter 3): count occurrences of each label
3. Comparison (iter 4): compute which is more common
4. Return (iter 5): return("more common than")

## Iteration Detail

### Iter 1 — Exploration
**Strategy:** Probe context structure
**Code:**
​```javascript
console.log(context.substring(0, 500));
​```
**Output:** [first 500 chars of context]
**Assessment:** Correct — needed to understand data format before acting

### Iter 2 — Filtering
**Strategy:** Extract relevant data via regex
...
```

**Pros:** Natural for LLMs, easy to read, supports rich annotation
**Cons:** Harder to aggregate programmatically

**B. JSON-LD / Structured JSON**
```json
{
  "@type": "RlmTrajectory",
  "taskId": "oolong-14000014",
  "score": 1.0,
  "controlFlow": {
    "phases": [
      { "name": "exploration", "iterations": [1, 2], "strategy": "grep context" },
      { "name": "extraction", "iterations": [3], "strategy": "count labels" },
      { "name": "return", "iterations": [5] }
    ],
    "patterns": ["filtering", "verification"],
    "failurePoint": null
  }
}
```

**Pros:** Machine-parseable, aggregatable
**Cons:** Verbose, less natural for LLM reasoning

**C. Hybrid: Markdown body with JSON control-flow summary**
Best of both worlds — YAML frontmatter for structured metadata, markdown body for rich narrative, and a JSON "control flow graph" section for programmatic access.

### Recommendation: Annotated Markdown (Option A/C hybrid)

Rationale:
- Primary consumer is an LLM (Claude) doing synthesis
- Markdown is Claude's native format for both reading and writing
- YAML frontmatter gives structure for filtering/aggregation
- The "control flow summary" section gives quick machine-readable overview
- Iteration detail sections give the rich context needed for root-cause analysis

---

## 6. Prose Program Shape — Draft Architecture

```
Input: result JSON file path

Phase 1: SAMPLE SELECTION
  - Parse result JSON
  - Stratify by (answerType × success/failure) — pick 2 from each cell
  - Output: selected task IDs + metadata

Phase 2: TRAJECTORY ANNOTATION (fan-out, parallel)
  - For each selected task:
    - Agent reads raw trace
    - Classifies each iteration (exploration, filtering, extraction, verification, return, error-recovery)
    - Identifies patterns (A/B/C/D from paper)
    - Identifies failure point (if any)
    - Writes annotated trajectory markdown

Phase 3: ADVERSARIAL REVIEW (fan-out, parallel)
  - For each annotated trajectory:
    - Different agent reviews the annotation
    - Checks: did annotator miss patterns? Misclassify iterations? Wrong failure point?
    - Writes review notes

Phase 4: SYNTHESIS (fan-in)
  - Agent reads all annotated trajectories + reviews
  - Produces cross-cutting analysis:
    - Which patterns appear in successful vs failed tasks?
    - Common failure modes by task type
    - Iteration efficiency (how many wasted iterations?)
    - Recommendations for system prompt / plugin changes
```

**Ref:** Pattern matches `controlled-burn.prose` structure (discover → fan-out scan → review → fan-out fix → triage → synthesize)

---

## 7. Critical Discovery: CI Runs Without Plugins

The GitHub Actions workflow (`eval.yml:55-63`) passes:
```
--benchmark --model --max-iterations --max-depth --concurrency [--max-tasks]
```

It does **NOT** pass `--profile` or `--app`. This means:
- **CI runs at 42%** had NO plugins (no `gemini-3-flash` profile, no `structured-data-aggregation` app)
- **Local runs at 58.4%** likely had plugins enabled

The `gemini-3-flash` profile loads 5 reliability drivers (`eval/run.ts:364-385`, `plugins/profiles/gemini-3-flash.md`):
1. `no-tool-calls` — prevents hallucinated tool call syntax
2. `one-block-per-iteration` — stops multi-block responses with fabricated output
3. `await-discipline` — ensures rlm()/llm() calls are awaited
4. `return-format-discipline` — enforces return() format
5. `verify-before-return` — forces console.log before return

Plus the `structured-data-aggregation` app plugin provides the map-reduce aggregation protocol.

**This likely explains the entire 16.4pp gap (42% vs 58.4%). Plugins are doing real work.**

**Ref:** `eval/run.ts:364-385`, `.github/workflows/eval.yml:55-63`, `plugins/profiles/gemini-3-flash.md`

---

## 8. OOLONG Task Type Distribution

From the `/tmp/test-summary.md` (50-task local run), classifying by expected answer:

| Type | Expected Pattern | Count | Examples |
|------|-----------------|-------|----------|
| COMPARISON | "more/less common than", "same frequency as" | ~28 | oolong-14000014, 15, 25, 26, 28... |
| NUMERIC | Integer | ~12 | oolong-14000016 (64), 14000019 (69), 14000020 (58)... |
| LABEL | Category string | ~7 | oolong-14000012 (human being), 14000023 (abbreviation)... |
| USER | Large user ID | ~3 | oolong-14000022 (64959), 14000059 (63470), 14000060 (66212) |

**Success rates by type (local 58.4% run):**
- COMPARISON: ~18/28 (64%) — main failure mode is wrong direction
- NUMERIC: ~3/12 (25%) — model hallucinates counts, can't grep unlabeled data
- LABEL: ~4/7 (57%) — sometimes returns wrong label or multi-label when single expected
- USER: 3/3 (100%) — trivial grep tasks

**Ref:** `/tmp/test-summary.md`

---

## 9. System Prompt & How-to-Work Protocol

The system prompt (`src/system-prompt.ts:1-69`) teaches a 5-step loop:
1. **Explore** — inspect data type, length, sample
2. **Plan** — decide strategy, design delegation
3. **Execute** — compute directly or delegate
4. **Verify** — console.log candidate, confirm in output
5. **Return** — only after verified

Available tools: `context`, `console.log()`, `return()`, `await rlm()`, `await llm()`, `__rlm`, `__ctx.shared.data`, `__ctx.local`, `require()`.

**Ref:** `src/system-prompt.ts`

---

## 10. Prose CI Pattern

Both `node-rlm` and `unix-rlm-cloud` use:
```yaml
- name: Install OpenProse skill
  run: |
    git clone --depth 1 https://github.com/openprose/prose.git /tmp/prose
    mkdir -p ~/.claude/skills
    cp -r /tmp/prose/skills/open-prose ~/.claude/skills/open-prose

- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    prompt: "prose run <file>.prose"
```

The `unix-rlm-cloud` version adds: explicit model (`claude-opus-4-6`), tool allowlisting, progress tracking.

For trajectory analysis, we'd add this as a post-step in the eval workflow, after `upload-artifact`, pointing at the result JSON.

**Ref:** `.github/workflows/claude-pr-review.yml`, `unix-rlm-cloud/.github/workflows/claude-review.yml`

---

## 11. Trajectory Annotation Format Decision

**Annotated Markdown with YAML frontmatter** is the right format:

1. Primary consumer is Claude (LLM-native format)
2. YAML frontmatter → structured metadata for filtering/aggregation
3. Markdown body → rich narrative with embedded code blocks
4. A "Control Flow Summary" section → quick machine-readable overview
5. Per-iteration detail → root-cause analysis material

See `TRAJECTORY_FORMAT.md` (sibling file) for the canonical template.

---

## 12. Open Questions

1. **llm() call visibility:** At maxDepth=1, the model uses llm() for fan-out (Run 05, Task 14). These calls are invisible — we see code + stdout but not the llm() responses. The code + stdout is sufficient for trajectory analysis (we can see WHAT was called and WHAT came back via console.log), but we can't see the intermediate LLM reasoning.

2. **Sample size for analysis:** ~12-16 tasks (2 per type × outcome cell) at ~$0.15/task (Opus analysis) ≈ $2-3 total. Cheap.

3. **Plugin gap investigation:** The 42% vs 58.4% gap is almost certainly plugins. Trajectory analysis should confirm this by looking for the specific failure modes plugins fix (multi-block, unawaited calls, no verification).

4. **Workflow integration:** Best as a separate `workflow_dispatch` workflow OR a post-step in eval.yml gated by an input flag (e.g., `analyze: true`).

---

## 13. Design Decisions Made

### Trajectory format: Annotated Markdown + YAML frontmatter
- See `TRAJECTORY_FORMAT.md` for full spec
- YAML frontmatter: structured metadata (taskId, score, patterns, failureMode, verdict)
- Control Flow section: one-line-per-iteration summary (iter N PHASE description)
- Phase Analysis: grouped narrative with code/output evidence
- Root Cause / Success Factors: diagnostic conclusion
- What Would Have Helped: actionable recommendations

### Prose program: 4-phase pipeline
- See `analyze-trajectories.prose` for the full program
- **Phase 1 (Sample):** Sonnet agent parses results, builds answerType × outcome matrix, picks 2/cell → ~12-16 tasks
- **Phase 2 (Annotate):** Opus agents fan-out via pmap, each reads raw trace + format spec, writes annotated markdown
- **Phase 3 (Review):** Opus agents fan-out via pmap, adversarially review each annotation
- **Phase 4 (Synthesize):** Single Opus agent reads all annotations + reviews, produces cross-cutting analysis

### Agent model assignments
- `sampler`: Sonnet — structured data task, doesn't need Opus reasoning
- `annotator`: Opus — needs to deeply understand code, trace semantics, failure causation
- `reviewer`: Opus — needs to catch subtle annotation errors
- `synthesizer`: Opus — needs to find cross-cutting patterns across many trajectories
- Task data extractors: Haiku — trivial JSON extraction from file

### Cost estimate
- ~4 Sonnet calls (sampler + task extraction)
- ~12-16 Opus calls (annotators)
- ~12-16 Opus calls (reviewers)
- ~1 Opus call (synthesizer)
- Total: ~30 Opus calls × ~$0.10-0.15 each ≈ **$3-5** per analysis run

---

## 14. CI Integration Plan

### Option A: Post-step in eval.yml (simplest)
Add after the existing "Analyze results" step:

```yaml
- name: Trajectory analysis
  if: inputs.analyze == 'true'
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    # Install OpenProse
    git clone --depth 1 https://github.com/openprose/prose.git /tmp/prose
    mkdir -p ~/.claude/skills
    cp -r /tmp/prose/skills/open-prose ~/.claude/skills/open-prose

    # Find the result file
    RESULT=$(ls -t eval/results/*.json | head -1)

    # Run via Claude Code Action (need to figure out CLI invocation)
    # TODO: claude-code-action is a GitHub Action, not a CLI tool
    # Alternative: use the Claude API directly via a TypeScript script
```

**Problem:** `anthropics/claude-code-action` is a GitHub Action (runs as a step), not a CLI. Can't invoke prose from a shell script step. Would need a dedicated step:

```yaml
- name: Trajectory analysis
  if: inputs.analyze == 'true'
  uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: claude-opus-4-6
    prompt: |
      prose run todo/trajectory-analysis/analyze-trajectories.prose
      Input results_path: eval/results/$(ls -t eval/results/ | head -1)
```

### Option B: Separate workflow (more flexible)
A dedicated `trajectory-analysis.yml` that:
1. Downloads artifact from a specified eval run
2. Runs the prose program
3. Uploads the analysis as a new artifact

This is cleaner because it decouples analysis from eval execution and lets you re-analyze old runs.

### Option C: Local-only (for now)
Run locally:
```bash
# Download artifact from GitHub
gh run download <run-id> -n eval-oolong-<run-number>

# Run prose
prose run todo/trajectory-analysis/analyze-trajectories.prose
# When prompted, provide: eval/results/<filename>.json
```

**Recommendation:** Start with Option C (local), graduate to Option B once validated.

---

## 15. Artifact Structure

Every analysis run writes to `{output_dir}/` with this layout:

```
{output_dir}/
├── meta.json                    # Run metadata: paths, timestamps, status, config
├── sample.json                  # Stratified sample selection + cross-tab matrix
├── trajectories/
│   ├── oolong-14000014.md       # Per-task annotated trajectory (YAML frontmatter + markdown)
│   ├── oolong-14000016.md
│   └── ...
├── reviews/
│   ├── oolong-14000014.md       # Per-task adversarial review
│   ├── oolong-14000016.md
│   └── ...
├── synthesis.md                 # Full cross-cutting analysis + recommendations
└── summary.md                   # Condensed summary (→ $GITHUB_STEP_SUMMARY in CI)
```

**Design principles:**
- Each file is self-contained and independently useful
- YAML frontmatter on trajectory files makes them machine-parseable
- `meta.json` acts as the manifest — downstream jobs can read it to find everything
- `summary.md` doubles as the GitHub Step Summary (human-readable dashboard)
- Trajectories named by taskId for stable, predictable paths

**In CI, uploaded as artifact:**
```yaml
- uses: actions/upload-artifact@v4
  with:
    name: trajectory-analysis-${{ inputs.benchmark }}-${{ github.run_number }}
    path: eval/trajectory-analysis/
    retention-days: 90
```

**For downstream consumption:** A later job can:
```bash
gh run download <run-id> -n trajectory-analysis-oolong-<N>
cat eval/trajectory-analysis/meta.json   # manifest
cat eval/trajectory-analysis/synthesis.md # full analysis
ls eval/trajectory-analysis/trajectories/ # per-task annotations
```

---

## 16. Immediate Next Actions

1. **Fix the plugin gap first** — Add `--profile` and `--app` to eval.yml workflow, re-run to confirm 58% CI parity
2. **Download the 42% result artifact** — `gh run download 21949913718`
3. **Run the prose program locally** — validate format, agent quality, synthesis depth
4. **Iterate on prompts** — annotator and synthesizer prompts will need tuning based on first run
5. **Decide CI integration** — after local validation, pick Option B or C

---

**Update (2026-02-12):** Files have been moved to their permanent homes and the eval workflow has been updated:
- `analyze-trajectories.prose` moved to `.prose/analyze-trajectories.prose`
- `TRAJECTORY_FORMAT.md` moved to `docs/TRAJECTORY_FORMAT.md`
- `.github/workflows/eval.yml` now has an `analyze` boolean input that gates optional trajectory analysis steps (Install OpenProse, run prose program via claude-code-action, upload trajectory-analysis artifact)
- Internal path references in the prose program updated to reflect new locations
