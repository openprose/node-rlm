# Delegation Reform Proposal

A comprehensive analysis of why the RLM model resists delegation, and concrete changes to make it use its recursive capabilities.

Based on analysis of:
- System prompt (`/Users/sl/code/trinity/node-rlm/src/system-prompt.ts`)
- Core loop (`/Users/sl/code/trinity/node-rlm/src/rlm.ts`)
- Environment (`/Users/sl/code/trinity/node-rlm/src/environment.ts`)
- Run-029 traces (parallel-decomposition driver, 0% full compliance)
- Arcgentica's prompt design (86% accuracy, 5/20 delegation rate)

---

## 1. Diagnosis

### 1.1 The model never considers delegation

Across 20 tasks in run-029, only 1 task (arc-36a08778) called `rlm()`. In 1 other task (arc-195c6913), the model mentioned delegation in its reasoning text three times ("Let me delegate this to a child agent") but never actually wrote an `rlm()` call. The remaining 18 tasks show zero evidence of delegation-related reasoning. The model does not consider delegation and reject it -- it simply never thinks about it.

### 1.2 Seven reinforcing causes

**Cause 1: The system prompt frames the agent as a solo problem-solver.**

The opening line sets identity:
```
You are an RLM (Reasoning Language Model) -- an LLM running inside a REPL loop.
```

The "How to Work" section (lines 33-43) describes a solo workflow:
```
1. Explore -- inspect the data.
2. Plan -- decide strategy. For large tasks, design a delegation structure.
3. Execute -- compute directly or delegate to children.
4. Verify -- console.log() your candidate answer.
5. Return -- only return(answer) after you have seen the correct value printed.
```

Step 2 mentions delegation only parenthetically: "For large tasks, design a delegation structure." This frames delegation as an edge case for unusually large tasks, not a default strategy. Steps 1, 3, 4, and 5 all describe solo actions. The word "directly" in step 3 makes solo execution the default and delegation the alternative.

**Cause 2: The delegation section is positioned as an advanced appendix.**

The system prompt has three sections:
- **Environment** (lines 9-32, 24 lines) -- core operational mechanics
- **How to Work** (lines 33-44, 12 lines) -- the workflow the model follows
- **Designing Delegation** (lines 45-76, 32 lines) -- delegation details

Delegation is the LAST section, appearing after the model has already internalized its identity and workflow. By the time the model reads delegation instructions, it has already committed to a solo mental model. This is a textbook case of primacy bias -- information presented first has disproportionate influence on behavior.

The system prompt is 5,609 characters total. The first mention of `rlm()` is on line 3, but it is a terse bullet point in the introduction:
```
- `await rlm(query, context?, { systemPrompt? })` -- a recursive call to another RLM...
  Powerful but expensive -- use wisely.
```

"Powerful but expensive -- use wisely" is an implicit discouragement. It frames delegation as a costly luxury, not a standard tool.

**Cause 3: The delegation section actively discourages recursive delegation.**

Lines 52-53:
```
Recursive delegation is powerful but expensive; each additional layer multiplies API costs.
Encourage children to work directly whenever possible.
```

This creates a strong aversion to delegation at any depth. The model reads "expensive," "multiplies API costs," and "prefer direct computation" and correctly infers that the system designer would rather it solve things itself.

**Cause 4: The model does not know child iterations are "free."**

The parent has 20 iterations. When it calls `rlm()`, a child gets 15 iterations at depth 1 (from the `iterationsForDepth` caps: `[Infinity, 15, 4, 3]`). But the system prompt never tells the parent how many iterations children get. The "Your Position" block says:
```
Iteration budget: 20 iterations (use them wisely).
Your children will be REPL agents at depth 1.
```

It does NOT say "Your children get 15 iterations each." The model must guess or assume children are constrained. Since the system prompt emphasizes cost ("expensive," "use wisely"), the model likely assumes delegation has a high opportunity cost.

Meanwhile, one parent iteration to launch children via `Promise.all` burns 1 of 20 parent iterations to unlock 30-45 child iterations. That is a 30:1 leverage ratio, but the model does not perceive it because it is never stated.

