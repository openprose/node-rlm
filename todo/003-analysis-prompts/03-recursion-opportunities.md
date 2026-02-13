# Recursion Opportunities Analysis

**Agent**: Opus 4.6
**Output file**: `eval/analyses/003-opus-arc-feb13/recursion-opportunities.md`

---

You are analyzing ARC-AGI-2 trajectory data and the RLM codebase to find specific, targeted opportunities where recursive delegation (spawning child agents via `rlm()`) could genuinely help improve task performance.

## Context

This is the node-rlm project at /home/user/node-rlm — a Recursive Language Model agent. The key capability is that an agent can spawn child agents via `await rlm(prompt, {model, maxIterations, maxDepth})`. Currently, most ARC solving happens in a single flat loop without recursion.

### Key Files to Read

**Trajectories** (read ALL of these — they show actual solving behavior):
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-022/trajectories/` — 19 trajectory files, WITH arc-solver.md plugin
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-023/trajectories/` — 20 trajectory files, WITHOUT arc-solver.md plugin

**Architecture** (understand how recursion works):
- `/home/user/node-rlm/src/rlm.ts` — Core RLM loop, the `rlm()` function, delegation logic, depth limits
- `/home/user/node-rlm/src/system-prompt.ts` — System prompts, `buildChildRepl()` for child agents
- `/home/user/node-rlm/src/environment.ts` — VM sandbox, available globals

**Plugins** (understand current solving strategies):
- `/home/user/node-rlm/plugins/apps/arc-solver.md` — ARC solving protocol (v0.3.0)
- `/home/user/node-rlm/plugins/apps/recursive-delegation-strategy.md` — Existing recursion strategy plugin
- `/home/user/node-rlm/plugins/apps/structured-data-aggregation.md` — Data aggregation pattern
- All driver plugins in `/home/user/node-rlm/plugins/drivers/`

**Results** (understand what's working and what isn't):
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-022/analysis.txt`
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-023/analysis.txt`
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-022/results/aggregate.json`
- `/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/run-023/results/aggregate.json`

**Previous analysis** (learnings from earlier runs):
- `/home/user/node-rlm/eval/analyses/002-arc-benchmark/opus-trajectory-analysis.md`
- `/home/user/node-rlm/eval/analyses/002-arc-benchmark/README.md`

## Your Task

### 1. Read all trajectories thoroughly

Read ALL ~39 trajectory files across both runs. Look specifically for:
- Places where the model gets stuck testing one hypothesis at a time when it could test multiple in parallel
- Places where the model wastes iterations on a dead-end approach before pivoting
- Places where the model successfully solved a task but spent too many iterations
- Complex tasks where breaking down the problem into sub-problems would help
- Moments where independent verification of a candidate solution would add value
- Cases where the model's approach is correct but implementation is buggy

### 2. Identify specific, targeted recursion opportunities

For each opportunity, describe:
- **The pattern**: What specific situation in the trajectory suggests recursion would help?
- **The proposed recursion**: What would the parent delegate to the child? What model? What depth/iterations?
- **The expected benefit**: Why is this better than the flat loop?
- **The risk**: What could go wrong? Would this waste budget?
- **Evidence**: Which specific task trajectories demonstrate this pattern? Quote relevant parts.

### 3. Consider model choice

- When should recursion use the same model (Opus 4.6)?
- When might a cheaper/faster model suffice (Sonnet 4.5, Haiku)?
- What's the cost tradeoff?

### 4. Be selective and honest

Be brutally honest about:
- Which ideas are genuinely helpful vs. forced
- Which ideas sound good in theory but wouldn't actually help given the trajectory evidence
- The actual cost/benefit tradeoff (more iterations spent on delegation = fewer for main agent)

## Output

Write your analysis to:
`/home/user/node-rlm/eval/analyses/003-opus-arc-feb13/recursion-opportunities.md`

Structure it as:
1. Executive summary (what you found)
2. Detailed opportunity descriptions (the specific patterns)
3. Anti-patterns (recursion that WOULDN'T help, with evidence)
4. Model selection guidance
5. Implementation recommendations (what to change in arc-solver.md, system prompt, or harness)

Reference specific task IDs, iteration numbers, and quote actual trajectory content as evidence.
