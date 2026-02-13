# ARCgentica Research Findings

## Project Overview

**ARCgentica** (by Symbolica AI) is an agentic system for solving ARC-AGI challenges using LLMs. It achieved **85.28% (102.3/120)** on ARC-AGI-2 Public Eval using Claude Opus 4.6 (120k) at $6.94/task.

- **Repository**: `https://github.com/symbolica-ai/arcgentica`
- **License**: MIT
- **Language**: Python 3.12
- **LLM Platform**: Built on top of `symbolica-agentica` SDK (version 0.4.0), with a separate `agentica-server` providing the execution environment.

---

## Project Structure

```
arcgentica/
  arc_agent/               # Core agent module
    __init__.py            # Exports Agent, prompts, types
    agent.py               # Agent class - spawns sub-agents via Agentica SDK
    prompts.py             # INITIAL_PROMPT and AGENT_PROMPT (sub-agent prompt)
    types.py               # Input, Output, Example, FinalSolution, accuracy/soft_accuracy
  data/
    arc-prize-2024/        # 2024 evaluation data
    arc-prize-2025/        # 2025 evaluation data (challenges + solutions)
  output/
    2025/anthropic/claude-opus-4-6/final/
      config.json          # Run configuration
      results/<problem_id>/attempt_0.json, attempt_1.json
      logs/<problem_id>/<attempt_id>/<try_num>/agent-0.log, agent-1.log, ...
  main.py                  # Entry point - orchestrates solving all problems
  solve.py                 # Core solve logic - attempts, evaluation, code execution
  score.py                 # Scoring logic (pass@2)
  summary.py               # Token usage and cost analysis
  submit.py                # Kaggle submission file generator
  common.py                # Config, Problem, Solution, Attempt dataclasses
  pyproject.toml           # Dependencies
```

---

## Architecture

### How the Agent Loop Works

ARCgentica uses a **hierarchical multi-agent architecture** built on the Agentica SDK. Here is the flow:

1. **Orchestrator** (`main.py`): Loads all 120 ARC problems, creates asyncio tasks with a semaphore for concurrency control (default: 60 concurrent problems).

2. **Problem Attempt** (`solve.py`): For each problem, `num_attempts` (default: 2) independent attempts run in parallel. Each attempt:
   - Creates a fresh `Agent` instance
   - Calls `agent.call_agent(INITIAL_PROMPT, FinalSolution, examples=..., challenges=...)`
   - The agent interacts with a Python REPL via the Agentica server
   - The agent can spawn up to `max_num_agents` (default: 10) sub-agents
   - On completion, the returned `FinalSolution.transform_code` is evaluated against training and test inputs
   - If a transient error occurs (e.g., OpenAI content filter), retries up to `num_retries` (default: 3) times

3. **Agent Execution** (`arc_agent/agent.py`):
   - Uses `agentica.spawn()` to create agents with a Python REPL
   - The REPL scope includes: `numpy`, `skimage`, `scipy`, `sympy`, plus ARC-specific helpers (`accuracy`, `soft_accuracy`, `example_to_diagram`, data types, and `call_agent`)
   - The first agent gets `INITIAL_PROMPT`; sub-agents get `AGENT_PROMPT` wrapping their delegated task
   - Agents write Python code in `<python>` blocks, which execute in the REPL, then see results
   - This is an iterative loop: agent writes code -> sees output -> writes more code -> ...
   - Each inference step produces a `<usage>` block in the log

4. **Sub-Agent Delegation**:
   - The main agent can call `await call_agent(task_description, return_type, **objects)` to spawn sub-agents
   - Sub-agents can themselves spawn further sub-agents (recursive)
   - Parallel delegation uses `asyncio.gather(call_agent(...), call_agent(...), ...)`
   - Each sub-agent gets the `AGENT_PROMPT` template with the parent's task description injected
   - Sub-agents can return `FinalSolution`, `str` (for analysis), or other types