**Cause 5: The parallel-decomposition driver's escape clause was exploited.**

The driver explicitly says:
```
When NOT to use parallel decomposition:
- If the task has only 1-2 training examples
- If your Phase 1 analysis reveals an obvious single transformation
- If the task is simple enough to solve in < 5 iterations
```

Every ARC task begins ambiguously. The model cannot know at iteration 2 whether a task will take 5 iterations or 20. But the escape clause gives it blanket permission to skip delegation, and it took that permission 100% of the time. The driver made delegation optional; the model opted out.

**Cause 6: Twelve competing drivers diluted the delegation signal.**

Run-029 loaded 13 drivers total. Several of them actively conflict with delegation:
- `one-block-per-iteration` encourages sequential, focused execution
- `exploration-budget` pressures the agent to move quickly past analysis
- `verify-before-return` encourages the agent to test its own code
- `verify-all-examples` focuses on personal verification

These drivers reinforce the solo-solver identity. The parallel-decomposition driver required a fundamental behavioral change (become a coordinator), while the others required only incremental tweaks (write fewer code blocks, verify before returning). The model prioritized the concrete, actionable drivers over the abstract coordination protocol.

**Cause 7: The model does not trust children.**

The one task that delegated (arc-36a08778) demonstrates the trust problem perfectly:
- The parent spent 10 iterations building understanding
- It delegated to a single child with detailed instructions
- The child produced a solution that passed all 6 training examples
- The parent trusted the training score and returned the result
- **The result was wrong** -- the child's code had generalization errors on test inputs

In run-026 (without the delegation driver), the same task was solved by the parent alone in 18 iterations. The critical difference: the parent spent 9 iterations iteratively debugging edge cases. The child could not replicate this depth of refinement in a single invocation.

This validates the model's implicit concern: children produce shallower, less-refined work. Delegating is a gamble. The model's instinct to solve things itself is rationally grounded.

### 1.3 Comparison with arcgentica

Arcgentica achieves 86% on ARC-AGI-2 and uses delegation on roughly 5/20 tasks. Their prompt design reveals why their agents delegate more naturally:

**Delegation is embedded in the strategy section, not separated.**

Arcgentica's `INITIAL_PROMPT` puts `call_agent` inside the "Formulate a Hypothesis" section (step 2 of 5):

```python
*   You can use sub-agents to explore multiple hypotheses in parallel. For example:
    ```python
    results = await asyncio.gather(
        call_agent(<hypothesis 1>, str, examples=examples, challenges=challenges),
        call_agent(<hypothesis 2>, str, examples=examples, challenges=challenges),
    )
    ```
*   **Important:** Sub-agents also have access to `call_agent`, so they can further
    delegate if needed. Be judicious -- spawning agents has a cost.
```

Key differences from our system prompt:

1. **Inline placement**: Delegation appears inside the workflow step where it is most relevant (hypothesis testing), not in a separate trailing section.

2. **Code example**: A concrete Python code example shows exactly what to write. Our system prompt has a code example too (lines 57-68), but it is in the "Designing Delegation" appendix, not in the workflow section.

3. **Framing as hypothesis exploration**: Arcgentica frames delegation as "exploring multiple hypotheses in parallel." Our prompt frames it as "delegate to children" -- an organizational metaphor that casts the model as a manager, which is alien to its training distribution.

4. **Minimalism**: Arcgentica's delegation instruction is 6 lines. Our "Designing Delegation" section is 32 lines. The brevity of arcgentica's approach means the model absorbs it as a lightweight tool, not a heavyweight protocol.

5. **No elaborate protocol**: Arcgentica does not prescribe phases, variable naming conventions, cross-pollination patterns, or results boards. It just says "you can use sub-agents" and shows a code example. The protocol complexity of our driver creates friction.

6. **Sub-agents also get told about delegation**: The `AGENT_PROMPT` includes "If necessary, delegate to other sub-agents using `call_agent`." This normalizes delegation at every level.

---

## 2. System Prompt Changes

### 2.1 Move delegation into the workflow, not after it

**Before** (current structure):
```
## How to Work
1. Explore
2. Plan -- For large tasks, design a delegation structure.
3. Execute -- compute directly or delegate to children.
4. Verify
5. Return

## Designing Delegation
[32 lines of delegation details]
```

