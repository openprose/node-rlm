# Meta-Analysis: ARC-3 v2.2.0 Run (2026-02-16)

**Run:** `arc3_openrouter_anthropic_claude-opus-4-6_2026-02-16T21-10-07-088Z.json`
**Score:** 17.0% (best ever, 2/7 levels completed)
**Prior best:** 14.3% (v1.7.0 single-agent, 1/7 levels)
**Architecture:** orchestrator-v2 (Opus) -> level-manager (Opus) -> level-react (Opus) + synthesizer (Gemini Flash)
**Cost:** ~$133 estimated, ~77 minutes wall time

---

## 1. Token Economics: Where the Money Goes

### The Opus Tax

Of 185 total LLM calls, 167 (90%) were Opus at roughly $0.75/call and 18 (10%) were Gemini Flash at roughly $0.05/call. The synthesizer -- the only non-Opus component -- consumed less than 1% of the total spend.

| Component | Calls | Est. Cost | % of Total |
|-----------|-------|-----------|------------|
| Orchestrator (Opus) | 14 | $10.50 | 8% |
| Manager (Opus) | 24 | $18.00 | 14% |
| React (Opus) | 129 | $96.75 | 77% |
| Synthesizer (Flash) | 18 | $0.90 | <1% |
| **Total** | **185** | **$126** | **100%** |

The react agent is the budget hog: 77% of cost, 70% of calls. Management overhead (orchestrator + manager + synthesizer) accounts for 30% of calls but only 23% of cost because the synthesizer is cheap.

### Cost Per Useful Action

- **$0.29 per game action** (431 actions / ~$126)
- **$0.53 per action on completed levels** (239 actions for L1+L2 / ~$126)
- **$6.30 per score point** ($126 / 17% score / 100 = $0.74 per percentage point... actually $7.40 per percentage point)
- **L3's 192 actions cost ~$56 and produced exactly 0 score**

### The Pareto Question

Could we get the same 17% score for less? Almost certainly. Here is the waste decomposition:

1. **L2 attempts 1-5 burned 192 actions and ~$60 before the winning attempt.** If the orchestrator had sent the detailed BFS algorithm on attempt 1 instead of attempt 6, L2 could have been solved in ~22 actions for ~$5. That is a potential savings of ~$55 (44% of total spend).

2. **L3's 192 actions were entirely fruitless** because the agent never discovered the pattern-matching win condition. Even with unlimited budget, the strategy was wrong. Cost: ~$56.

3. **The synthesizer cost $0.90 and its contributions were marginal at best, actively harmful at worst** (it never removed phantom mechanics like "collect all color 11 items"). Cutting it would save almost nothing in cost but would remove a source of false confidence.

**Minimum viable cost for 17% score:** If the orchestrator gave L1 react the standard instructions and L2 react the BFS algorithm, the run would need roughly: 1 orchestrator init + 2 manager calls + 2 react invocations (25 + 22 actions). That is about 30-40 LLM calls, costing ~$25. The other $100 was learning tax.

### Alternative Model Allocation

The current architecture uses Opus for everything except the synthesizer. What if we re-allocated?

| Architecture | Est. Calls | Est. Cost | Prediction |
|---|---|---|---|
| Current (all Opus + Flash synth) | 185 | $126 | 17% (actual) |
| Sonnet orchestrator + Opus react | 185 | $100 | Likely similar -- orchestrator just delegates |
| Sonnet orchestrator + Sonnet manager + Opus react | 185 | $80 | Marginal risk -- manager is simple coordination |
| Opus react only (no manager/synth layer) | ~80 | $60 | Probably same or better -- see Section 2 |
| Single Opus agent, 30 iters, no delegation | 30 | $22 | Unknown but v1.7.0 got 14.3% with similar setup |

The manager is doing so little actual cognitive work (just passing through) that Sonnet or even Flash could handle it. The orchestrator's most useful moment was writing the BFS algorithm for L2 attempt 6 -- that required Opus-level reasoning. But the other 13 orchestrator iterations were boilerplate delegation code.

---

## 2. The Manager Layer: Expensive Pass-Through

### What the Manager Actually Does

