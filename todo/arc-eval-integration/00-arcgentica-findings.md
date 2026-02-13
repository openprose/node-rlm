# Arcgentica Findings

Exhaustive documentation of what Symbolica AI's arcgentica project does, how it works, and what results it achieved.

## What Benchmark Did They Run?

- **Benchmark:** ARC-AGI-2 (the 2025 version of the ARC challenge)
- **Split:** Public Evaluation set
- **Dataset:** `arc-prize-2025` (120 tasks)
- **Source files:**
  - `data/arc-prize-2025/arc-agi_evaluation_challenges.json` (984 KB, 120 tasks)
  - `data/arc-prize-2025/arc-agi_evaluation_solutions.json` (224 KB, 120 solutions)
- They also include the ARC-AGI 2024 data (`data/arc-prize-2024/`, 400 tasks) for the `--challenge 2024` option, but the headline result is on the 2025 evaluation set.

## Dataset Format

Each task in `arc-agi_evaluation_challenges.json` is a JSON object keyed by task ID (8-char hex string). Structure:

```json
{
  "0934a4d8": {
    "train": [
      {
        "input": [[3, 5, 3, ...], [5, 3, 3, ...], ...],   // 2D grid of ints 0-9
        "output": [[9, 9, 6, 4], [2, 6, 9, 4], ...]       // 2D grid of ints 0-9
      },
      // ... more training examples (typically 2-5)
    ],
    "test": [
      {
        "input": [[4, 4, 1, ...], [4, 4, 3, ...], ...]    // 2D grid, no output provided
      }
      // ... typically 1 test case
    ]
  }
}
```

Solutions file maps task IDs to arrays of output grids:

```json
{
  "0934a4d8": [
    [[7, 7, 9], [7, 2, 9], ...]   // Expected output for test[0]
  ]
}
```

Grid dimensions vary widely per task (e.g., 5x5, 15x15, 30x30). Each cell is an integer 0-9 representing a color. The ARC-AGI-2 evaluation set has 120 tasks, most with 1 test input.

## What Model(s) Did They Test?

Supported models (from `main.py --model` choices):
- `openai/gpt-5.2`
- `anthropic/claude-opus-4-5`
- `anthropic/claude-opus-4-6` (default)

The headline 85.28% result was achieved with **`anthropic/claude-opus-4-6`**.

## Exact Configuration for the 85.28% Run

From `output/2025/anthropic/claude-opus-4-6/final/config.json`:

```json
{
  "model": "anthropic/claude-opus-4-6",
  "max_num_agents": 10,
  "timeout_s": 5,
  "num_attempts": 2,
  "reasoning_effort": "high",
  "num_retries": 3
}
```

### Parameter Details

| Parameter | Value | Description |
|:---|:---|:---|
| `model` | `anthropic/claude-opus-4-6` | The LLM used for all agents |
| `max_num_agents` | `10` | Maximum sub-agents each initial agent can spawn |
| `timeout_s` | `5` | Timeout in seconds for executing generated Python code |
| `num_attempts` | `2` | Independent attempts per problem |
| `reasoning_effort` | `high` | Reasoning effort level (`low`, `medium`, `high`, `xhigh`) |
| `num_retries` | `3` | Retries per attempt on transient errors |
| `max_concurrent` | `60` | Max problems solved concurrently (CLI default, not in config.json) |

**Note:** The `reasoning_effort` in the config is `"high"` (NOT `"xhigh"`), and the README default is `"xhigh"`. The actual published result used `"high"`.

## Architecture: How Arcgentica Works

Arcgentica uses the **Agentica** framework (`symbolica-agentica==0.4.0`) to create an agentic system where:

1. **Initial Agent** receives the ARC problem (training examples + test challenges) along with the `INITIAL_PROMPT`
2. The agent has access to a Python REPL with `numpy`, `scipy`, `skimage`, `sympy`
3. The agent can **spawn sub-agents** via `call_agent()` for parallel hypothesis exploration
4. Each sub-agent gets the `AGENT_PROMPT` (a condensed version of the initial prompt)
5. The final output is a `FinalSolution` object containing:
   - `transform_code`: A Python function `transform(grid: list[list[int]]) -> list[list[int]]`
   - `explanation`: Brief text explanation

### Key Properties of the Agent