**After** (proposed structure):
```
## How to Work

Each iteration is one step. Do one thing, observe the result, then plan the next step.

1. **Explore** -- inspect the data. `console.log(typeof context, context.length)`. If it is long, log a slice.
2. **Plan** -- decide strategy. If the task has multiple plausible approaches, delegate them in parallel:
   ```javascript
   const [resultA, resultB] = await Promise.all([
     rlm("Test hypothesis A: [describe]", context),
     rlm("Test hypothesis B: [describe]", context),
   ]);
   console.log("A:", resultA, "B:", resultB);
   ```
   Each child gets its own iteration budget (15 iterations at depth 1). Launching 2-3 children costs you 1 parent iteration but buys 30-45 child iterations -- a 30:1 leverage ratio.
3. **Execute** -- compute directly for simple operations, or harvest and refine child results for complex ones.
4. **Verify** -- `console.log()` your candidate answer. Read the output to confirm.
5. **Return** -- only `return(answer)` after you have seen the correct value printed.
```

This embeds the delegation code example directly in the planning step, exactly as arcgentica does. The budget information (15 iterations, 30:1 ratio) is stated explicitly so the model perceives delegation as leverage, not cost.

### 2.2 Reframe the identity line

**Before:**
```
You are an RLM (Reasoning Language Model) -- an LLM running inside a REPL loop.
You can write and execute JavaScript, observe results, iterate, and delegate work to other models.
```

**After:**
```
You are an RLM (Reasoning Language Model) -- an LLM that can execute JavaScript, iterate on results,
and spawn child agents that work in parallel. You are most effective when you use children to
explore multiple approaches simultaneously, then refine the best result.
```

This makes delegation part of the identity, not just a listed capability.

### 2.3 Remove cost-aversion language

**Before:**
```
- `await rlm(query, context?, { systemPrompt? })` -- a recursive call to another RLM that shares
  this REPL environment and can itself execute code, iterate, and delegate further.
  Powerful but expensive -- use wisely.
```

**After:**
```
- `await rlm(query, context?, { systemPrompt? })` -- spawn a child agent that shares this sandbox,
  gets its own iteration budget (15 at depth 1), and can execute code and iterate independently.
  Children's iterations do not count against your budget. Use `Promise.all` for parallel work.
```

The phrases "expensive" and "use wisely" are replaced with factual information about what the child gets. "Children's iterations do not count against your budget" is the single most important fact for delegation incentives, and it is currently unstated.

### 2.4 Shorten the Designing Delegation section

**Before** (32 lines, 1768 chars):
- Full delegation protocol with systemPrompt instructions
- Code example with classifier prompt
- Instructions about child awareness
- Cross-pollination guidance
- Variable naming advice
- Cost warnings

**After** (10 lines):
```
## Delegation Tips

- Pass a `systemPrompt` to tell the child its role, expected output format, and constraints.
- Children share the sandbox: variables you define are visible to children and vice versa.
- Children can access `__ctx.shared.data` for the full root data -- no need to re-send it.
- Always `await` rlm() calls. Unawaited calls are silently lost.
- After children return, verify and refine their results yourself -- do not blindly trust a child's output.
```

The current 32-line section is replaced with 5 actionable tips. The elaborate protocol is moved to drivers (where it can be opted into), not hardcoded into the base prompt.

### 2.5 Full proposed SYSTEM_PROMPT

```typescript
export const SYSTEM_PROMPT = `You are an RLM (Reasoning Language Model) -- an LLM that can execute JavaScript, iterate on results, and spawn child agents that work in parallel. You are most effective when you use children to explore multiple approaches simultaneously, then refine the best result.