In every single delegation (12 total), the manager followed exactly the same pattern:
1. Read `__level_task` (1 line)
2. Spawn react agent (1 `rlm()` call)
3. Parse react's return
4. Optionally spawn synthesizer (1 `rlm()` call)
5. Return merged result

This is 2 Opus iterations per delegation = 24 Opus calls = ~$18. For what? The manager never made a strategic decision. It never chose a different model. It never adapted its delegation based on the react agent's failure. It never said "the react agent failed because X, let me try Y." It is a deterministic relay station.

### The 2-Tier Alternative

Strip out the manager. Let the orchestrator delegate directly to the react agent and the synthesizer. This eliminates:
- 24 Opus calls (~$18 saved)
- 1 level of delegation depth (saves context window overhead)
- The manager's re-serialization of knowledge (one less lossy compression step)

The only functionality lost is the manager's ability to spawn a second react agent within the same delegation. This happened in 2 of 12 delegations (D2 and D8) and both secondary spawns produced stale or useless output. Net value: zero.

**Recommendation: Cut the manager.** The orchestrator can directly spawn react agents and synthesizers. This reduces `maxDepth` from 3 to 2, which the engine handles naturally.

### But Wait: The Manager Could Be Valuable If...

The manager layer becomes valuable if it makes autonomous strategic decisions -- for example:
- Spawning a scout agent (few actions, cheap model) before a full play agent
- Retrying the react agent with different instructions if the first attempt fails
- Comparing two react agents' observations for consistency (ensemble approach)

None of this happened in the current run. The manager is currently a cost center. It needs to become a profit center or be eliminated.

---

## 3. L2's 214 Actions: Anatomy of Waste

### The Numbers

- Human baseline: 41 actions
- L2 total: 214 actions (5.2x human)
- 6 attempts: 32, 40, 30, 50, 40, 22 actions
- First 5 attempts (waste): 192 actions
- Winning attempt: 22 actions

### Where Did 173 Extra Actions Go?

**Attempt 1 (32 actions):** Full discovery + random exploration. The react agent mapped the grid, identified the player, found some objects, but never computed a path to the goal. It wandered.

**Attempt 2 (40 actions):** Repeated discovery + more wandering. Found color-11 patterns and concluded they were "collectibles" to gather. Spent actions trying to collect them. Wrong hypothesis, never tested.

**Attempt 3 (30 actions):** Exploration-only (escalation triggered). Mapped the maze structure more completely but still pursued the "collect items" hypothesis.

**Attempt 4 (50 actions):** The react agent exceeded its 32-action budget without consequence. Discovered the fuel mechanic (HUD bar depleting) but framed it incorrectly.

**Attempt 5 (40 actions):** Found color-11 items, tried to collect them, failed to complete. The accumulated knowledge now contained so many phantom mechanics that the react agent was actively confused.

**Attempt 6 (22 actions):** The orchestrator broke from the template and wrote a step-by-step BFS pathfinding algorithm in the delegation query. The react agent followed it mechanically and solved the level.

### The Key Insight

The 173 wasted actions reveal a fundamental gap: **the react agent has perception but no navigation**. It can see the grid, identify objects, and track changes. But it cannot compute an efficient path from A to B. Every pre-attempt-6 react agent explored locally -- moving in random directions, checking what changed, moving some more. This is how a human would explore a maze *they cannot see*. But the agent CAN see the entire maze. It has a 64x64 grid in memory. It has the perceptual toolkit to identify walls and paths. It just never writes `BFS(start, goal)`.

This is not a model capability problem. Opus can trivially implement BFS. It is a **prompt architecture problem**. The react agent plugin defines `diffGrids`, `colorFreqs`, `findComponents`, and `renderRegion` as the perceptual toolkit. It does not define `pathfind(grid, start, goal)`. The model treats these four functions as the complete toolkit and improvises from there.

**Fix:** Add `bfs(cellMap, start, goal)` to the react agent's perceptual toolkit. This single addition would likely have saved 150+ actions on L2.

---

## 4. L3's Failure: The Pattern Matching Blind Spot

### What the Agent Knew (Wrong)

By the time L3 started, the knowledge base contained 24 mechanics, 13 rules, and 3 hazards. The dominant hypothesis was: "Collect all color 11 items in the maze, then enter the goal box." This was wrong on every count:

1. Color 11 is the fuel bar, not collectible items
2. There are no items to collect
3. The win condition is pattern matching, not item collection
4. "Color 0/1 special items" (which the agent avoided as harmful) were actually pattern toggles -- the key mechanic for winning

### The Tragedy of the Open Question

After L1, the react agent asked: "Does the HUD bottom-left box pattern need to match something?" This was the single most important question in the entire game. It is essentially asking about the pattern-matching requirement. **The knowledge curation system dropped this question by iteration 3.** It was filtered out because a rule about "color 0/1 markers" partially matched the question text.

The agent was one step away from discovering the core mechanic and its own knowledge management system killed the lead.

### What Happened in L3

The L3 maze is harder (baseline 172 actions vs L2's 41). The agent had to navigate a complex maze with fuel management. Five attempts:

1. **Attempt 1 (35 actions):** Found objects, collected some, failed. Never questioned the "collect items" hypothesis.
2. **Attempt 2 (40 actions):** Got within 4 steps of the goal box but ran out of action budget. This was the closest any L3 attempt got.
3. **Attempt 3 (50 actions):** BFS exploration, 108 reachable cells mapped. Still pursuing item collection.
4. **Attempt 4 (50 actions):** Finally discovered the fuel mechanic in detail. But this knowledge came too late.
5. **Attempt 5 (17 actions):** Reached the goal at cell (1,9). Color 1 was absorbed. Level did NOT complete. Fuel was at 0. Moved one more step. GAME_OVER.

The final attempt is devastating. The agent reached what it thought was the goal, the level didn't complete, it had no fuel left, and one more movement killed the game. The agent's dying thought was: "Must likely collect item at (8,5) BEFORE going to goal." Still wrong. The actual reason was that the GateKeeper pattern didn't match the Goal Icon.

### Why Pattern Matching Was Never Discovered

The react agents observed the HUD bottom-left area in every iteration. They rendered it. They noted changes. But they never formed the hypothesis: "The pattern in this HUD box must match the pattern in the goal icon in the maze." Why?

1. **The perceptual toolkit is object-level, not relational.** `findComponents` identifies objects by color. `diffGrids` identifies pixel changes. Neither compares two distant regions for similarity. The agent can see that cell (11,1) has a pattern and cell (10,11) has a pattern, but it never asks "Are these patterns the same?"

2. **The observe-act loop is too tight.** Each iteration is: observe grid, compute diff from last step, decide next action. There is no "step back and think about what the win condition might be" iteration. The react plugin's core loop is: "observe -> diff -> update knowledge -> decide -> act." There is no "hypothesize -> test" step.

3. **The knowledge system only catalogs, never reasons.** It records "color 0/1 cross pattern exists at (1,9)" and "HUD bottom-left has a pattern." It never asks "Why does stepping on (1,9) change the HUD pattern?" or "What is the relationship between these two patterns?"

4. **False beliefs crowded out true inquiry.** Once "collect all color 11 items" became the dominant hypothesis, all observations were interpreted through that lens. Color changes in the HUD were read as "progress toward item collection" rather than "evidence of pattern toggling."

---

## 5. Action Budget: The Honor System That Fails

### The Budget Problem

The orchestrator sets `actionBudget: 32` in `__level_task`. The react agent is told to respect this budget. In practice:

| Attempt | Budget | Actions Taken | Overrun |
|---------|--------|---------------|---------|
| L1 | 32 | 25 | -7 (under) |
| L2 att 1 | 32 | 32 | 0 |
| L2 att 2 | 40 | 40 | 0 |
| L2 att 3 | 30 | 30 | 0 |
| L2 att 4 | 32 | 50 | +18 (56% over) |
| L2 att 5 | 40 | 40 | 0 |
| L2 att 6 | 30 | 22 | -8 (under) |
| L3 att 1 | 32 | 35 | +3 (9% over) |
| L3 att 2 | 32 | 40 | +8 (25% over) |
| L3 att 3 | 32 | 50 | +18 (56% over) |
| L3 att 4 | 32 | 50 | +18 (56% over) |
| L3 att 5 | 40 | 17 | -23 (under, GAME_OVER) |

Budget compliance is approximately 50%. The orchestrator itself sometimes inflated the budget (e.g., passing 40 or 50 instead of 32) when it felt the react agent needed more room. The react agents overran the budget when they were "on the trail" of something and kept going.

### The Right Budget

Is 32 the right number? Consider:
- L1 baseline: 29 actions. Budget of 32 gives 10% headroom. Worked.
- L2 baseline: 41 actions. Budget of 32 is INSUFFICIENT even for optimal play. The agent would need at least 45-50 to have exploration room.
- L3 baseline: 172 actions. Budget of 32 is absurdly small. Even 50 actions is only 29% of what the efficient human path requires.

The fixed 32-action budget is wrong for later levels. An adaptive budget based on level number, remaining total actions, and prior performance would be far more effective:

```
budget = min(
  remaining_total_actions * 0.3,  // never use more than 30% of remaining total
  baseline_estimate * 1.5,        // 50% headroom over estimated baseline
  60                              // hard cap to prevent runaway
)
```

But the agent has no baseline estimate. Here is a simpler heuristic: give the first attempt a small budget (20), then double it if the agent fails. This biases toward efficiency early and thoroughness later. The current approach (always 32, sometimes unilaterally overridden to 40-50) is the worst of both worlds.

### Engine-Level Enforcement

The budget is purely honor-system. The react agent counts `__actionsUsed++` after each `arc3.step()`. If it forgets to increment, or ignores the counter, the budget is meaningless. This is a known unsolved problem from the MEMORY.md: "Budget enforcement unsolved: IIFE closures hide variables but children reassign `arc3.step`. `Object.defineProperty` also bypassed."

A pragmatic solution: the harness could wrap `arc3.step()` at the engine level to count calls and return `BUDGET_EXCEEDED` after the limit. This was attempted in v1.x but the child reassigned `arc3.step`. The engine would need to use a non-configurable, non-writable binding.

---

## 6. The Return Value Bottleneck

### What Gets Lost

All knowledge flows through JSON return strings. The react agent compresses 14 iterations of observation into a JSON object averaging ~2,000 characters. The synthesizer further compresses this into ~3,500 characters. The orchestrator curates into a growing knowledge base that reaches ~10,000 characters.

What is lost in this pipeline:

1. **Spatial memory.** The react agent builds a detailed 12x12 cell map of the maze. This map is never returned. Each subsequent react agent rebuilds the map from scratch. If the map were passed, later attempts could skip the 3-5 iterations of mapping and go straight to navigation. At 5 actions per mapping iteration, this wastes ~20 actions per retry.

2. **HUD state.** The react agent observes the exact pixel layout of the HUD area (rows 52-63). It notices patterns, colors, and changes. But its return value only says "HUD bar depletes 2 pixels per move." The full HUD state -- which would reveal the pattern matching mechanic to a careful analyst -- is compressed away.

3. **Failed hypothesis evidence.** The react agent discovers that reaching a particular cell does NOT complete the level. This is critical negative evidence. But the return says "completed: false" -- it does not say "I tried going to (7,2) and the level didn't complete, suggesting the win condition involves more than reaching the goal." The synthesizer cannot infer failure causes from a boolean.

4. **Temporal sequence.** The react agent takes actions in a specific order and observes effects in sequence. Some effects depend on order (e.g., stepping on a toggle twice reverts it). The return value flattens this into a static knowledge object, losing the causal chain.

### Is the Synthesizer Actually Useful?

The synthesizer ran 9 times and produced 3,200-3,900 character outputs. Its contributions:

**Positive:**
- Consolidated duplicate mechanic descriptions into single entries
- Assigned confidence scores (though these were mechanistic: 0.5 for new, +0.2 per confirmation)
- One rule pruning event (iteration 7, 23 rules reduced to 10)

**Negative:**
- Never removed phantom mechanics ("collect all color 11 items" survived all 9 syntheses)
- Never contradicted the dominant (wrong) win-condition hypothesis
- Added evidence strings that inflated knowledge size without adding insight
- Never asked "Why did the level not complete despite following the strategy?"

The synthesizer is a **librarian, not a scientist**. It catalogs and organizes. It does not hypothesize, test, or falsify. For $0.90 total cost, it is cheap enough to keep, but its design needs fundamental rethinking to be useful.

**What the synthesizer should do but does not:**
- Compare react's observations against the prior win-condition hypothesis
- Flag when a strategy has failed N times without success (hypothesis falsification)
- Identify the most informative observation (highest surprise) and promote it
- Ask "What would explain the agent reaching the goal and the level NOT completing?"

---

## 7. What Would a Human Do Differently?

### The Human Strategy

A human playing this game with the same 64x64 pixel grid would:

1. **Spend 2-3 actions understanding movement.** Move in each direction, confirm step size and direction mapping. (The agent does this.)

2. **Visually scan the entire grid for notable features.** Identify the player, walls, corridors, any distinctive objects. (The agent does this, slowly.)

3. **Categorize objects by visual appearance, not just color index.** A human would notice that the cross-shaped pattern at (1,9) looks like a button or switch, that the multi-colored square looks interactive, that the HUD bottom-left box has a pattern similar to the goal box. The agent sees color indices but misses visual semantics.

4. **Form a hypothesis about the win condition.** "I need to reach the big bordered box. But maybe I need to do something first." (The agent forms the wrong hypothesis: "collect items.")

5. **Test the hypothesis deliberately.** Walk to the goal box. If the level doesn't complete, ask "What else might be needed?" Look at the HUD. Compare the HUD pattern to the goal pattern. (The agent reaches the goal, sees it doesn't work, and concludes "must collect more items" rather than examining why.)