5. **Code Evaluation** (`solve.py`):
   - The final `transform_code` is written to a temp file and run as a subprocess
   - Each test input is piped via stdin as JSON
   - Timeout of 5 seconds per execution
   - Output is parsed as JSON and compared to ground truth

6. **Scoring** (`score.py`):
   - Uses pass@2: for each test case, checks if either of the first 2 successful attempt outputs matches truth
   - A problem's score = (number of test cases matched) / (total test cases)
   - This means a problem with 2 test cases where only 1 matches gets 0.5 credit

### Key Design Decisions

- **No explicit iteration/retry within the agent**: The agent loop is entirely handled by the Agentica SDK's REPL interaction. The agent writes code, sees results, refines -- this IS the iteration.
- **No tool use beyond Python REPL**: The only "tool" is executing Python code. No web search, no file system access, no special ARC tools.
- **Sub-agent delegation for hypothesis exploration**: The main innovation is using sub-agents to explore multiple hypotheses in parallel.
- **Caching**: Uses 1-hour cache TTL for agent prompts (`cache_ttl="1h"`), which drastically reduces costs.
- **Reasoning effort**: The final run used `"high"` reasoning effort (not `"xhigh"` as in the defaults).

---

## Prompts

### INITIAL_PROMPT (given to the main agent)

See `prompts.md` for full text. Key elements:
- Role: "expert in solving ARC tasks by writing Python code"
- 5-step process: Analyze Examples -> Formulate Hypothesis -> Implement Code -> Test and Refine -> Output
- Emphasizes using `scipy.ndimage.label` for object identification
- Explicit guidance on generalization (orientation/direction/shape, avoid arbitrary constants)
- Shows how to use `call_agent` for parallel hypothesis exploration
- Requires returning `FinalSolution` with `transform_code` and `explanation`

### AGENT_PROMPT (given to sub-agents)

See `prompts.md` for full text. Key elements:
- Role: "expert in solving sub-tasks of ARC problems"
- Injects the parent's task description
- Provides ARC background context
- Guidelines: focus on sub-task, use numpy/skimage/scipy/sympy, can further delegate
- Must wait for code execution before writing next code block

### How Prompts Are Delivered

The prompt is wrapped in an XML structure by the Agentica SDK:
```xml
<message role="user<None>">
  <instructions>
    <task>...</task>
    <additional-python-resources>
      examples: list = [...]
      challenges: dict = {...}
    </additional-python-resources>
    <expected-return-type>FinalSolution</expected-return-type>
  </instructions>
</message>
```

The agent's REPL scope pre-populates `examples` and `challenges` as Python objects (not just text descriptions).

---

## Trajectory Format

### Log Files (Trajectories)

Located at: `output/2025/anthropic/claude-opus-4-6/final/logs/<problem_id>/<attempt_id>/<try_num>/agent-N.log`

Format: XML-like text file with alternating messages:

```
<message role="user<None>">
  <instructions>
    <task>... PROMPT TEXT ...</task>
    <additional-python-resources>... DATA ...</additional-python-resources>
    <expected-return-type>...</expected-return-type>
  </instructions>
</message>
<message role="agent">
  <reasoning>... AGENT THINKING ...</reasoning>
  <python>... CODE ...</python>
  <usage>{ ... TOKEN USAGE JSON ... }</usage>
</message>
<message role="user<execution>">
  ... EXECUTION OUTPUT ...
</message>
<message role="agent">
  ... NEXT CODE BLOCK ...
</message>
... repeating ...
```

Key fields in each trajectory:
- `<reasoning>`: Agent's thinking before writing code
- `<python>`: Python code executed in the REPL
- `<usage>`: JSON with input_tokens, output_tokens, cached_tokens, cache_creation, etc.
- `role="user<execution>"`: Output from REPL execution
- The number of `<usage>` blocks = number of inference iterations

### Result Files

Located at: `output/2025/anthropic/claude-opus-4-6/final/results/<problem_id>/attempt_N.json`