- \`await llm(query, context?)\` -- a single call to a language model. Fast, cheap, one-shot.
- \`await rlm(query, context?, { systemPrompt? })\` -- spawn a child agent that shares this sandbox, gets its own iteration budget (15 at depth 1), and can execute code and iterate independently. Children's iterations do not count against your budget. Use \`Promise.all\` for parallel work.

You write JavaScript in a single \`\`\`javascript fenced block per response. After each response, your code executes in a persistent sandbox and you see the output. This loop continues until you call return(answer).

**Only one code block per response is executed.** If you write more than one, only the first runs -- the rest are silently discarded. Write your reasoning as plain text, then write exactly one code block, then stop. Wait for the output before planning your next step.

## Environment

- \`context\` (string) -- the task data, available as a variable. Each agent has its own private \`context\`.
- \`console.log()\` -- prints output. This is how you see results between iterations.
- \`return(value)\` -- terminates the loop and returns your final answer. Only call this when you are confident.
- \`await rlm(query, context?, { systemPrompt?, model? })\` -- spawn a child RLM with its own iteration loop.
  Provide task-specific instructions via the \`systemPrompt\` option. The child automatically gets code execution, iteration capability, and awareness of its position in the delegation tree -- you only need to provide the task instructions.
  Use \`model\` to select an alias from the Available Models table (if configured). Omit to use the current model.
  **CRITICAL: Must be awaited -- unawaited calls are silently lost and waste API budget.**
  If you define an async helper that calls rlm(), you must also await the helper call.
- \`await llm(query, context?, { model? })\` -- one-shot LLM call. No REPL, no iteration, no delegation.
  Costs 1 API call vs 3-7 for rlm(). Prefer for simple tasks: classify an item, extract a value, answer a question.
  Use \`model\` to select an alias from the Available Models table (if configured). Omit to use the current model.
  \`llm()\` children have NO access to \`__ctx.shared.data\` -- pass all needed data in the context parameter.
- \`__rlm\` (read-only) -- your position in the delegation tree:
  - \`depth\` / \`maxDepth\` -- current recursion depth and limit (root = 0)
  - \`iteration\` / \`maxIterations\` -- current loop iteration and limit
  - \`lineage\` -- array of queries from root to you; \`lineage[0]\` is the root query
  - \`invocationId\` / \`parentId\` -- unique ID for this agent and its parent
- \`__ctx.shared.data\` -- the root context data, readable by all REPL agents at any depth (frozen)
- \`__ctx.local\` -- your private writable workspace. Each agent has its own isolated local store.
- \`require()\` -- Node.js built-in modules only
- Variables persist across iterations. Code from earlier iterations is still in scope.

## How to Work

Each iteration is one step. Do one thing, observe the result, then plan the next step.

1. **Explore** -- inspect the data. \`console.log(typeof context, context.length)\`. If it is long, log a slice.
2. **Plan** -- decide strategy. If the task has multiple plausible approaches, delegate them in parallel:
   \`\`\`javascript
   const [resultA, resultB] = await Promise.all([
     rlm("Test hypothesis A: [describe]", context),
     rlm("Test hypothesis B: [describe]", context),
   ]);
   console.log("A:", resultA, "B:", resultB);
   \`\`\`
   Each child gets its own iteration budget (15 iterations at depth 1). Launching 2-3 children costs you 1 parent iteration but buys 30-45 child iterations -- a 30:1 leverage ratio.
3. **Execute** -- compute directly for simple operations, or harvest and refine child results for complex ones.
4. **Verify** -- \`console.log()\` your candidate answer. Read the output to confirm.
5. **Return** -- only \`return(answer)\` after you have seen the correct value printed.

Your iterations are finite. Do not waste them -- each one should make measurable progress. Do not narrate future steps or hypothesize about what output will look like. Write code, stop, read the actual output, and adapt.

## Delegation Tips

- Pass a \`systemPrompt\` to tell the child its role, expected output format, and constraints.
- Children share the sandbox: variables you define are visible to children and vice versa.
- Children can access \`__ctx.shared.data\` for the full root data -- no need to re-send it.
- Always \`await\` rlm() calls. Unawaited calls are silently lost.
- After children return, always verify and refine their results yourself -- do not blindly trust a child's output.

NEVER return a value you have not first logged and confirmed in output. Do not guess.
Respond with plain text and exactly one fenced code block. Then stop and wait for the result.`;
```

### 2.6 Summary of changes

| Aspect | Before | After |
|--------|--------|-------|
| Identity line | "LLM running inside a REPL loop" | "LLM that can execute JS, iterate, and spawn child agents" |
| rlm() description | "Powerful but expensive -- use wisely" | "Children's iterations do not count against your budget" |
| Delegation in workflow | Parenthetical mention in step 2 | Code example with budget info in step 2 |
| Delegation section | 32 lines, elaborate protocol | 5-line tips section |
| Cost language | "expensive," "multiplies API costs" | Budget information: "15 iterations," "30:1 leverage" |
| Child iteration info | Not stated | Stated explicitly: "15 at depth 1" |
| Code example placement | In trailing section | In step 2 of workflow |

---

## 3. Driver Changes

### 3.1 Rewrite the parallel-decomposition driver

The current driver has three fatal flaws:
1. The escape clause gives blanket permission to skip delegation
2. It prescribes an elaborate 4-phase protocol with specific variable names
3. It competes with 12 other drivers for attention

**Proposed replacement: `delegation-first.md`**

```markdown
---
name: delegation-first
kind: driver
version: 0.2.0
description: You MUST delegate to children before solving. No escape clause.
tags: [delegation, strategy, parallel]
---

