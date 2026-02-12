# Annotated Trajectory Format

This is the canonical format for an annotated RLM trajectory.
Written by an LLM analyst, consumed by an LLM synthesizer.

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

iter 1 EXPLORE probe context type and length
iter 2 EXPLORE log first 500 chars, discover plain-text format
iter 3 FILTER grep for target label using regex
iter 4 ERROR jq parse attempt fails (not JSON)
iter 5 FILTER switch to line-by-line string matching
iter 6 EXTRACT count matches via .filter().length
iter 7 VERIFY log count, get 65
iter 8 VERIFY re-count with different regex, still 65
iter 9 EXTRACT try llm() fan-out classification
iter 10 EXTRACT aggregate llm() results, get 63
iter 11 RETURN return("65") — chose code count over llm count

```

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
**Strategy:** Re-counted with different regex, then tried llm() fan-out
**Result:** Code said 65, llm() said 63. Neither matched expected 64.
**Assessment:** Good instinct to cross-verify, but both methods were inaccurate.

### Phase 5: Return (iter 11)
**Decision:** Trusted code count (65) over llm() count (63).
**Assessment:** Reasonable heuristic — code counts are usually more reliable than llm() estimates. But the regex was wrong.

## Root Cause
The counting regex was slightly over-inclusive. The label "entity" also matched partial occurrences in phrases like "entity-related". A word-boundary regex (`\bentity\b`) would have yielded the correct count.

## What Would Have Helped
1. **Plugin: structured-data-aggregation** — provides the chunked llm() map-reduce pattern
2. **Word-boundary regex** — explicit `\b` anchors in the grep pattern
3. **Sanity check** — comparing code count to total lines would reveal the off-by-one
```

---

## Field Reference

### YAML Frontmatter (required fields)

| Field       | Type     | Description                                             |
| ----------- | -------- | ------------------------------------------------------- | ------------------------------------------- |
| taskId      | string   | e.g. "oolong-14000016"                                  |
| score       | number   | 0-1 from scoring function                               |
| iterations  | number   | Total REPL iterations                                   |
| wallTimeMs  | number   | Wall-clock milliseconds                                 |
| answerType  | string   | ANSWER_TYPE.NUMERIC, ANSWER_TYPE.COMPARISON, etc.       |
| taskGroup   | string   | TASK_TYPE.NUMERIC_ONE_CLASS, TASK_TYPE.COMPARISON, etc. |
| answer      | string   | What the RLM returned                                   |
| expected    | string   | Ground truth                                            |
| error       | string   | null                                                    | Error message if task errored               |
| patterns    | string[] | Behavioral patterns observed (see vocabulary below)     |
| failureMode | string   | null                                                    | Primary failure mode (see vocabulary below) |
| verdict     | string   | perfect, partial-credit, wrong-answer, timeout, error   |

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
| `delegation-llm`        | Used llm() for one-shot fan-out (classification, extraction)            |
| `parallel-fanout`       | Promise.all() over multiple llm()/rlm() calls                           |
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
| `...`                    | Any other reasoning pattern you think is relevant                       |

**Quality control — how the RLM validates its work:**

| Pattern                  | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `verification`           | Explicitly verified answer before returning                               |
| `cross-verification`     | Verified via a second independent method (e.g., code count vs. llm count) |
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
| `...`                      | Any other reasoning error you think is relevant                      |

**Formatting and protocol errors:**

| Mode                        | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `format-mismatch`           | Right answer, wrong format (not extracted from wrapper) |
| `unawaited-delegation`      | Called rlm()/llm() without await — result silently lost |
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

### Control Flow Line Format

```
iter N  PHASE       brief description
```

The phase is the **primary activity** of that iteration. Seed phases:

| Phase      | When to use                                                                 |
| ---------- | --------------------------------------------------------------------------- |
| `EXPLORE`  | Probing data: typeof, length, slicing, format detection                     |
| `PLAN`     | Reasoning about strategy without executing code, or minimal diagnostic code |
| `FILTER`   | Narrowing data: grep, regex, split, slice for relevant subset               |
| `EXTRACT`  | Computing the answer: counting, classifying, aggregating                    |
| `DELEGATE` | Primary activity is launching/collecting rlm() or llm() calls               |
| `VERIFY`   | Checking a candidate answer via re-computation or cross-method              |
| `ERROR`    | Iteration dominated by handling/recovering from an error                    |
| `RETURN`   | Calling return() with the final answer                                      |
| `STALL`    | No meaningful progress — repeated prior work or went in circles             |
| `...`      | Any other phase you think is relevant                                       |

As with patterns, coin a new phase label if needed. Use ALLCAPS, short.

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