- **Model routing:** Uses the Agentica server, which connects to Anthropic's API directly (not OpenRouter)
- **Cache TTL:** `1h` (1 hour prompt caching via Anthropic's ephemeral caching)
- **REPL scope:** Pre-loaded with `soft_accuracy`, `accuracy`, `example_to_diagram`, `Output`, `Example`, `Input`, `FinalSolution`, `call_agent`, plus `numpy`, `skimage`, `scipy`, `sympy`
- **Delegation:** Sub-agents can themselves call `call_agent()`, creating a tree of agents

### The Solving Process (per problem)

1. For each problem, `num_attempts` (2) independent attempts run concurrently
2. Each attempt:
   a. Creates an Agent with the REPL scope
   b. Sends the `INITIAL_PROMPT` with training examples and test challenges
   c. Agent writes and tests Python `transform` functions against training examples
   d. Agent may spawn sub-agents to explore hypotheses in parallel
   e. Returns a `FinalSolution` with `transform_code`
3. The `transform_code` is executed on all training inputs (to verify) and all test inputs (to produce answers)
4. Execution is sandboxed in a subprocess with a 5-second timeout
5. If an attempt fails (error), it retries up to `num_retries` (3) times

## Prompts

### Initial Prompt (for the root agent)

The full prompt is at `arc_agent/prompts.py::INITIAL_PROMPT`. Key instructions:

- "You are an expert in solving Abstract Reasoning Corpus (ARC) tasks by writing Python code"
- Analyze examples: identify objects using `scipy.ndimage.label`, determine relationships, identify transformations
- Formulate hypotheses: prioritize simpler rules, check generalization to challenges
- Avoid arbitrary constants tuned to training examples
- Consider orientation/direction/shape generalization
- Implement `transform(grid: list[list[int]]) -> list[list[int]])`
- May use `numpy`, `skimage`, `scipy`, `sympy`
- Can spawn sub-agents for parallel hypothesis exploration
- Must test using `soft_accuracy` and `accuracy` functions
- Return a `FinalSolution` object

### Sub-Agent Prompt

`AGENT_PROMPT` is a template with `{task}` placeholder. Gives background on ARC problems and guidelines for focused sub-task completion.

## Scoring Methodology

### Pass@2 Scoring

The scoring is **pass@2** -- for each test input, the system selects the first 2 non-errored output grids from across all attempts, and checks if **either** matches the ground truth.

From `score.py::pass_at_two()`:

```python
def pass_at_two(selected_outputs, true_outputs):
    correct = 0
    for i, truth in enumerate(true_outputs):
        first, second = selected_outputs[i]
        if (first is not None and first == truth) or (second is not None and second == truth):
            correct += 1
    return correct / max(len(true_outputs), 1)
```

### Grid Comparison

Grid comparison is **exact match** -- the predicted grid must have the same shape AND identical element values as the ground truth:

```python
def accuracy(pred, truth):
    truth_arr = np.array(truth.output.grid)
    pred_arr = np.array(pred.grid)
    success = bool(pred_arr.shape == truth_arr.shape and np.array_equal(pred_arr, truth_arr))
    return 1.0 if success else 0.0
```

No partial credit in the final scoring. (There is a `soft_accuracy` function used during agent development that computes element-wise accuracy, but this is not used for final scoring.)

### Output Selection

From `score.py::select_two_outputs()`:
- For each test input, iterate through attempts in order
- Take the first 2 non-errored, non-empty output grids
- These become the two "attempts" for pass@2

## Published Results

### Headline: 85.28% on ARC-AGI-2 Public Evaluation

From the README and output data:
- **Score:** 102.3 / 120 (85.3% -- reported as 85.28%)
- **120 problems** in the evaluation set
- **119 problems** produced at least one non-empty submission
- **2 attempts per problem** (pass@2)

### Cost and Performance Per Task

From `summary.py` output format (with Opus 4.6 pricing):

| Metric | Value |
|:---|:---|
| Cached input tokens (avg/task) | 3,819,432.5 |
| Non-cached input tokens (avg/task) | 84.5 |
| Cache write (5m) tokens (avg/task) | 0.0 |
| Cache write (1h) tokens (avg/task) | 179,711.6 |
| Output tokens (avg/task) | 129,476.5 |
| Cost per task | $6.94 |
| Number of agents used (avg) | 2.6 |

### Timing Per Task

| Metric | Value |
|:---|:---|
| Min time | 98.4s |
| Mean time | 1,511.9s (~25 min) |
| Median time | 1,154.7s (~19 min) |
| Max time | 7,251.8s (~2 hrs) |

### Token Pricing Used (Opus 4.6, Feb 2026)

From `summary.py`:

| Token Type | Price per Million |
|:---|:---|
| Input tokens | $5 |
| Cached input tokens | $0.50 |
| Cache write (5m) | $6.25 |
| Cache write (1h) | $10 |
| Output tokens | $25 |

### Sample Result Detail

For problem `0934a4d8`, attempt 0:
- 3 agents used (agent-0, agent-1, agent-2)
- 75 inference iterations for the primary agent
- Total input tokens: ~8.6M across 3 agents
- Total output tokens: ~132K across 3 agents
- Time: 1610.2 seconds
- All 4 training examples achieved soft_score=1.0
- 1 test result produced

## Arcgentica vs RLM (Reference Comparison)

These are different agent architectures solving the same benchmark. We are not replicating their agent — we're measuring ours on the same test.

| Aspect | Arcgentica | RLM |
|:---|:---|:---|
| Agent framework | Agentica (multi-agent Python) | RLM (JS REPL loop) |
| Code execution | Python subprocess + numpy/scipy | In-process JS sandbox |
| Sub-agents | Up to 10 per problem | Recursive `rlm()` calls |
| API routing | Direct Anthropic API (prompt caching) | OpenRouter |
| Scoring | pass@2 | pass@1 |

## Data Source

The ARC-AGI-2 data comes from:
- **GitHub:** https://github.com/arcprize/ARC-AGI-2 (official repository, individual JSON task files)
- **Kaggle:** https://www.kaggle.com/competitions/arc-prize-2025 (competition dataset, combined JSON files)
- The arcgentica repo includes pre-packaged combined JSON files in `data/arc-prize-2025/` with the standard Kaggle naming convention: `arc-agi_evaluation_challenges.json` and `arc-agi_evaluation_solutions.json`