## Delegation-First Strategy

**MANDATORY**: You must launch at least 2 child agents via `rlm()` before attempting any solution.

### Iteration 0: Parse and analyze
Parse the task data. Identify the structural features. Store the parsed data in a sandbox variable:
```javascript
const task = JSON.parse(context);
parsedTask = task;
console.log(/* structural analysis */);
```

### Iteration 1-2: Formulate hypotheses and delegate
Identify 2-3 distinct transformation hypotheses. Launch children to test them:
```javascript
const [rA, rB] = await Promise.all([
  rlm("Hypothesis A: [specific description]. The parsed task is in `parsedTask`. Implement a transform function, test it on all training examples, and return the test output grids as JSON if you achieve a perfect training score. Otherwise return 'FAILED: [reason]'.", context),
  rlm("Hypothesis B: [specific description]. The parsed task is in `parsedTask`. Implement a transform function, test it on all training examples, and return the test output grids as JSON if you achieve a perfect training score. Otherwise return 'FAILED: [reason]'.", context),
]);
console.log("A:", rA.substring(0, 200));
console.log("B:", rB.substring(0, 200));
```

### Iteration 3+: Harvest, verify, refine
- If a child returned a solution, verify it yourself against all training examples
- If no child solved it, use their partial findings to inform your own attempt
- ALWAYS re-verify any child solution -- never trust it blindly

### Why this works
Each child gets 15 iterations. Launching 2 children costs you 1 iteration but buys 30 child-iterations. You keep 17-18 iterations for harvesting, verification, and refinement. This is strictly more compute than solving alone.

### No exceptions
Do not skip delegation. Even if the task looks simple, launch 2 children with different approaches. The only exception: if you solve the task completely in iteration 0 (parse + immediate pattern recognition + verified answer), you may return directly.
```

### 3.2 Should delegation be in the base prompt or a driver?

Both. The system prompt should normalize delegation (as proposed in section 2). The driver should enforce a specific delegation protocol for tasks where it is activated. The system prompt says "you can delegate"; the driver says "you must delegate."

However, the driver should NOT be used alongside 12 other drivers. Run-029 demonstrated that driver competition dilutes compliance. If testing delegation, use at most 3-4 supporting drivers:
- `delegation-first` (the new mandatory delegation driver)
- `deadline-return` (deadline safety net)
- `json-stringify-return` (formatting)
- `verify-before-return` (verification)

### 3.3 Incompatible drivers to remove

These drivers should NOT be loaded alongside a delegation driver:
- `exploration-budget` -- pressures the agent to rush past analysis, conflicting with the parent's need to analyze before delegating
- `no-arc-delegation` -- directly contradicts delegation
- `one-block-per-iteration` -- the model already knows this from the system prompt; restating it wastes attention budget

---

## 4. Harness/Architecture Changes

### 4.1 Harness-level parallelism (recommended)

The most reliable way to get parallel exploration is to move it out of the agent and into the harness. Instead of asking the model to coordinate children, run N independent agents per task at the infrastructure level:

```
Harness launches:
  Agent 1: standard system prompt
  Agent 2: standard system prompt (different temperature/seed)
  Agent 3: system prompt variant (e.g., "focus on spatial patterns")

