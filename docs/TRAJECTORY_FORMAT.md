# Annotated Trajectory Format (v2)

This is the canonical format for an annotated RLM trajectory.
Written by an LLM analyst, consumed by an LLM synthesizer.

**v2 changes** (backward-compatible with v1):
- Control flow lines now support `PHASE:sub-phase` two-level labels, `[Hx]` hypothesis links, and `✓✗~→` outcome markers
- New **Hypothesis Log** section tracks hypotheses as first-class entities
- New optional computed frontmatter fields enable cross-run statistical aggregation
- See [Upgrade Guide from v1](#upgrade-guide-from-v1) at the end for full details

---

## Template

```markdown
---
taskId: oolong-14000016
score: 0.75
iterations: 11
wallTimeMs: 262000
answerType: ANSWER_TYPE.NUMERIC
taskGroup: TASK_TYPE.NUMERIC_ONE_CLASS
answer: "65"
expected: "64"
error: null
patterns:
  - filtering
  - verification
  - error-recovery
failureMode: hallucinated-count
verdict: partial-credit
---

# Trajectory: oolong-14000016

## Task Summary

Count occurrences of a specific label in the TREC-coarse dataset (131K context).
Expected: 64. Got: 65. Score: 0.75 (numeric partial credit).

## Control Flow

```
iter  1  EXPLORE:data-probe     →  probe context type and length
iter  2  EXPLORE:format-detect  →  log first 500 chars, discover plain-text format
iter  3  FILTER:regex           →  grep for target label using regex
iter  4  ERROR:runtime          ✗  jq parse attempt fails (not JSON)
iter  5  FILTER:regex           →  switch to line-by-line string matching
iter  6  EXTRACT:compute        →  count matches via .filter().length
iter  7  VERIFY:spot-check      →  log count, get 65
iter  8  VERIFY:cross-method    →  re-count with different regex, still 65
iter  9  EXTRACT:delegate       →  try rlm() fan-out classification (maxIterations:1)
iter 10  EXTRACT:aggregate      →  aggregate rlm() results, get 63
iter 11  RETURN                 ✓  return("65") — chose code count over llm count
```

## Hypothesis Log

_Optional for single-strategy tasks. Included here for illustration._

| ID | Hypothesis | Iters | Outcome |
|----|-----------|-------|---------|
| H1 | Data is JSON (parse with jq) | 4 | rejected: parse error |
| H2 | Regex line-match gives correct count | 3,5-7 | accepted: 65 matches |
| H3 | rlm() fan-out is more accurate than regex | 9-10 | rejected: delegation count=63, less trusted |

## Phase Analysis

### Phase 1: Exploration (iter 1-2)
**Strategy:** Standard data probing
**Effectiveness:** Correct. Identified plain-text format quickly.

### Phase 2: First Extraction Attempt (iter 3-4)
**Strategy:** Grep + jq
**Failure:** Tried jq on plain text (common pattern — 18/20 tasks do this).
**Wasted iterations:** 1

### Phase 3: Code-based Counting (iter 5-7)
**Strategy:** Line-by-line string matching with regex
**Result:** Got 65 (off by 1 from expected 64)
**Assessment:** Regex was slightly too permissive — matched a partial label.

### Phase 4: Verification via Delegation (iter 8-10)
**Strategy:** Re-counted with different regex, then tried rlm() fan-out
**Result:** Code said 65, rlm() fan-out said 63. Neither matched expected 64.
**Assessment:** Good instinct to cross-verify, but both methods were inaccurate.

### Phase 5: Return (iter 11)
**Decision:** Trusted code count (65) over rlm() fan-out count (63).
**Assessment:** Reasonable heuristic — code counts are usually more reliable than delegation-based estimates. But the regex was wrong.

## Root Cause
The counting regex was slightly over-inclusive. The label "entity" also matched partial occurrences in phrases like "entity-related". A word-boundary regex (`\bentity\b`) would have yielded the correct count.

## What Would Have Helped
1. **Plugin: structured-data-aggregation** — provides the chunked rlm() map-reduce pattern
2. **Word-boundary regex** — explicit `\b` anchors in the grep pattern
3. **Sanity check** — comparing code count to total lines would reveal the off-by-one
```

---

## Template: ARC Task (extended example with hypothesis tracking)

This example shows the format applied to an ARC task where the hypothesis log
and sub-phase tags carry more weight than in data-processing tasks.

```markdown
---
taskId: arc-0934a4d8
score: 0
iterations: 19
wallTimeMs: 279374
answerType: ANSWER_TYPE.GRID
taskGroup: TASK_TYPE.ARC
answer: "[[9,1,9],...]"
expected: "[[7,7,9],...]"
error: null
patterns:
  - format-discovery
  - multi-strategy
  - incremental-refinement
  - symmetry-search
  - brute-force
  - verification
  - edge-case-unresolved
failureMode: incorrect-symmetry-application
verdict: wrong-answer
---

# Trajectory: arc-0934a4d8

## Task Summary

ARC task: 30x30 grid with bilateral reflection symmetry (axis 15.5).
A rectangular 8-region masks cells; output is the masked region's values.
Agent found the symmetry and validated it on training data (93/93 cells),
but failed on the test case where the 8-region at cols 0-2 maps out-of-bounds.
Expected: [[7,7,9],...]. Got: [[9,1,9],...]. Score: 0.

## Control Flow

```
iter  1  EXPLORE:parse          →  parse training data, print all I/O dimensions
iter  2  EXPLORE:structure      →  locate 8-regions, confirm size = output size
iter  3  EXPLORE:hyp-test  [H1] ✗  test 180-degree rotational symmetry — 30% match
iter  4  EXPLORE:hyp-test  [H2] ✗  test H/V reflection at center — 12-16% match
iter  5  EXPLORE:hyp-test  [H3] ✗  test mirror of 8-cell positions — poor match
iter  6  EXPLORE:hyp-test  [H4] ✗  search for repeating row/col periods — none found
iter  7  EXPLORE:hyp-test  [H5] ✗  brute-force all translation offsets — best 22/36
iter  8  EXPLORE:hyp-test  [H6] ✓  search all reflection axes — axis 15.5 = 100%
iter  9  VERIFY:train-val  [H6] ✓  recover 8-cells in training — 93/93 perfect
iter 10  EXTRACT:apply     [H6] ~  apply to test — 8 cells unresolvable (OOB)
iter 11  EXPLORE:hyp-test  [H7] ✗  test axis 14.5 — fails; recognize OOB issue
iter 12  EXPLORE:hyp-test  [H8] ✗  search for translational symmetry — no matches
iter 13  EXPLORE:diagnose       →  inspect rows to confirm axis 15.5; rows 0-1 have no mirror
iter 14  EXPLORE:diagnose       →  search what rows/cols 0,1 pair with — only self
iter 15  VERIFY:reconfirm  [H6] →  re-confirm axis 15.5 is 100% for test H and V
iter 16  EXPLORE:diagnose       ✗  test col 0↔col 29, col 1↔col 28 — 4/21 match
iter 17  EXPLORE:diagnose       ✗  search for second H-axis on cols 0-2 — none
iter 18  EXTRACT:fallback       ~  construct answer with col 29/28 as fallback
iter 19  RETURN                 ✗  return answer with incorrect fallback values
```

## Hypothesis Log

| ID | Hypothesis | Iters | Outcome | Evidence |
|----|-----------|-------|---------|----------|
| H1 | 180-degree rotational symmetry | 3 | rejected | ~30% cell match |
| H2 | H/V reflection at center (14.5) | 4 | rejected | 12-16% match |
| H3 | Output from point mirror of 8-positions | 5 | rejected | best 13/36 |
| H4 | Row/col period repetition | 6 | rejected | no significant periods |
| H5 | Translation offset | 7 | rejected | best 22/36 |
| H6 | Bilateral reflection, axis 15.5 | 8-10,15 | **accepted** | 100% train, OOB on test |
| H7 | Alternative axis 14.5 | 11 | rejected | fails badly |
| H8 | Translational symmetry for edge cols | 12 | rejected | no matches |

**Hypothesis arc:** H1→H2→H3→H4→H5→H6(breakthrough)→H7→H8 (attempts to fix H6 edge case)

## Phase Analysis
[... same prose as before ...]
```

---

## Template: Hypothesis-Dense ARC Task

This example demonstrates the format on a trajectory with many rapid hypothesis
switches followed by a parameter-search phase. It shows the distinction between
`hyp-test` (testing different hypotheses) and `param-search` (tuning within one
committed hypothesis).

```markdown
## Control Flow

```
iter  0  EXPLORE:parse               →  parse training data, display all input/output grids
iter  1  EXPLORE:structure            →  extract rectangles, classify hollow vs solid
iter  2  EXPLORE:hyp-test  [H1]      ✗  analyze spatial proximity pairing — inconclusive
iter  3  EXPLORE:hyp-form             →  discover left=hollow, right=solid pattern in output
iter  4  EXPLORE:hyp-test  [H2]      ✗  test spatial proximity pairing rule — mismatches
iter  5  EXPLORE:hyp-test  [H3]      ✗  try row/column clustering — dynamic thresholds fail
iter  6  EXPLORE:hyp-test  [H4]      ✗  divide input into grid cells — wrong pairings
iter  7  EXPLORE:hyp-test  [H5]      ✗  list exact positions — no clear pairing rule
iter  8  EXPLORE:hyp-test  [H6]      ✗  test diagonal pairing — partial match only
iter  9  EXPLORE:hyp-test  [H7]      ✗  try 3-column grid layout — doesn't generalize
iter 10  EXPLORE:hyp-test  [H8]      ✗  test anti-diagonal pattern — promising but imprecise
iter 11  EXTRACT:implement [H9]      ~  implement nearest-neighbor distance pairing
iter 12  EXPLORE:hyp-test  [H10]     ✗  test grid-adjacency based pairing — fails
iter 13  EXPLORE:hyp-test  [H8b]     ~  refine anti-diagonal reading order (r+c=constant)
iter 14  EXTRACT:implement [H8b]     ~  pair consecutive anti-diagonals, separate H/S streams
iter 15  EXPLORE:param-search [H8b]  ✗  test col-descending order within anti-diagonals
iter 16  EXPLORE:param-search [H8b]  ✗  try multiple sorting combos (row/col/diag)
iter 17  EXPLORE:param-search [H8b]  ~  manually check which sort orders match expected
iter 18  EXTRACT:apply      [H8b]    ~  apply best-fit sorting rule to test input
iter 19  RETURN                      ✗  return output grid with wrong ordering
```

## Hypothesis Log

| ID | Hypothesis | Iters | Outcome | Evidence |
|----|-----------|-------|---------|----------|
| H1 | Spatial proximity pairing | 2 | rejected | mismatches on train examples |
| H2 | Proximity with threshold | 4 | rejected | thresholds don't generalize |
| H3 | Row/column clustering | 5 | rejected | dynamic thresholds inconsistent |
| H4 | Grid-cell positioning | 6 | rejected | wrong pairings |
| H5 | Exact position matching | 7 | rejected | no clear rule |
| H6 | Diagonal pairing | 8 | rejected | partial match only |
| H7 | 3-column grid layout | 9 | rejected | doesn't generalize to all train |
| H8 | Anti-diagonal pattern (r+c) | 10,13 | superseded by H8b | promising direction |
| H8b | Anti-diagonal reading order with sorted streams | 13-18 | **accepted** (low confidence) | partial match, used under deadline |
| H9 | Nearest-neighbor distance | 11 | rejected | fails on 2/3 train examples |
| H10 | Grid-adjacency pairing | 12 | rejected | fails on all train examples |

**Hypothesis arc:** H1→H2→H3→H4→H5→H6→H7→H8→H9→H10→H8b(refinement, param-search)

**Key insight this format captures:**
- Iters 2-10: rapid hypothesis *switching* (8 different hypotheses in 9 iters)
- Iters 15-17: parameter *search* within one committed hypothesis (H8b)
- H8 was revisited and refined into H8b (hypothesis return pattern)
- The `[Hx]` column makes this visible at a glance
```

---

## Field Reference

### YAML Frontmatter (required fields)

| Field       | Type     | Description                                             |
| ----------- | -------- | ------------------------------------------------------- |
| taskId      | string   | e.g. "oolong-14000016"                                  |
| score       | number   | 0-1 from scoring function                               |
| iterations  | number   | Total REPL iterations                                   |
| wallTimeMs  | number   | Wall-clock milliseconds                                 |
| answerType  | string   | ANSWER_TYPE.NUMERIC, ANSWER_TYPE.COMPARISON, etc.       |
| taskGroup   | string   | TASK_TYPE.NUMERIC_ONE_CLASS, TASK_TYPE.COMPARISON, etc. |
| answer      | string   | What the RLM returned                                   |
| expected    | string   | Ground truth                                            |
| error       | string\|null | Error message if task errored, else null              |
| patterns    | string[] | Behavioral patterns observed (see vocabulary below)     |
| failureMode | string\|null | Primary failure mode (see vocabulary below), else null |
| verdict     | string   | perfect, partial-credit, wrong-answer, timeout, error   |

### YAML Frontmatter (optional computed fields)

These fields are derived from the annotation itself. They exist to support
statistical aggregation across many trajectories without requiring a parser
to re-derive them from prose.

| Field | Type | Description |
|-------|------|-------------|
| hypothesesTested | number | Total distinct hypotheses in the Hypothesis Log |
| hypothesesRejected | number | How many hypotheses were rejected |
| breakthroughIter | number\|null | Iteration where the accepted hypothesis was first confirmed. null if no hypothesis was accepted. |
| itersOnRejectedHypotheses | number | Iterations spent testing ultimately-rejected hypotheses |
| itersExplore | number | Iterations with EXPLORE phase |
| itersExtract | number | Iterations with EXTRACT phase |
| itersVerify | number | Iterations with VERIFY phase |
| itersWasted | number | Iterations classified as STALL + ERROR + redundant VERIFY |
| implementationAttempts | number | Distinct solve()/implementation versions tried (0 for non-implementation tasks) |

**Example:**
```yaml
hypothesesTested: 8
hypothesesRejected: 7
breakthroughIter: 8
itersOnRejectedHypotheses: 5
itersExplore: 14
itersExtract: 2
itersVerify: 2
itersWasted: 0
implementationAttempts: 1
```

### Control Flow Line Format

```
iter  N  PHASE:sub-phase  [Hx]  outcome  brief description
```

Each field:

| Field | Required | Format | Description |
|-------|----------|--------|-------------|
| `iter N` | yes | integer | 0-indexed or 1-indexed iteration number (match the raw trace) |
| `PHASE` | yes | ALLCAPS | Coarse phase label (see phase vocabulary below) |
| `:sub-phase` | optional | lowercase | Fine-grained technique or activity within the phase |
| `[Hx]` | optional | `[H1]`..`[Hn]` | Links iteration to a hypothesis in the Hypothesis Log |
| outcome | optional | symbol | `✓` success, `✗` failure, `~` partial/ambiguous, `→` neutral/continuing |
| description | yes | free text | Brief description of what happened |

**Alignment:** Use fixed-width formatting so that the phase column, hypothesis tag column, and outcome marker column are visually aligned. This enables at-a-glance scanning of the hypothesis timeline and outcome pattern.

#### Phase Vocabulary

The phase is the **primary activity** of that iteration. Seed phases:

| Phase      | When to use                                                                 |
| ---------- | --------------------------------------------------------------------------- |
| `EXPLORE`  | Probing data: typeof, length, slicing, format detection, structure analysis |
| `PLAN`     | Reasoning about strategy without executing code, or minimal diagnostic code |
| `FILTER`   | Narrowing data: grep, regex, split, slice for relevant subset               |
| `EXTRACT`  | Computing the answer: counting, classifying, aggregating, implementing      |
| `DELEGATE` | Primary activity is launching/collecting rlm() calls                        |
| `VERIFY`   | Checking a candidate answer via re-computation or cross-method              |
| `ERROR`    | Iteration dominated by handling/recovering from an error                    |
| `RETURN`   | Calling return() with the final answer                                      |
| `STALL`    | No meaningful progress — repeated prior work or went in circles             |

As with patterns, **coin a new phase label if needed.** Use ALLCAPS, short.

#### Sub-Phase Vocabulary

Sub-phases add a second dimension to the coarse phase. They are **optional** —
omit them when the phase alone is sufficient. Seed sub-phases:

**Under EXPLORE:**

| Sub-phase | When to use |
|-----------|-------------|
| `parse` | Parsing raw input: JSON.parse, typeof, array inspection |
| `data-probe` | Probing context: typeof, length, format detection |
| `format-detect` | Specifically determining data format (JSON, CSV, plain text) |
| `structure` | Analyzing structural properties (dimensions, regions, components) |
| `visualize` | Printing/displaying data for visual inspection |
| `hyp-test` | Testing a specific hypothesis — should have `[Hx]` tag |
| `hyp-form` | Forming a new hypothesis from observations |
| `param-search` | Testing parameter variations within an already-committed hypothesis |
| `diagnose` | Investigating why something failed or is unclear |

**Under EXTRACT:**

| Sub-phase | When to use |
|-----------|-------------|
| `compute` | Direct computation (counting, arithmetic, string processing) |
| `implement` | Writing a substantial solve() function or algorithm |
| `apply` | Applying a validated algorithm to new data (e.g., test input) |
| `aggregate` | Combining sub-results into a final answer |
| `refine` | Fixing bugs or improving an existing implementation (e.g., solve1 -> solve2) |
| `delegate` | Using rlm() to compute part of the answer |
| `fallback` | Implementing a backup strategy under time pressure |

**Under VERIFY:**

| Sub-phase | When to use |
|-----------|-------------|
| `train-val` | Validating against training examples |
| `spot-check` | Checking specific cells/values in output |
| `cross-method` | Re-computing via a different method |
| `reconfirm` | Re-checking something already validated (potentially redundant) |

**Under ERROR:**

| Sub-phase | When to use |
|-----------|-------------|
| `runtime` | JavaScript/sandbox runtime error (SyntaxError, TypeError, etc.) |
| `api` | API-level error (MALFORMED_FUNCTION_CALL, timeout) |
| `logic` | Detected logical error in own code (not a crash, but wrong result) |

As with phases, **coin new sub-phases** freely. Use `lowercase-kebab-case`.

#### Outcome Markers

| Marker | Meaning |
|--------|---------|
| `✓` | Iteration achieved its goal: hypothesis confirmed, test passed, correct output |
| `✗` | Iteration failed at its goal: hypothesis rejected, test failed, runtime error |
| `~` | Partial or ambiguous result: some progress but incomplete |
| `→` | Neutral / continuing: no clear success or failure (e.g., data probing, setup) |

Outcome markers are optional. Omit them for iterations where success/failure
is not meaningful (e.g., pure data printing). When present, they enable
at-a-glance scanning of the trajectory's success pattern: a run of `✗✗✗✗✓`
immediately shows "four failures then a breakthrough."

### Hypothesis Log

The Hypothesis Log is a **new section** that tracks the agent's evolving
understanding of the problem. It sits between Control Flow and Phase Analysis.

**When to include:** Always include for ARC tasks and any task where the agent
tests multiple distinct hypotheses or strategies. May be omitted for simple
tasks (e.g., single-strategy OOLONG counting) where the Control Flow section
alone captures the full story.

**Format:**

```markdown
## Hypothesis Log

| ID | Hypothesis | Iters | Outcome | Evidence |
|----|-----------|-------|---------|----------|
| H1 | [brief description] | [iter list] | rejected/accepted/abandoned | [key evidence] |
| H2 | ... | ... | ... | ... |
```

**Fields:**

| Field | Description |
|-------|-------------|
| ID | Short identifier: H1, H2, ... in order of first appearance |
| Hypothesis | One-line description of the hypothesis or strategy |
| Iters | Which iterations tested or developed this hypothesis |
| Outcome | `rejected` (disproven), `accepted` (adopted for final answer), `abandoned` (dropped without clear disproof, e.g., due to deadline), `superseded` (replaced by a more specific hypothesis) |
| Evidence | Key quantitative evidence (e.g., "100% train match", "13/36 cells") |

**Optional summary line:** After the table, add a one-line **Hypothesis arc**
showing the progression:

```
**Hypothesis arc:** H1→H2→H3(abandoned)→H4(breakthrough)→H5(refinement of H4)
```

This enables quick statistical queries like:
- How many hypotheses were tested before the accepted one?
- What fraction of iterations were spent on ultimately-rejected hypotheses?
- Did the agent abandon a correct hypothesis and return to it later?

### Pattern Vocabulary

These are **seed terms**, not a closed set. Use them when they fit.
When the trace shows a pattern not listed here, **coin a new term** —
use the same style (lowercase-kebab-case, short, descriptive) and
define it inline in the annotation. Novel patterns are a finding, not
an error.

**Context management — how the RLM interacts with its data:**

| Pattern             | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `filtering`         | Used regex/code to narrow context before processing                 |
| `chunking`          | Split data into chunks for batch processing                         |
| `sampling`          | Inspected a subset of data to infer properties of the whole         |
| `context-windowing` | Strategically sliced large context to fit processing limits         |
| `format-discovery`  | Spent iteration(s) determining data format (JSON? CSV? plain text?) |
| `jq-on-plaintext`   | Wasted iteration(s) trying jq/JSON.parse on plain text              |
| `...`               | Any other context management pattern you think is relevant          |

**Delegation — how work is distributed:**

| Pattern                 | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `delegation-rlm`        | Used rlm() for recursive sub-calls with iteration capability            |
| `delegation-lightweight` | Used rlm() with small maxIterations for one-shot fan-out (classification, extraction) |
| `parallel-fanout`       | Promise.all() over multiple rlm() calls                                 |
| `sequential-delegation` | Chained delegation calls where each depends on the prior                |
| `prompt-crafting`       | Invested significant effort designing the prompt for a child call       |
| `over-delegation`       | Delegated a task that would have been simpler to compute directly       |
| `under-delegation`      | Ground through manually when a delegation would have been faster/better |
| `...`                   | Any other delegation pattern you think is relevant                      |

**Reasoning and iteration — how the RLM thinks through the problem:**

| Pattern                  | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `multi-strategy`         | Tried multiple approaches before finding one that works                 |
| `backtracking`           | Abandoned an approach after partial progress, started over              |
| `incremental-refinement` | Iteratively improved an answer across multiple iterations               |
| `variable-stitching`     | Built answer incrementally across iterations using persistent variables |
| `brute-force`            | Enumerated possibilities rather than computing analytically             |
| `heuristic-shortcut`     | Guessed or estimated based on partial evidence                          |
| `hypothesis-churn`       | Rapidly tested and discarded many hypotheses without depth              |
| `...`                    | Any other reasoning pattern you think is relevant                       |

**Quality control — how the RLM validates its work:**

| Pattern                  | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `verification`           | Explicitly verified answer before returning                               |
| `cross-verification`     | Verified via a second independent method (e.g., code count vs. delegation count) |
| `redundant-verification` | Verified the same thing 3+ times without new information                  |
| `self-correction`        | Detected own error in output and fixed it in a subsequent iteration       |
| `error-recovery`         | Recovered from a runtime error (syntax, exception, API failure)           |
| `no-verification`        | Returned without any verification step                                    |
| `...`                    | Any other quality control pattern you think is relevant                   |

**Other:**

| Pattern | Description                             |
| ------- | --------------------------------------- |
| `...`   | Any other pattern you think is relevant |

### Failure Mode Vocabulary

Same principle: **seed terms, not a closed set.** If the trace shows a
failure mode not listed here, name it. The synthesizer needs to discover
the full taxonomy — limiting annotators to known modes defeats the purpose.

**Counting and computation errors:**

| Mode                 | Description                                        |
| -------------------- | -------------------------------------------------- |
| `hallucinated-count` | Returned a number not supported by the computation |
| `off-by-one`         | Count off by exactly 1 (boundary/fence-post error) |
| `aggregation-error`  | Sub-results were correct but combined incorrectly  |
| `regex-too-broad`    | Regex matched unintended strings, inflating count  |
| `regex-too-narrow`   | Regex missed valid matches, deflating count        |
| `type-confusion`     | Treated string as number, array as object, etc.    |
| `...`                | Any other counting error you think is relevant     |

**Reasoning errors:**

| Mode                       | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `wrong-direction`          | Got comparison direction backwards (more vs. less)                   |
| `wrong-label`              | Returned incorrect label/category                                    |
| `abandoned-correct-answer` | Had correct answer in an earlier iteration but discarded/overrode it |
| `premature-return`         | Returned before sufficient evidence was gathered                     |
| `anchoring`                | Locked onto an early (wrong) estimate and couldn't revise            |
| `sampling-bias`            | Drew conclusion from non-representative subset of data               |
| `catastrophic-forgetting`  | Lost track of earlier findings due to long conversation              |
| `hypothesis-churn`         | Cycled through hypotheses too quickly to evaluate any properly       |
| `...`                      | Any other reasoning error you think is relevant                      |

**Formatting and protocol errors:**

| Mode                        | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `format-mismatch`           | Right answer, wrong format (not extracted from wrapper) |
| `unawaited-delegation`      | Called rlm() without await — result silently lost       |
| `multi-block-hallucination` | Generated fabricated output between code blocks         |
| `...`                       | Any other formatting error you think is relevant        |

**Infrastructure and limits:**

| Mode                      | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `timeout`                 | Hit maxIterations without returning                                |
| `api-error`               | MALFORMED_FUNCTION_CALL or other API-level failure                 |
| `spinning`                | Made no meaningful progress across 3+ iterations (stuck in a loop) |
| `delegation-context-loss` | Child agent lacked context needed to do its job                    |
| `...`                     | Any other infrastructure failure you think is relevant             |

**Other:**

| Mode  | Description                                  |
| ----- | -------------------------------------------- |
| `...` | Any other failure mode you think is relevant |

### Verdict Values

| Verdict          | Meaning                                 |
| ---------------- | --------------------------------------- |
| `perfect`        | score == 1.0                            |
| `partial-credit` | 0 < score < 1.0 (numeric proximity)     |
| `wrong-answer`   | score == 0, returned an answer          |
| `timeout`        | Hit maxIterations, no return            |
| `error`          | API/infrastructure error                |
| `...`            | Any other verdict you think is relevant |

### Other

| Other | Description                                                   |
| ----- | ------------------------------------------------------------- |
| `...` | Any other field from any other category you think is relevant |

---

## Upgrade Guide from v1

The following changes were made to the format. All are backward-compatible
(existing v1 annotations remain valid).

### New: Sub-phase tags on control flow lines

**Before:** `iter 3  EXPLORE   test 180-degree rotational symmetry`
**After:** `iter  3  EXPLORE:hyp-test  [H1] ✗  test 180-degree rotational symmetry — 30% match`

The coarse phase (`EXPLORE`) is unchanged. The sub-phase (`:hyp-test`) and
hypothesis link (`[H1]`) are additive. Existing tools that parse only the
phase column will still work.

### New: Outcome markers on control flow lines

The symbols `✓`, `✗`, `~`, `→` after the hypothesis tag (or after the phase
if no hypothesis tag) indicate per-iteration outcome. These enable scanning
for patterns like "five failures then a breakthrough" without reading the
descriptions.

### New: Hypothesis Log section

A structured table between Control Flow and Phase Analysis that tracks
hypotheses as first-class entities. Enables cross-run queries like:
- "How many hypotheses does the agent typically test before finding the right one?"
- "What % of iterations are spent on rejected hypotheses?"
- "Does the agent ever return to a previously-rejected hypothesis?"

### New: Computed frontmatter fields

Optional fields like `hypothesesTested`, `breakthroughIter`, `itersExplore`,
etc. enable cross-run statistical queries without parsing prose sections.

### Unchanged

- YAML frontmatter fields and types
- Pattern and failure mode vocabularies (new seed terms added, none removed)
- Phase Analysis, Root Cause, and What Would Have Helped sections
- All existing phase labels (EXPLORE, PLAN, FILTER, EXTRACT, DELEGATE, VERIFY, ERROR, RETURN, STALL)

---

## Scaling Guidance

The v2 format has more expressive power than v1, but not every trajectory
needs every feature. Scale the annotation complexity to the trajectory:

**Simple trajectory (5-10 iters, single strategy, OOLONG/S-NIAH):**
- Sub-phases: use them, they're cheap and always add value
- Hypothesis log: omit or keep minimal (1-2 entries)
- Outcome markers: include on key iterations, omit on trivial ones
- Computed frontmatter: omit most fields, keep `itersExplore`/`itersExtract`

**Complex trajectory (15-20 iters, multi-hypothesis, ARC):**
- Sub-phases: use them on every line
- Hypothesis log: required; include all hypotheses
- Outcome markers: include on every line
- Computed frontmatter: include all fields
- Hypothesis arc: include

**Successful trajectory (score=1, clean execution):**
- The format should still capture what the agent did right. Sub-phases
  and outcome markers (`→→→→✓✓✓✓✓`) show the efficient progression.
- Hypothesis log may have only 1-2 entries if the agent found the right
  approach quickly. That is itself a useful data point.

**Failure trajectory (score=0, many dead ends):**
- Full hypothesis log is critical for understanding what went wrong.
- The `itersOnRejectedHypotheses` computed field is the single most
  useful metric for identifying inefficient search behavior.
- Mark `STALL` phases explicitly; they are the format's strongest signal
  for "wasted work."