6. **Notice HUD changes when stepping on objects.** A human would notice the HUD bottom-left pattern change when stepping on the cross marker. They would say "Oh, stepping on that changed the HUD. The HUD pattern must need to match the goal." The agent notices the HUD changed but files it as "large HUD bar reduction (~14 pixels)" without understanding the semantic meaning.

### The Fundamental Divergence

The human uses **visual semantics** (this looks like a button, that looks like a match indicator). The agent uses **pixel statistics** (color 0 has 3 pixels, color 1 has 2 pixels, they form a cross shape at rows 31-33). The agent's perceptual toolkit is optimized for detecting differences, not for understanding purposes.

A human also uses **counterfactual reasoning**: "The level didn't complete when I reached the goal. What would make it complete? Something must change first. What changes when I step on things?" The agent's observe-act loop has no counterfactual reasoning step.

---

## 8. Unexplored Architectural Changes

### 8a. Hypothesis Testing Agent

The biggest gap in the current architecture is the absence of hypothesis testing. What if there were a dedicated agent whose job is to evaluate the current win-condition hypothesis?

```
orchestrator -> hypothesis-tester (cheap, 3 iters)
  "Current hypothesis: collect all color 11 items, then enter goal box.
   Evidence: 5 attempts under this hypothesis, 0 completions.
   Question: Is this hypothesis consistent with the evidence?"
```

