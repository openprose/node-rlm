# Recursion Opportunities Analysis: ARC-AGI-2 Trajectories (Run-022/023)

Analysis of 39 trajectory files across two Opus 4.6 ARC evaluation runs to identify specific, evidence-based opportunities where recursive delegation via `rlm()` could improve task performance.

---

## 1. Executive Summary

After reading all 39 trajectories (19 from run-022 with arc-solver.md plugin, 20 from run-023 without), I identified **3 genuinely promising recursion patterns** and **4 patterns that sound appealing but would likely waste budget**. The honest assessment: recursion is a marginal optimization for ARC tasks, not a transformative one. The dominant failure modes (incorrect pattern hypothesis, incomplete algorithm implementation, edge-case blindness) are fundamentally single-agent problems that recursion does not solve.

**Where recursion genuinely helps:**
1. **Parallel hypothesis verification** -- testing 2-3 candidate transforms against training data simultaneously instead of sequentially
2. **Edge-case subproblem delegation** -- when the main agent has a working solution but a specific edge case requires focused investigation
3. **Independent answer verification** -- having a child agent verify the parent's candidate answer before submission

**Where recursion does NOT help (despite sounding good):**
- Exploratory data analysis (needs shared context accumulation)
- "Describe what you see" visual reasoning delegation
- Breaking ARC tasks into spatial sub-problems
- General-purpose "try everything in parallel"

**Key constraint:** The RLM architecture gives child agents at depth 1 a maximum of 7 iterations (via `iterationsForDepth`), and depth-2 children get only 4. This is sufficient for "verify this transform on training data" but insufficient for "solve this ARC sub-problem independently."

---

## 2. Genuine Opportunities

### Opportunity A: Parallel Hypothesis Verification

**The pattern:** The agent has identified 2-3 plausible transformation hypotheses by iteration 6-8 but must test them sequentially, spending 1-2 iterations per hypothesis on training validation. This sequential testing consumes 4-6 iterations that could be parallelized.

**The proposed recursion:**
```javascript
// Parent at iter 6, after identifying 3 candidate transforms
const hypotheses = [
  { name: "point-reflect", code: `function transform(grid) { ... }` },
  { name: "tile-repeat", code: `function transform(grid) { ... }` },
  { name: "flood-fill-boundary", code: `function transform(grid) { ... }` },
];

const results = await Promise.all(hypotheses.map(h =>
  rlm(
    `Test this transform on ALL training examples. Return JSON: {"name":"${h.name}","scores":[{train:0,match:bool,diffs:N},...]}`,
    JSON.stringify({ transform: h.code, task: __ctx.shared.data }),
    { model: "fast", systemPrompt: "You are a hypothesis tester. Parse the task JSON, implement the given transform, apply to each training input, compare with expected output. Return match results as JSON." }
  )
));
console.log("Hypothesis results:", JSON.stringify(results));
```

**Model choice:** Sonnet 4.5 (`fast`) for the children. The child's job is mechanical: parse JSON, run a function, compare outputs, report scores. No creative reasoning required.

**Iteration budget:** Parent spends 1 iteration on delegation + result analysis. Children each get up to 7 iterations (depth 1) but should complete in 2-3. Net cost: ~6-9 Sonnet API calls vs. 4-6 Opus iterations saved.

**Expected benefit:** Saves 3-5 parent iterations that can be redirected to refinement. In trajectories like arc-89565ca0 (run-022), the agent tested 8+ hypotheses sequentially over 8 iterations (iter 8-15) without converging. Parallel testing of the top 3 candidates at iter 8 would have freed 5 iterations for deeper analysis of the best-scoring one.

**Risk:** Medium. The child agents need to correctly implement the transform function from a string description. If the transform code has bugs, the child will report incorrect scores. Mitigation: pass the actual code as a string, not a natural-language description.

**Evidence from trajectories:**

- **arc-89565ca0 (run-022, score 0):** Tested 8 hypotheses for staircase ordering (iter 8-15). Each hypothesis checked one correlation (bbox overlap, noise counts, crossing sides, adjacency degree) against training examples. Three parallel children testing the top 3 candidates at iter 8 would have saved 5 iterations.