JSON format with fields:
- `train_results`: list of `{success, output, soft_score, error, code}` for each training example
- `test_results`: list of `{success, output, soft_score, error, code}` for each test input
- `agent_usage`: list of `{input_tokens, output_tokens, cached_tokens, ...}` per agent
- `time_taken`: seconds
- `num_agents_used`: count of agents (1 = main only, 2+ = with sub-agents)
- `model`: "anthropic/claude-opus-4-6"
- `reasoning_effort`: "high"
- `error`: null or error string
- `problem_id`, `attempt_id`, `num` (try number), `iteration` (inference iterations for agent-0)

---

## Run Configuration (Final 85.28% Run)

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

---

## Score Breakdown

### Overall
- **Score: 102.3 / 120 (85.3%)**
- 120 problems evaluated, all have 2 attempts
- Fractional scoring: some problems get partial credit (e.g., 0.5 if only 1 of 2 test cases match)

### Per the README's published statistics:
```
Score:  102.3 / 120 (85.3%)
Cached input tokens: 3,819,432.5 / task
Non-cached input tokens: 84.5 / task
Cache write (5m) tokens: 0.0 / task
Cache write (1h) tokens: 179,711.6 / task
Output tokens: 129,476.5 / task
Cost per task: $6.9442
Number of agents used: 2.6 / task
Min time: 98.4s
Mean time: 1511.9s (25.2 min)
Median time: 1154.7s (19.2 min)
Max time: 7251.8s (120.9 min)
```

### Failed Problems (21 problems not fully correct):
```
2b83f449, 35ab12c3, 4c7dc4dd, 4e34c42c, 581f7754, 7b80bb43, 800d221b,
88e364bc, 9bbf930d, a32d8b75, abc82100, b5ca7ac4, b6f77b65, c7f57c3e,
d35bdbdc, da515329, dbff022c, de809cff, dfadab01, f560132c, faa9f03d
```

99 problems fully correct (all test cases match), with 3 problems getting partial credit to reach 102.3.

---

## Our 20 Problems: Matching Trajectories

All 20 of our eval problem IDs have trajectories and results in the ARCgentica output. See `matched-trajectories.md` for details.

**Summary: 19/20 fully passed, 1 partially passed (4e34c42c got 0.5 credit)**

---

## Key Differences from Our Approach

1. **Agent platform**: They use a custom Agentica SDK with a dedicated server (`agentica-server`) that provides Python REPL sandboxing and LLM inference management. We use Claude Code / custom RLM.

2. **Sub-agent delegation**: Their core innovation is hierarchical sub-agent spawning via `call_agent()`. The main agent can spawn up to 10 sub-agents in parallel to explore hypotheses. Sub-agents can further delegate. This is similar to our delegation concept but more formalized.

3. **Single tool only**: Their only tool is a Python REPL. No browser, no file system, no search. The REPL has numpy, scipy, skimage, sympy pre-loaded.

4. **Code generation + execution loop**: The agent writes Python code, sees output, iterates. This is the entire strategy -- no separate "thinking" vs "acting" phases.

5. **pass@2 scoring**: They run 2 independent attempts per problem and take the best result. This doubles compute but significantly improves scores.

6. **No explicit strategy/driver prompts**: There is only one system prompt (`INITIAL_PROMPT`) and one sub-agent template (`AGENT_PROMPT`). No task-specific prompts, no strategy selection, no driver framework.

7. **Prompt structure**: Their prompt emphasizes:
   - Using `scipy.ndimage.label` for object detection
   - Generalization checking against challenge inputs
   - Avoiding arbitrary constants
   - Hypothesis testing via sub-agents

8. **Reasoning effort**: They use "high" (not "xhigh") reasoning effort, suggesting diminishing returns at higher effort levels.

9. **Cost**: $6.94/task is relatively expensive. Heavy use of prompt caching (1-hour TTL) brings this down significantly.

10. **No training/fine-tuning**: This is pure prompting + code execution. No model training, no fine-tuning, no few-shot learned strategies.