This agent would have zero game-state access. It would only read the knowledge base and the failure log. Its job is purely epistemic: evaluate whether the hypothesis explains the observations. A Flash model could do this for $0.05.

### 8b. Visual Comparison Agent

The pattern-matching mechanic requires comparing two spatial patterns. The react agent has the raw grid data. What if it had a `compareRegions(grid, r1, c1, r2, c2, size)` function that returns a similarity score?

```javascript
function compareRegions(grid, r1, c1, r2, c2, size) {
  let match = 0, total = 0;
  for (let dr = 0; dr < size; dr++)
    for (let dc = 0; dc < size; dc++) {
      total++;
      if (grid[r1+dr][c1+dc] === grid[r2+dr][c2+dc]) match++;
    }
  return match / total;
}
```

If this were part of the perceptual toolkit, the agent might compare the HUD pattern at (55,3)-(60,8) with the goal box pattern at (9,33)-(14,38) and notice they are similar but not identical. This would trigger the question "How do I make them match?" -- which leads directly to pattern toggles.

### 8c. Map Persistence

Currently, each react agent builds a cell map from scratch (2-3 iterations, 4+ actions). If the map were stored in `__level_task.priorMap`, subsequent attempts could skip mapping entirely. This is low-hanging fruit:

```javascript
// React agent return value
return(JSON.stringify({
  ...result,
  cellMap: __cellMap,  // 12x12 array of color indices
  playerPos: __playerPos,
  objectPositions: __objects,
}));

// Orchestrator stores it
__levelMaps[level] = childResult.cellMap;

// Next react agent reads it
const priorMap = __level_task.priorMap;
if (priorMap) {
  __cellMap = priorMap;
  console.log("Using prior map -- skipping grid analysis.");
}
```