- **arc-78332cb0 (run-022, score 0):** Tested nonBG count sorting, diagonal reading, transpose, bbox area, center-of-mass across 6 iterations (iter 4-9). After iter 3, the agent had 3 concrete hypotheses (nonBG ascending, reversal, same-order). Parallel testing would have freed 3-4 iterations.

- **arc-78332cb0 (run-023, score 0):** Spent ALL 9 iterations in exploration mode computing features (count, bounding box, perimeter) without ever implementing a candidate transform. The trajectory notes: "The agent kept computing new features hoping to find a simple sorting rule, but never attempted to state a concrete hypothesis." Parallel delegation could have forced early hypothesis commitment -- the act of writing a delegation prompt requires formalizing the hypothesis.

- **arc-2ba387bc (run-023, score 0):** Tested 10+ pairing hypotheses over 12 iterations (iter 2-13). Parallel testing of the top 3 at iter 5 would have identified the best candidate sooner.

**Counter-evidence (why this isn't always helpful):**

- **arc-5961cc34 (run-022, score 1, 11 iters):** The agent formed one hypothesis (ray deflection) and it was correct. Parallel testing would have added overhead with no benefit.

- **arc-db695cfb (run-022, score 1, 7 iters):** Single hypothesis, correct on first attempt. No need for parallel verification.

The pattern helps specifically for tasks where the agent generates multiple competing hypotheses and wastes iterations testing them sequentially. It does NOT help when the agent converges quickly on the correct hypothesis.

### Opportunity B: Edge-Case Subproblem Delegation

**The pattern:** The agent has a working solution that validates perfectly on all training examples, but the test input has an edge case (boundary condition, missing data, ambiguous overlap) that the main solution cannot handle. The agent then spends 5-8 iterations investigating the edge case, often running out of budget.

**The proposed recursion:**
```javascript
// Parent at iter 10, after discovering 8 unresolvable test cells
const edgeCaseResult = await rlm(
  `The grid has point symmetry at axis 15.5: grid[r][c] = grid[31-r][31-c]. ` +
  `This works for cols 2-29 but cols 0-1 map to 31 and 30 (out of bounds). ` +
  `Find what values should go at rows 14-17, cols 0-1 in the test grid. ` +
  `Try: (a) finding a secondary symmetry for cols 0-1, ` +
  `(b) checking if cols 0-1 relate to cols 2-3 or any other column pair, ` +
  `(c) examining the block structure of the grid (does it have a hierarchical border?). ` +
  `Return the 8 values as JSON: [[r14c0, r14c1], [r15c0, r15c1], [r16c0, r16c1], [r17c0, r17c1]]`,
  __ctx.shared.data,
  { systemPrompt: "You are investigating a specific edge case in an ARC grid. You have access to the full grid data via context. Explore the data programmatically, test multiple hypotheses, and return the best answer you can find." }
);
```

**Model choice:** Same model (Opus 4.6) for the child. This is a genuine reasoning problem that requires creative hypothesis testing, not mechanical verification.

**Iteration budget:** Child gets 7 iterations at depth 1. Parent preserves its remaining 8-10 iterations for other work or can continue investigating in parallel.

**Expected benefit:** Frees the parent from a focused investigation that may dead-end, while preserving the parent's iteration budget for its primary solution path. Even if the child fails, the parent has not lost iterations on the dead end.

**Risk:** High. The child agent needs to solve a genuinely hard sub-problem (one the parent couldn't solve) with fewer iterations (7 vs the parent's remaining 8-10). The child also lacks the accumulated context the parent built up over 10 iterations -- it starts fresh with only the problem description and raw data.

**Evidence from trajectories:**

- **arc-0934a4d8 (run-022, score 0):** The agent discovered the symmetry rule at iter 8, validated it perfectly at iter 9 (93/93 cells correct on training), then spent 8 iterations (10-17) struggling with 8 boundary cells where the symmetry maps out of bounds. The agent's own trajectory analysis notes: "Using rlm() delegation for the edge-case subproblem: With the main symmetry rule established, the agent could have delegated the edge-cell recovery to a sub-agent with a focused prompt, preserving its own iteration budget for verification."

  From the trajectory, iter 16 output:
  ```
  Check if col 0 pairs with col 29:
  col 0 vs 29: 4/21
  col 1 vs 28: 4/21
  ```
  The agent proved its fallback was wrong (4/21 match) but used it anyway under deadline pressure.

- **arc-0934a4d8 (run-023, score 0):** Exact same pattern. Discovered symmetry by iter 7, validated by iter 9, then spent iterations 10-19 stuck on the same OOB boundary problem. Timed out without returning. The trajectory explicitly notes: "stalled on edge case, circular reasoning about OOB indices."

  Both runs of this task (across both run-022 and run-023) exhibit the identical failure pattern. Delegating the boundary investigation to a child would have been valuable in both cases. The parent could have continued working on a fallback strategy while the child explored the edge case.

- **arc-247ef758 (run-022, score 0):** The agent's solution was correct except for a single cell overlap at test 1 (6,12). The overlap priority rule was ambiguous from training data. A child agent could have been delegated: "Test both 'first-writer-wins' and 'last-writer-wins' overlap strategies on all training examples. Report which strategy is consistent with more training examples." This would have cost 1 iteration but might have identified the ambiguity earlier.

**Counter-evidence:**

- **arc-195c6913 (run-022, score 0):** The staircase boundary-tracing algorithm failure was not an edge case but a fundamental implementation bug. Delegating "trace this staircase path" to a child would face the same algorithmic difficulty.

- **arc-36a08778 (run-022, score 0):** The wall-termination rule failure was systematic across 4 of 6 training examples. This is not an edge case; it is an incomplete understanding of the rule. Delegation would not help.

### Opportunity C: Independent Answer Verification

**The pattern:** The agent has a candidate answer and wants to verify it before returning. Currently, verification means running the transform on training data (which the agent already did to produce the candidate). A more robust verification is having an independent agent re-derive the answer from scratch or check the answer against the task description.

**The proposed recursion:**
```javascript
// Parent at iter N-3, with candidate answer
const verification = await rlm(
  `Verify this ARC answer. The task data is in context. ` +
  `The proposed answer is: ${JSON.stringify(candidate)}. ` +
  `Check: (1) Does it have the correct dimensions? ` +
  `(2) Apply the transform to each training input -- does it match each training output? ` +
  `(3) Does the test output look structurally consistent with training outputs? ` +
  `Return JSON: {"valid": true/false, "issues": ["..."]}`,
  __ctx.shared.data,
  { model: "fast", systemPrompt: "You are a verification agent. Check the proposed answer thoroughly." }
);
```

**Model choice:** Sonnet 4.5 (`fast`). Verification is mechanical: apply transform, compare grids, check dimensions.

**Expected benefit:** Catches bugs like the state-loss regression in arc-cbebaa4b (run-022), where the agent's final function produced different results from its previously-validated function. A verification child that independently re-ran the transform would have detected this.

**Risk:** Low cost (1 Sonnet call), but limited value. In most failed trajectories, the agent already verified against training data before returning. The failures are in test-time generalization, which no verification can catch without knowing the expected test output.

**Evidence from trajectories:**

- **arc-cbebaa4b (run-022, score 0):** "The agent had a working algorithm in iter 17 that passed both training examples, but when modifying the code in iter 18 to handle test-input edge cases, the refactored `renderFinalSafe` function introduced a logic change that broke the previously-working training cases." Verification output from iter 19: `Train 0 still match: false / Train 1 still match: false`. The agent SAW this regression but returned anyway due to deadline pressure. An independent verification agent would not have prevented the return, but it could have been run in parallel with the refactoring, providing an earlier warning.

- **arc-195c6913 (run-023, score 0):** Failure mode is "abandoned-correct-answer" -- the agent achieved 0 diffs on all 3 training examples at iter 17, then re-ran the function at iter 18 and got incorrect test outputs. The trajectory notes the function may have had a scoping issue or the test input triggered a different code path. An independent verification agent running the iter-17 function against training data would have confirmed it was correct, preventing the agent from second-guessing.

**Counter-evidence:**

- In most score-0 trajectories, the agent's final answer was fundamentally wrong (wrong hypothesis, not just a bug). Verification would confirm "this is wrong" but the agent already knows that from its mismatch counts. The issue is not lack of verification but inability to find the right answer.

---

## 3. Anti-Patterns: Recursion That Would NOT Help

### Anti-Pattern 1: "Describe what you see" Visual Reasoning

**The idea:** Delegate `llm("Describe the pattern you see in this ARC grid", gridString)` to get a natural-language description, then use it to form hypotheses.

**Why it fails:** ARC patterns are spatial and relational. Natural language descriptions are inevitably lossy. The agent already has full programmatic access to the grid data. An LLM description like "there are colored shapes arranged symmetrically" adds no information the agent cannot extract more precisely via code. Every successful trajectory in the dataset solved the task through code-based analysis (flood fill, connected components, diff computation), not through verbal description.

**Evidence:** In arc-446ef5d2 (run-022, iter 16), the agent delegated to `rlm()` with a detailed pattern description. The child "returned a text analysis rather than grid data," wasting one critical iteration. The delegation prompt was well-crafted, but the child's response was useless because it described patterns verbally instead of computing grids.

### Anti-Pattern 2: Spatial Sub-Problem Decomposition

**The idea:** Break a 30x30 grid into quadrants and have children analyze each quadrant independently.

**Why it fails:** ARC transformations are holistic. The pattern in one quadrant depends on data from other quadrants (e.g., symmetry axes, repeating tiles, connected components that span the grid). No trajectory in the dataset showed a task where independent quadrant analysis would have been sufficient. Every failed trajectory failed because the agent missed a global pattern (symmetry type, connection graph structure, ordering rule), not because it couldn't process the data volume.

**Evidence:** arc-0934a4d8 required understanding a global symmetry axis at 15.5. arc-b99e7126 required recognizing a self-similar pattern across the entire 7x7 macro-grid. arc-36a08778 required tracing a connected tree of brackets across the full grid. None of these decompose into independent sub-problems.

### Anti-Pattern 3: Brute-Force Parallel Transform Enumeration

**The idea:** Spawn N children, each implementing a different class of ARC transform (symmetry, tiling, color mapping, shape extraction, etc.), and take the one that passes training.

**Why it fails:** Cost. Each `rlm()` child at depth 1 can use up to 7 iterations. With Opus, each iteration costs ~$0.50-0.70 in API calls. Spawning 5 children costs 35 iterations worth of API budget (~$20). The parent agent has only 20 iterations total. Furthermore, the correct transform for most ARC tasks is a composition of primitives (e.g., "extract shapes, sort by area, apply to right half of grid"), not a single named transform. No enumerable library of pre-built transforms covers the combinatorial space.

**Evidence:** Run-022 cost $13.38 for 20 tasks (mean 15.75 iterations). Adding 5 parallel children per task would roughly triple the cost to ~$40 for the same 20 tasks, with no guarantee of better results.

### Anti-Pattern 4: Delegation to Avoid Iteration Budget Limits

**The idea:** When the parent is running low on iterations, delegate the remaining work to a child to get "extra" iterations.

**Why it fails architecturally:** Child agents at depth 1 get at most 7 iterations (`iterationsForDepth` caps: Infinity, 7, 4, 3). A delegation at iter 18 of 20 still only gives the child 7 iterations, not 20. Furthermore, the child starts without the accumulated context (variable definitions, intermediate results, helper functions) that the parent built up over 18 iterations. The child would need to re-derive everything from scratch.

**Evidence:** In arc-446ef5d2 (run-022), the delegation at iter 16 (4 iterations remaining) produced a text analysis instead of a solution. The child could not replicate the parent's 15 iterations of accumulated understanding in its limited budget.

---

## 4. Model Selection Guidance

### When to use the same model (Opus 4.6) for children:

- **Edge-case subproblem delegation (Opportunity B):** The child needs genuine creative reasoning to solve a sub-problem the parent couldn't. Cheaper models would likely fail on the same problem.
- **When the sub-problem requires multi-step spatial reasoning:** ARC tasks inherently require Opus-level reasoning.

**Cost:** ~$0.50-0.70 per child iteration. A 7-iteration child costs ~$3.50-5.00.

### When to use a cheaper model (Sonnet 4.5) for children:

- **Hypothesis verification (Opportunity A):** Applying a provided transform function to training data and comparing outputs is mechanical. Sonnet can do this reliably.
- **Answer verification (Opportunity C):** Checking dimensions, running a function, comparing grids -- all mechanical.
- **Anything that can be specified as "run this code and report results":** If the parent can write the exact code the child should execute, a cheaper model suffices.

**Cost:** ~$0.05-0.10 per child iteration. A 3-iteration child costs ~$0.15-0.30.

### When a cheaper model is insufficient:

- **Hypothesis generation:** Coming up with novel ARC transform hypotheses requires strong spatial reasoning. Haiku and even Sonnet may suggest trivial transforms.
- **Complex algorithmic debugging:** Diagnosing why a boundary-tracing algorithm fails on a specific staircase geometry requires deep reasoning.
- **Pattern recognition in novel configurations:** The core ARC challenge is recognizing patterns, which is fundamentally an intelligence-class task.

### Cost-benefit summary:

| Opportunity | Model | Est. Cost/Task | Iterations Saved | Net Value |
|------------|-------|----------------|------------------|-----------|
| A: Parallel hypothesis verification | Sonnet 4.5 | $0.50-1.00 | 3-5 Opus iters ($1.50-3.50) | Positive |
| B: Edge-case delegation | Opus 4.6 | $3.50-5.00 | 5-8 Opus iters ($2.50-5.60) | Neutral to positive |
| C: Answer verification | Sonnet 4.5 | $0.15-0.30 | 0-1 Opus iters | Slightly positive |

---

## 5. Implementation Recommendations

### 5.1. Add a Delegation Checkpoint to arc-solver.md

Insert a delegation decision point at iteration 8 (after the initial exploration + hypothesis phase):

```markdown
### Delegation checkpoint (iter 7-8)

At iteration 7-8, evaluate whether delegation would help:

**Delegate hypothesis testing** if:
- You have 2+ untested hypotheses AND each requires a full training verification pass
- Each hypothesis can be expressed as a concrete `transform(input)` function

**Delegate edge-case investigation** if:
- Your transform works on ALL training examples (verified)
- The test input has a specific edge case your transform cannot handle
- The edge case is isolatable (e.g., "what value goes at these 8 cells?")

**Do NOT delegate** if:
- You have 0-1 hypotheses (just test it yourself)
- Your transform fails on training examples (fix the core hypothesis first)
- You are still in the exploration phase (accumulate understanding first)

**How to delegate hypothesis testing:**
```javascript
// Define your candidate transforms as strings
const h1Code = `function transform(inp, out_H, out_W) { /* ... */ }`;
const h2Code = `function transform(inp, out_H, out_W) { /* ... */ }`;

const [r1, r2] = await Promise.all([
  rlm("Test this transform against all training examples. Return JSON with match results.",
    JSON.stringify({ code: h1Code, task: JSON.parse(context) }),
    { model: "fast", systemPrompt: "You test ARC transforms. Parse the task from context, eval the transform code, apply to each training input, compare to expected output. Return {name, results: [{train:N, match:bool, diffs:N}]}" }),
  rlm("Test this transform against all training examples. Return JSON with match results.",
    JSON.stringify({ code: h2Code, task: JSON.parse(context) }),
    { model: "fast", systemPrompt: "You test ARC transforms. Parse the task from context, eval the transform code, apply to each training input, compare to expected output. Return {name, results: [{train:N, match:bool, diffs:N}]}" }),
]);
console.log("H1:", r1);
console.log("H2:", r2);
```
```

### 5.2. Add Edge-Case Delegation Pattern

Add guidance for when the main solution hits a boundary case:

```markdown
### Edge-case delegation

When your solution works on all training examples but has unresolvable cells on the test input:

```javascript
const mainResult = solve(testInput); // works except for N cells
const unknownCells = [/* list of {r, c} that are null/unknown */];

// Delegate the edge case investigation
const edgeResult = await rlm(
  `An ARC grid has [describe the symmetry/pattern]. This works for most cells but ` +
  `cells at positions ${JSON.stringify(unknownCells)} cannot be resolved because ` +
  `[explain why]. Investigate alternative approaches for these specific cells. ` +
  `Return JSON: ${JSON.stringify(unknownCells.map(c => ({r: c.r, c: c.c, value: "?"})))}`,
  context,  // child has access to full task data
  { systemPrompt: "You are investigating specific unresolvable cells in an ARC grid. The main symmetry/pattern is already known. Your job is to find what determines these specific cells." }
);

// Merge edge-case results into main result
try {
  const fixes = JSON.parse(edgeResult);
  for (const fix of fixes) mainResult[fix.r][fix.c] = fix.value;
} catch (e) {
  console.log("Edge delegation failed, using fallback");
}
```
```

### 5.3. Do NOT Add Delegation to the Main Loop

Avoid making delegation a required step at a fixed iteration. The trajectory data shows that:
- Successful tasks (score 1.0) averaged 11.4 iterations in run-022, with no delegation needed
- The fastest solve was arc-db695cfb at 7 iterations with zero delegation
- The only delegation attempt (arc-446ef5d2, iter 16) was a failure

Delegation should be a tool the agent uses when it recognizes a specific pattern (parallel testing, edge case), not a mandatory protocol step.

### 5.4. System Prompt Change for Child Agents

The `buildChildRepl()` function in system-prompt.ts already provides adequate REPL mechanics. However, for ARC hypothesis-testing children, the parent should include the helper library in the `systemPrompt` option:

```javascript
const childPrompt = `You are testing an ARC hypothesis. Use these helper functions:
${HELPER_LIBRARY}

Parse the task from context, implement the provided transform, test it on all training examples.
Return JSON: {"matches": N, "total": N, "details": [...]}`;

const result = await rlm("Test hypothesis", taskData, { model: "fast", systemPrompt: childPrompt });
```

This ensures the child has access to `gridEqual`, `gridDims`, etc., without needing to re-derive them.

### 5.5. Model Configuration

Ensure the eval harness provides model aliases for delegation:

```javascript
models: {
  "fast": { callLLM: sonnetCallLLM, tags: ["fast", "cheap"], description: "Sonnet 4.5 - for mechanical verification" },
  "default": { callLLM: opusCallLLM, tags: ["intelligent"], description: "Opus 4.6 - for creative reasoning" },
}
```

This allows `{ model: "fast" }` in delegation calls, which is already supported by the architecture but needs to be configured in the eval workflow.

---

## 6. Quantitative Impact Estimate

Based on the trajectory data:

| Metric | Run-022 (with plugin) | Run-023 (no plugin) | With Recursion (est.) |
|--------|----------------------|--------------------|-----------------------|
| Score (correct/total) | 9/20 (45%) | 10/20 (50%) | 10-12/20 (50-60%) |
| Mean iterations | 15.75 | 14.05 | 14-16 |
| Mean cost/task | $0.67 | $0.55 | $0.70-0.90 |
| Tasks helped by recursion | - | - | 2-4 of 20 |

The estimated improvement of +1-2 tasks is based on:
- **arc-89565ca0** and **arc-78332cb0**: Parallel hypothesis testing could save enough iterations to find the correct ordering rule (~50% chance of improvement each)
- **arc-0934a4d8**: Edge-case delegation could resolve the boundary cells (~30% chance -- the problem is genuinely hard)
- **arc-cbebaa4b**: Verification delegation could catch the state-loss regression (~70% chance)

The remaining 7 score-0 tasks have failure modes (wrong hypothesis entirely, analysis paralysis, incomplete algorithm) that recursion does not address.

---

## 7. Conclusion

Recursive delegation in the RLM architecture is a **precision tool, not a silver bullet** for ARC tasks. The three viable patterns (parallel hypothesis testing, edge-case delegation, answer verification) each address a specific failure mode observed in the trajectory data. The most impactful is Opportunity A (parallel hypothesis verification), which could save 3-5 iterations on hypothesis-churning tasks at low cost using a cheaper model.

The critical insight from the trajectory data is that most ARC failures stem from the agent not understanding the pattern correctly, not from lack of computation. Recursion adds more computation but does not add more insight. The one exception is edge-case delegation (Opportunity B), where a child agent with fresh eyes and a focused problem statement might find a solution the parent missed -- but the success probability is modest because the problem is genuinely hard, not just under-explored.

**Recommended implementation priority:**
1. Configure model aliases in eval harness (prerequisite for all delegation)
2. Add parallel hypothesis testing guidance to arc-solver.md (Opportunity A)
3. Add edge-case delegation pattern to arc-solver.md (Opportunity B)
4. Skip mandatory delegation checkpoints (evidence does not support them)
5. Skip answer verification delegation (marginal benefit, adds complexity)