Aggregation: pick the answer that passes training validation
```

**Advantages:**
- No behavioral change required from the model
- Each agent uses its full iteration budget independently
- No trust/verification gap -- the harness verifies
- Embarrassingly parallel -- scales horizontally

**Disadvantages:**
- 3x API cost per task
- No cross-pollination between agents (they cannot share sandbox discoveries)
- Aggregation logic must be implemented

**Recommendation:** Implement harness-level parallelism as a "majority vote" or "best training score" selector. This is orthogonal to agent-level delegation and can be combined with it.

### 4.2 Structural forcing (experimental)

If we want agent-level delegation, consider structural enforcement in the harness:

**Option A: Analysis-only first N iterations.**
For the first 3 iterations, the sandbox intercepts `return()` calls with a message:
```
[ANALYSIS PHASE] You cannot return yet. Use iterations 0-2 to analyze the task.
At iteration 3, you will delegate to children automatically.
```

At iteration 3, the harness injects a user message:
```
Your analysis phase is complete. Now launch 2-3 child agents via Promise.all to test
your hypotheses. You have 17 remaining iterations for delegation, harvesting, and refinement.
```

**Option B: Auto-delegation at iteration N.**
After the parent's Nth iteration, the harness automatically spawns 2 children with the parent's accumulated analysis as context. The parent receives their results at iteration N+1.

Both options remove the model's choice to skip delegation. This is heavy-handed but may be necessary given the strength of the solo-solver instinct.

### 4.3 Make child results more visible

Currently, `rlm()` returns a plain string. The parent has to parse and interpret the child's result. Proposal: have children return structured results that are automatically summarized:

```javascript
// Currently:
const result = await rlm("test hypothesis A", context);
// result is a raw string like "[[1,2],[3,4]]"

// Proposed: rlm() returns an object with metadata
const { answer, iterations, score } = await rlm("test hypothesis A", context);
// answer: the child's return value
// iterations: how many iterations the child used
// score: self-reported confidence or training accuracy
```

This requires changes to the harness (`rlm.ts`) to expose child metadata to the parent. It would help the parent make informed decisions about which child result to trust.

---

## 5. Shared Context Improvements

### 5.1 Current `__ctx` complexity

The current shared context system has three tiers:
- `__ctx.shared.data` -- root context, frozen, readable by all
- `__ctx.local` -- per-agent private workspace (Proxy-based routing)
- `__ctx.readLocal(id)` -- read another agent's local store

This is architecturally elegant but cognitively complex. The system prompt mentions `__ctx.shared.data` and `__ctx.local` but not `__ctx.readLocal(id)`. In run-029, not a single task used any `__ctx` method.

### 5.2 Simplification proposal

Replace the three-tier system with a simpler two-tier model:

**Shared sandbox variables** (already works -- variables defined in the sandbox are visible to all agents):
```javascript
// Parent:
parsedTask = JSON.parse(context);
results = {};

// Child can read parsedTask and write to results:
results.hypothesisA = { score: 3, total: 4, transform: myTransform };
```

**Private context** (already works via the `context` parameter to `rlm()`):
```javascript
const child = await rlm("Do X", myPrivateData);
```

The `__ctx` system duplicates what sandbox variables already provide. The system prompt should emphasize sandbox variable sharing (which is intuitive and already works) rather than the `__ctx` API (which is complex and unused).

**Proposed system prompt change:**
```
- Variables in the sandbox persist across iterations and are shared with all child agents.
  Define a variable in one agent; read it in another. This is how agents coordinate.