Cost savings: ~15 actions and ~$5 per level retry.

### 8d. Replay with Fresh Eyes

What if the orchestrator could tell a react agent: "Your predecessor reached cell (1,9) and the level didn't complete. Your predecessor thought the goal was to collect items. Ignore that hypothesis. What else could the win condition be?"

This is essentially a "second opinion" pattern. The first react agent explores and forms hypotheses. The second react agent receives the first agent's map and observations but is explicitly told to challenge the conclusions. The adversarial framing might trigger alternative reasoning paths.

### 8e. The Single-Agent Counterargument

Here is the uncomfortable truth: **a single Opus agent with 30 iterations got 14.3% (v1.7.0).** The multi-agent architecture gets 17%. The improvement is 2.7 percentage points at 6x the cost ($133 vs ~$22).

The single-agent approach has one massive advantage: **context continuity**. The single agent remembers everything it has observed across all iterations. It does not need to serialize knowledge into JSON and deserialize it. It does not lose spatial memory between attempts. It does not need a synthesizer because its own context window IS the synthesizer.

The multi-agent approach has one massive advantage: **fresh perspectives**. Each new react agent starts without the prior agent's biases. In theory, this should help break out of wrong hypotheses. In practice, the knowledge transfer pipeline reintroduces the same biases via the knowledge base.

**The breakeven analysis:** The multi-agent approach is worth the overhead only if it can solve levels that a single agent cannot. L1 was easy (both approaches solve it). L2 required 6 attempts, which a single agent with 30 iterations might accomplish in 1 attempt (since it would retain the map and path from prior iterations). L3 required the pattern-matching insight, which neither approach has found yet.

The multi-agent architecture's value proposition rests entirely on whether it can eventually solve the pattern-matching problem. If it cannot, the single-agent approach is strictly more efficient.

---

## 9. Trace Patterns: What the Model Spends Tokens On

### Code Dominance

The model's responses are 98% code, 2% reasoning text. This is exactly what the RLM tenets prescribe: "The sandbox IS the tool." But it means the model does almost no explicit deliberation. It goes straight from observation to action code without articulating a plan.