```

Remove `__ctx.local` and `__ctx.readLocal` from the prompt entirely. Keep them in the implementation for backward compatibility but do not advertise them.

### 5.3 Cross-agent communication primitives

Adding `signal()` and `waitFor()` is premature. The fundamental problem is that the model does not delegate at all, not that it lacks communication primitives. Solve the delegation problem first; add coordination primitives later if empirical evidence shows they are needed.

### 5.4 Structured child reporting

Children should be instructed (via their systemPrompt) to store results in sandbox variables before returning:

```javascript
const childPrompt = `
You are testing hypothesis A. The parsed task is in 'parsedTask'.
Implement a transform function and test it on all training examples.

Before returning, store your results:
  childResults_A = { score: X, total: Y, transform: yourFunction };

Return 'SOLVED' if perfect score, otherwise return 'FAILED: [reason]'.
`;
```

This gives the parent both a string result AND sandbox-stored artifacts (the transform function, the score). The parent can then directly call the child's transform function in its own verification code.

---

## 6. Concrete Experiment Plan

### Experiment 1: System prompt changes only (no driver)

**Goal:** Test whether the revised system prompt (section 2.5) increases delegation rate without any driver forcing it.

**Setup:**
- Use the new system prompt from section 2.5
- No delegation-related drivers
- Keep 3-4 supporting drivers: `deadline-return`, `json-stringify-return`, `verify-before-return`, `verify-all-examples`
- 20 ARC-AGI-2 tasks (same set as run-026/029)
- maxIterations=20, maxDepth=2

**Metrics to measure:**
- Delegation rate: what fraction of tasks call `rlm()` at least once?
- Delegation timing: at which iteration does delegation occur?
- Child success rate: what fraction of children produce results the parent uses?
- Score: does delegation help, hurt, or not affect accuracy?

**Success criteria:**
- Delegation rate >= 25% (5/20 tasks) -- up from 5% in run-029
- Score >= 60% -- no regression from run-026's 65% baseline
- At least 1 task where delegation demonstrably contributed to a correct answer

### Experiment 2: System prompt changes + delegation-first driver

**Goal:** Test whether mandatory delegation (the new `delegation-first` driver from section 3.1) improves or hurts accuracy.

**Setup:**
- New system prompt + `delegation-first` driver
- Only 3 supporting drivers: `deadline-return`, `json-stringify-return`, `verify-before-return`
- Same 20 tasks
- maxIterations=20, maxDepth=2

**Metrics:**
- Delegation compliance: what fraction follow the mandatory protocol?
- Score: does forced delegation help or hurt?
- Iteration efficiency: does the parent spend too many iterations on coordination overhead?

**Success criteria:**
- Delegation compliance >= 80% (16/20)
- Score >= 55% -- some regression is acceptable if delegation is being tested
- Evidence of at least 3 tasks where child results contributed to the final answer

### Experiment 3: Harness-level parallelism

**Goal:** Test whether running 3 independent agents per task (with majority-vote aggregation) outperforms a single agent.

**Setup:**
- Standard system prompt (current or revised)
- 3 independent agents per task
- Aggregation: pick the answer that passes training validation. If multiple pass, pick the one with the most training examples correct. If tied, pick any.
- Same 20 tasks
- maxIterations=20 per agent

**Metrics:**
- Score vs single-agent baseline
- API cost (3x tokens expected)
- Agreement rate: how often do 2+ agents produce the same answer?

**Success criteria:**
- Score >= 70% (vs 65% single-agent baseline)
- At least 2 tasks where agent disagreement reveals the correct answer

### Priority order

1. **Experiment 1** first -- low risk, tests the hypothesis that prompt framing is the bottleneck
2. **Experiment 3** next -- independent of model behavior, tests infrastructure-level improvement
3. **Experiment 2** last -- highest risk, tests whether forced delegation helps or hurts

---

## 7. Key Insight

The core finding is that **delegation resistance is not a bug in the model -- it is a rational response to the incentive structure**. The system prompt frames delegation as expensive, positions it as an appendix, and provides escape clauses. The model correctly reads these signals and concludes that solo solving is preferred.

To change behavior, we must change incentives:
1. Tell the model that child iterations are free (they are)
2. Show delegation as the default workflow, not an exception
3. Remove cost-aversion language
4. Provide concrete code examples inline, not in appendices
5. If mandatory delegation is desired, remove escape clauses entirely

The arcgentica comparison proves this is possible. Their agents delegate on 25% of tasks with a 6-line instruction and a code example. Ours delegate on 5% of tasks despite a 32-line delegation section and an entire driver. The difference is framing, not capability.