This works well for concrete tasks (move to position X, build a cell map, implement BFS). It fails for abstract reasoning (what is the win condition? why didn't the level complete? what is the relationship between these two patterns?).

### Consistent Code Patterns That Work

1. **Cell map construction:** Every react agent that maps the grid builds a 12x12 cell map by sampling center pixels. This pattern was discovered in the L2 attempt 6 algorithm and replicated in all subsequent attempts. It is reliable and efficient.

2. **BFS pathfinding:** When present, BFS always produces correct paths. The implementation is straightforward and consistent. But it only appears when explicitly requested or when the agent independently decides to write it (which happened in about 40% of react invocations).

3. **`diffGrids` usage:** The before/after comparison pattern (take grid snapshot, perform action, compare) works reliably for detecting movement and state changes. Every react agent uses this.

### Consistent Code Patterns That Fail

1. **Random exploration:** Several react agents fall into a pattern of `for (const dir of [1,2,3,4]) { arc3.step(dir); ... }` without computing a target destination. This wastes actions on undirected wandering.

2. **Component analysis without interpretation:** `findComponents(grid, bgColors)` produces a list of colored regions. The agent logs their positions and sizes but never asks "What does this component DO?" It catalogs objects without forming hypotheses about their function.

3. **Budget tracking failure:** The react agent tracks `__actionsUsed++` in code but then continues taking actions past the budget. The increment and the budget check are in different code paths, and the model sometimes writes the action code without the increment.

### Token Waste Patterns

1. **Re-deriving the perceptual toolkit.** Each react agent re-defines `diffGrids`, `colorFreqs`, `findComponents`, and `renderRegion` from scratch. These functions are identical across all invocations. If they were sandbox globals, 129 react iterations would save ~3,300 bytes each = ~426 KB of redundant output, or roughly $15-20 in output tokens.

2. **Verbose grid dumps.** The react agents frequently dump 20-30 rows of hex-encoded grid data to "see" what is happening. A human analyst would glance at the grid, but the model outputs it as a string and then tries to parse it in the next iteration's reasoning. The rendering is useful; the sheer volume is wasteful.

3. **Redundant knowledge serialization.** The orchestrator logs the full knowledge base in diagnostic output. By iteration 13, this is 9,856 characters of JSON printed to the console, then fed back as input to the next iteration. The knowledge base should be stored in a variable (which it is: `__knowledge`), not printed to output and re-parsed.

---

## 10. The Meta Question: Is Multi-Agent the Right Frame?

### Information-Theoretic Analysis

The game has a finite state space. Each level's grid is 64x64 = 4,096 cells with 16 possible values. The relevant state can be compressed to: player position (2 values), HUD pattern state (small), fuel level (1 value), and object states (~10 values). Total state: maybe 20 values.

The agent needs to discover:
1. What the player is (low complexity -- move and see what changes)
2. How to move (low complexity -- test 4 directions)
3. What each object does (medium complexity -- step on each, observe effects)
4. What the win condition is (HIGH complexity -- requires testing hypotheses about hidden relationships)

The multi-agent architecture excels at (1) and (2) because they are concrete observations. It struggles with (3) because it catalogs objects without testing their function. It fails at (4) because it has no mechanism for hypothesis generation and testing.

### The Fundamental Bottleneck

The bottleneck is not perception, memory, or navigation. It is **abductive reasoning** -- inferring the best explanation for an observation. When the agent reaches the goal and the level doesn't complete, it needs to reason: "What conditions could prevent level completion? My hypothesis (collect items) predicts the level should complete. It didn't. Therefore my hypothesis is wrong. What else could be required?"

This is a single reasoning step that costs maybe 100 tokens. But the architecture never allocates those 100 tokens. The react agent's next iteration is a code block that tries a different navigation path. The synthesizer analyzes what happened but only catalogs, never reasons abductively. The orchestrator trusts the knowledge base and delegates again.

### What Would Actually Move the Score

Ranked by expected impact:

1. **Add `pathfind(cellMap, start, goal)` to the react toolkit** -- Would have saved ~150 actions on L2 and probably 50+ on L3. Estimated score improvement: +5-10 points.

2. **Add `compareRegions()` to the react toolkit** -- Would enable discovering the pattern-matching mechanic. If L3 is solved, that alone is worth +172/192 actions or about 0% -> some positive score for L3. Potential: +15 points.

3. **Add a hypothesis falsification step** -- After each failed attempt, ask "Why didn't this work? What would explain the evidence?" Even a cheap model could do this. Potential: +20 points if it leads to pattern-matching discovery.

4. **Persist cell maps across attempts** -- Saves 3-5 iterations and 15-20 actions per retry. Potential: +5 points.

5. **Adaptive action budgets** -- Give later levels more budget (L3 baseline is 172!). Potential: +5-10 points.

6. **Remove the manager layer** -- Saves 24 Opus calls (~$18), eliminates pass-through latency, no functionality lost. Score impact: neutral. Cost impact: -15%.

### The Ceiling

Even with all the above improvements, the theoretical ceiling for this architecture is probably around 50-60%. Here is why:

- L1 (100%): Already solved optimally.
- L2 (19% -> ~90%): BFS pathfinding would solve it near-optimally. Some exploration tax remains.
- L3 (0% -> ~50%?): Pattern matching discovery would unlock it, but fuel management adds complexity.
- L4-L7 (0% -> ???): Unknown difficulty. L7 has fog of war, requiring a fundamentally different approach.

The architecture cannot reach 100% because:
- Each new level introduces novel mechanics that must be discovered through exploration
- Fuel management becomes increasingly tight in later levels
- Fog of war (L7) requires maintaining a mental map, which the observe-act loop does not support
- The agent has no way to plan multi-step strategies (e.g., "visit toggle A, then toggle B, then fuel refill, then goal")

### The Radical Alternative

What if instead of multi-agent delegation, we gave a single Opus agent:
- 30 iterations
- The perceptual toolkit (diffGrids, colorFreqs, findComponents, compareRegions)
- A pathfinding function (BFS)
- An explicit instruction to test hypotheses about win conditions
- A fuel tracking function

With these tools and 30 iterations of continuous context, the single agent would retain spatial memory, accumulate observations naturally, and could reason about win conditions across iterations without lossy serialization. The cost would be ~$22 instead of ~$133.

The multi-agent architecture's theoretical advantage -- fresh perspectives, parallel exploration -- has not materialized in practice. Each fresh agent inherits the same biased knowledge base and makes the same mistakes. Until the knowledge pipeline can transmit not just facts but also failed hypotheses and their refutations, the single-agent approach may be superior.

---

## 11. Concrete Recommendations

### Immediate (v2.3.0 candidates)

1. **Add `bfs(cellMap, start, goal)` to the react agent perceptual toolkit.** This is the single highest-ROI change. Estimated effort: 15 lines of code in the plugin.

2. **Add `compareRegions(grid, r1, c1, r2, c2, size)` to the toolkit.** Enables pattern-matching discovery. Estimated effort: 10 lines.

3. **Persist the cell map in the return value and pass it to subsequent attempts.** Add `cellMap` to the react agent's return payload and `priorMap` to `__level_task`.

4. **Adaptive action budgets.** Replace fixed 32 with `min(remaining * 0.25, level * 25 + 25)`. L1 gets 50, L3 gets 100, but never more than 25% of remaining actions.

5. **Remove the manager layer** or replace it with a conditional: use the manager only for retry logic, skip it for first attempts.

### Medium-term (v3.0.0 candidates)

6. **Add a hypothesis falsification step.** After each failed attempt, the orchestrator should ask: "The agent tried strategy X and failed Y times. What alternative strategies should be considered?" This can be a cheap Flash call.

7. **Add an explicit "why didn't it work?" instruction.** When the react agent reaches a potential goal and the level doesn't complete, the next iteration should include: "You reached cell (X,Y) and the level didn't complete. Before trying anything else, examine the grid for any differences between the goal icon and the HUD display."

8. **Instrument the HUD.** Add a utility function that extracts and renders the HUD bottom-left pattern as a small grid. Make it easy for the agent to compare HUD state to maze objects.

### Speculative (future research)

9. **Single-agent with enhanced toolkit.** Run the benchmark with a single Opus agent, 30 iterations, and the enhanced toolkit (BFS, compareRegions, HUD extraction). Compare against the multi-agent architecture at matched cost.

10. **Ensemble approach.** Run 3 cheap single-agent attempts (Sonnet, 15 iterations each) and have a Flash model synthesize their observations. Total cost: ~$15. May outperform a single $133 multi-agent run through diversity of exploration.

11. **Curriculum learning.** Run Level 1 first, identify what worked, then generate a "Level 1 playbook" that is injected into the Level 2 agent's prompt. This is what the current architecture tries to do, but with better compression (a human-written summary of the winning strategy rather than a JSON knowledge blob).

---

## 12. The Scoreboard: What This Run Taught Us

| Insight | Confidence | Actionable? |
|---------|-----------|-------------|
| BFS pathfinding is the #1 missing capability | Very high | Yes -- add to toolkit |
| Pattern matching was never discovered | Very high | Yes -- add compareRegions |
| The manager layer adds cost without value | High | Yes -- remove or simplify |
| Action budgets are too low for later levels | High | Yes -- make adaptive |
| Phantom mechanics (false beliefs) are the biggest risk | Very high | Medium -- needs hypothesis testing |
| Knowledge curation dropped the best open question | High | Medium -- improve question retention |
| The synthesizer catalogs but never reasons | High | Medium -- redesign or replace |
| The 98% code / 2% reasoning ratio hurts abstract problem-solving | Medium | Low -- architectural tension with RLM tenets |
| A single agent with better tools might outperform multi-agent at 6x lower cost | Medium | Yes -- run the experiment |
| The return value bottleneck loses spatial memory | High | Yes -- persist maps |

**Bottom line:** This run proved the multi-agent architecture can work (no state bugs, no timeouts, 2 levels completed). But it also revealed that the architecture's overhead is not yet justified by its results. The marginal improvement over single-agent (17% vs 14.3%) cost 6x more. The path forward is not more agents or more delegation -- it is better tools in the react agent's hands and a mechanism for the system to question its own assumptions.
