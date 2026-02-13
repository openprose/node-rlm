# Cross-System Analysis: Arcgentica (86%) vs node-rlm run-026 (65%)

## Executive Summary

This document provides a detailed comparison of 20 ARC-AGI-2 problems solved by two systems:

- **Arcgentica**: Python + numpy/scipy, Opus 4.6, pass@2, up to 10 sub-agents, 86% platform score (19.5/20 on these 20 tasks -- 4e34c42c received 0.5 partial credit)
- **node-rlm run-026**: JavaScript (Node.js REPL), Opus 4.6, pass@1, max-depth 2, 20 iterations, 9 driver plugins, 65% score (13/20)

Both systems use the same underlying LLM (Claude Opus 4.6). The performance gap (21 percentage points) therefore reflects differences in scaffolding, tooling, iteration budget, attempt count, and architectural choices -- not model capability.

### Score Breakdown

| Category | Count | Problems |
|----------|-------|----------|
| Both solved | 13 | 247ef758, 2ba387bc, 136b0064, 36a08778, 5961cc34, 6e453dd6, 7ed72f31, a251c730, aa4ec2a5, 8f3a5a89, b99e7126, db695cfb, cbebaa4b |
| Arcgentica only | 7 | 0934a4d8, 135a2760, 446ef5d2, 4e34c42c, 195c6913, 78332cb0, 89565ca0 |
| node-rlm only | 0 | (none) |

---

## Part 1: Per-Problem Comparison (All 20)

### Category 1: Both Solved (13 Problems)

---

#### arc-247ef758 -- Shape Placement at Border Marker Intersections

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 9 iterations, 333s. Single hypothesis (H1). Progressive structural decomposition: visualize -> find divider -> extract panels -> identify markers -> implement. Used numpy for grid operations. Single-shot correct implementation at iter 6.
- *node-rlm*: 11 iterations, 152s. Three hypotheses tested (H1-H3). Same structural decomposition strategy. First implementation (H2) passed only 1/3 training due to missing multi-marker placement and overlap precedence. Refined to H3 with all-intersections + reverse painting order.

**Efficiency**: Arcgentica was more efficient in hypotheses (1 vs 3) but used more wall time (333s vs 152s). node-rlm used 2 more iterations but found the answer faster in real time.

**Key difference**: Arcgentica's extended reasoning in iter 3 (detailed analysis of marker-intersection patterns) prevented the multi-marker edge case that tripped up node-rlm. node-rlm discovered the multi-marker requirement through implementation failure and diagnosis, which is a valid but less efficient path. Both arrived at the same correct solution.

---

#### arc-2ba387bc -- Hollow vs Solid Block Classification

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 6 iterations, 93s. Single hypothesis. Used `scipy.ndimage.label` for connected component extraction. Classified blocks as hollow (12 cells) vs solid (16 cells) by checking interior cells. Single-shot implementation.
- *node-rlm*: 10 iterations, 99s. Three hypotheses (H1-H3). Used custom BFS for rectangle detection. Tested spatial proximity pairing (H1, rejected), row/column overlap pairing (H2, rejected), then found position-ordered pairing (H3, accepted). Single implementation attempt once H3 was confirmed.

**Efficiency**: Arcgentica solved in 6 iterations vs 10 for node-rlm. The difference: arcgentica used scipy.ndimage.label to immediately identify components and classify them, while node-rlm spent 3 iterations testing wrong pairing hypotheses before finding position-ordered pairing.

**Key difference**: scipy.ndimage.label gave arcgentica a structural advantage -- instant connected component analysis with classification. node-rlm's BFS-based approach worked but required more exploration to discover the pairing rule. The pairing rule itself (position-sorted frames with position-sorted solids) was the same in both systems.

---

#### arc-136b0064 -- Snake Path with Shape-Encoded Movements

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 9 iterations, 547s. Three hypotheses. The task was actually about correcting repeating tile patterns in bordered rectangular sections (tile detection with majority voting). Used scoring function `errors + 0.5 * tile_area` to select optimal tile size.
- *node-rlm*: 17 iterations, 285s. Four hypotheses. Same problem ID but the trajectory describes a different interpretation: a snake/path tracing task where 3x3 shapes encode directional movements. The agent discovered the left-then-right ordering and shape-to-movement-vector mapping.

**Note**: The two systems appear to have faced different test instances under the same task ID, or the trajectories describe different aspects. Looking at the data more carefully: arcgentica's trajectory for 136b0064 describes a tile-error-correction task (same as 135a2760), while node-rlm's trajectory describes a path-tracing task. The scores confirm both systems solved their respective interpretations correctly.

**Efficiency**: node-rlm used 17 iterations (vs 9) but less wall time (285s vs 547s). The path-tracing problem required more exploration iterations to understand the shape-to-movement encoding.

**Key difference**: Both systems succeeded through systematic hypothesis refinement. The arcgentica approach benefited from front-loaded reasoning (22K tokens analyzing tile theory before coding). node-rlm benefited from iterative exploration with code-based hypothesis testing.

---

#### arc-36a08778 -- Cascading Border Propagation (Seed Lines + 2-Bars)

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 7 iterations, 1963s (!). Single hypothesis, single implementation attempt. The defining feature: an **88,735-token reasoning block** in iteration 3 that traced the border propagation algorithm cell-by-cell across 5 examples before writing any code. The resulting implementation was bug-free on all 6 training examples.
- *node-rlm*: 18 iterations, 330s. Single hypothesis but 5 implementation attempts. Discovered the chaining pattern through 8 iterations of exploration, then spent 5 iterations debugging edge cases (walls extending too far, walls passing through used segments).

**Efficiency**: Arcgentica used fewer iterations (7 vs 18) but dramatically more wall time (1963s vs 330s). The 88K-token reasoning block consumed most of the time. node-rlm was faster in wall time but needed more iteration cycles to debug.

**Key difference**: This is the **most extreme example of the front-loaded reasoning advantage**. Arcgentica's system allowed the model to spend 88K tokens reasoning before writing a single line of code, producing a bug-free implementation. node-rlm's system encouraged writing code earlier, which led to 5 implementation attempts. The tradeoff: arcgentica was more correct upfront but slower; node-rlm was faster but required more debugging cycles.

---

#### arc-5961cc34 -- Beam Propagation Chain Reaction

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 5 iterations. Single hypothesis, single-shot implementation. Used scipy.ndimage.label for connected components and BFS for chain propagation. 25K-token reasoning block before coding.
- *node-rlm*: 14 iterations. Three hypotheses. Ray-tracing approach with progressive refinement (H1: simple extension -> H2: ray-tracing concept -> H3: correct boundary stopping).

**Efficiency**: Arcgentica solved in 5 iterations vs 14 for node-rlm. The scipy.ndimage.label library plus massive front-loaded reasoning enabled a single-shot solve.

**Key difference**: scipy.ndimage.label was decisive here. Connected component labeling is the foundation of the solution (identify shapes, then trace beams between them). node-rlm had to implement flood-fill manually and spent more iterations understanding the boundary behavior of rays. The core algorithm (BFS chain propagation through connected shapes) was identical in both systems.

---

#### arc-6e453dd6 -- Shape Shifting + Hole Detection

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 6 iterations. Single hypothesis, single-shot implementation. Used scipy.ndimage.label for components and `binary_fill_holes` for topological hole detection. 12K-token reasoning block.
- *node-rlm*: 11 iterations. Three hypotheses (H1: simple gap -> H2: topological enclosure -> H3: enclosure + maxC constraint). Used custom flood-fill for both component detection and hole detection.

**Efficiency**: Arcgentica: 6 iterations. node-rlm: 11 iterations. The key difference was that `scipy.ndimage.binary_fill_holes` gave arcgentica instant hole detection, while node-rlm had to discover and implement flood-fill-based enclosure testing iteratively.

**Key difference**: The hypothesis progression in node-rlm (H1->H2->H3) is instructive. The agent first tried row-local gaps (too aggressive), then topological enclosure (still too aggressive), then enclosure + spatial constraint (correct). Arcgentica's extended reasoning avoided this churn by analyzing the full rule before coding. However, node-rlm's diagnostic logging at iter 7 (cross-referencing `hasMaxC`, `hasHole`, `has2` across all rows) was an excellent debugging technique.

---

#### arc-7ed72f31 -- Reflection Across Red Axes

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 5 iterations. Single hypothesis. scipy.ndimage.label with 8-connectivity for component extraction, then per-component axis classification and reflection.
- *node-rlm*: 10 iterations. Three hypotheses (H1: pattern recognition -> H2: 4-connectivity implementation, failed -> H3: 8-connectivity fix). Manual coordinate verification before implementation, then 4-to-8 connectivity fix.

**Efficiency**: Arcgentica: 5 iterations. node-rlm: 10 iterations.

**Key difference**: The 4-vs-8 connectivity bug in node-rlm's first implementation is a recurring theme. scipy.ndimage.label with a specified structuring element handles this automatically. node-rlm discovered the need for 8-connectivity through a failed implementation. Both systems correctly identified the three reflection types (point, horizontal, vertical) and implemented the same reflection formulas.

---

#### arc-a251c730 -- Template/Target Rectangle with Pattern Stamping

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 24 iterations. Three hypotheses, 8 implementation attempts. Struggled with rectangle detection in structured backgrounds (repeating tile pattern). Tried background-gap analysis (failed), connected components (failed), then brute-force border scanning (worked after extensive debugging).
- *node-rlm*: 13 iterations. Two hypotheses, 2 implementations. Identified rectangle structure, used closest-center pattern extraction (failed with OOB error), then pivoted to connected-components clustering (correct).

**Efficiency**: node-rlm solved faster (13 vs 24 iterations). node-rlm's trajectory was more efficient because its connected-components approach for pattern extraction worked after just one pivot, while arcgentica struggled with rectangle detection for 10+ iterations.

**Key difference**: This is one of the few problems where **node-rlm was more efficient than arcgentica**. The repeating background pattern made rectangle detection hard for both systems, but node-rlm's approach (find rectangles via border scanning, extract patterns via connected components) converged faster. Arcgentica's multiple failed detection approaches (background gaps, morphological operations) consumed many iterations.

---

#### arc-aa4ec2a5 -- Component Border/Hole Classification

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 9 iterations. Single hypothesis. scipy.ndimage.label for components, binary_fill_holes for hole detection, binary_dilation for border generation. Single-shot implementation.
- *node-rlm*: 12 iterations. Three hypotheses. Custom flood-fill for components and hole detection. First implementation failed (borders overwriting enclosed holes), fixed with order-of-operations adjustment.

**Efficiency**: Arcgentica: 9 iterations. node-rlm: 12 iterations. scipy's morphological operations (label, fill_holes, dilation) mapped perfectly to the problem, giving arcgentica a clean single-shot solve.

**Key difference**: node-rlm's border-overwriting-holes bug (iter 6-8) is an implementation detail that scipy's dilation handles automatically. The conceptual understanding was identical in both systems.

---

#### arc-8f3a5a89 -- Room Flood-Fill with Wall Component Borders

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 7 iterations, 1023s. Single hypothesis. 39,721-token reasoning block analyzing the transformation rule. scipy.ndimage.label for room and wall component labeling. Padded-grid technique for border walls.
- *node-rlm*: 17 iterations, 256s. Five hypotheses. Progressive refinement from basic flood-fill border (H1) through topological analysis (H2-H4) to correct 8-connectivity + component erasure (H5).

**Efficiency**: Arcgentica: 7 iterations (but 1023s). node-rlm: 17 iterations (but 256s). Again the front-loaded reasoning pattern: arcgentica spent massive tokens reasoning, then implemented near-correctly. node-rlm implemented earlier and debugged iteratively.

**Key difference**: node-rlm's trajectory shows excellent diagnostic methodology (5 hypothesis refinements, each building on the previous), but the sheer number of iterations required demonstrates the cost of not having scipy's component labeling and the model's inability to get it right in a single reasoning pass.

---

#### arc-b99e7126 -- Fractal Self-Similar Tile Pattern

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 6 iterations. Single hypothesis. Instantly recognized the fractal self-similarity pattern (micro tile pattern = macro tile arrangement). Single-shot implementation with tile extraction, majority voting, and translation search.
- *node-rlm*: 14 iterations. Three hypotheses. First tested geometric hypotheses (corner expansion H1, reflection H2) before discovering the pattern-matching approach (H3: anomaly color pattern = output shape on tile grid).

**Efficiency**: Arcgentica: 6 iterations. node-rlm: 14 iterations. Arcgentica's ability to recognize the fractal pattern in one reasoning pass was impressive. node-rlm needed 2 rejected hypotheses before finding the correct framing.

**Key difference**: This problem rewards abstract pattern recognition. Both systems eventually found the same insight (micro pattern = macro pattern), but arcgentica found it in iteration 2 while node-rlm found it in iteration 9. The extra iterations for node-rlm were spent testing geometric hypotheses that, while reasonable, were wrong.

---

#### arc-db695cfb -- Diagonal Line Drawing + 6-Activation

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 6 iterations. Single hypothesis. Identified the diagonal pairing rule and 6-activation pattern using simple-to-complex reasoning (starting with the simplest example that had no 6s).
- *node-rlm*: 10 iterations. Six hypotheses. Tested multiple diagonal relationship theories (H1-H5) before discovering the coordinate-based analysis (grouping by r+c and r-c) that revealed the perpendicular relationship.

**Efficiency**: Arcgentica: 6 iterations. node-rlm: 10 iterations.

**Key difference**: Arcgentica's simple-to-complex exploration strategy (start with the no-6s example to establish the base rule) was highly effective. node-rlm's coordinate-based breakthrough at iter 6 (grouping positions by r+c and r-c) was elegant but came after 5 iterations of point-by-point hypothesis testing.

---

#### arc-cbebaa4b -- Puzzle Assembly with Connector Ports

**Outcome**: Both solved (1.0 each)

**Approach comparison**:
- *Arcgentica*: 12 iterations. Two hypotheses, 2 implementation attempts. BFS assembly with per-shape matching (H1, passed 1/2 training), then global greedy matching (H2, passed 2/2).
- *node-rlm*: 18 iterations. Five hypotheses, 3 implementations. Same conceptual breakthrough (shapes connect via shared 2-positions) but more iterations to arrive at greedy best-match selection. Also attempted and failed RLM delegation.

**Efficiency**: Arcgentica: 12 iterations. node-rlm: 18 iterations.

**Key difference**: Both systems converged on the same algorithm (greedy BFS with best-match scoring). The extra iterations in node-rlm came from: (a) a failed delegation attempt (iter 10), (b) more exploration before implementing, and (c) one additional failed implementation version. The core algorithmic insight was identical.

---

### Category 1 Summary

Across the 13 problems both systems solved:

| Metric | Arcgentica (avg) | node-rlm (avg) | Ratio |
|--------|-----------------|----------------|-------|
| Iterations | 8.5 | 13.1 | 1.54x |
| Hypotheses tested | 1.5 | 3.2 | 2.13x |
| Implementation attempts | 1.5 | 2.0 | 1.33x |
| Hypotheses rejected | 0.5 | 1.8 | 3.6x |

Arcgentica is **1.54x more iteration-efficient** on problems both systems solve. The primary drivers are:
1. Front-loaded reasoning (large reasoning blocks before coding) reduces hypothesis churn
2. scipy.ndimage.label eliminates the need for manual flood-fill implementation and debugging
3. Pass@2 allows recovering from near-misses (though on most jointly-solved problems, attempt 0 was selected)

---

### Category 2: Arcgentica Solved, We Failed (7 Problems)

This is the critical category. For each problem we failed, I analyze what went wrong and what arcgentica did differently.

---

#### arc-0934a4d8 -- Nested Symmetry Grid (30x30, K=31 Mirror)

**Arcgentica**: Solved in 60 iterations with 1 sub-agent. Discovered K=31 double reflection symmetry + off-diagonal block transpose. Training: 4/4.

**node-rlm**: Score 0. 19 iterations. Found point symmetry (r,c) <-> (31-r, 31-c) and validated 4/4 training. Test failed due to out-of-bounds: the 8-region at cols 0-2 mapped to col 31 (OOB). Fallback using row-only symmetry produced `[8,8,8]` instead of `[7,7,9]`.

**What arcgentica did differently**: After discovering the K-mirror rule also produced OOB, arcgentica added a **third symmetry operation** (off-diagonal block transpose within the fundamental domain) that recovers values when both K-mirrors point OOB. This required understanding the grid's full symmetry group, not just the K-mirror.

**Our failure mode**: Deadline pressure. The agent entered "DEADLINE mode" at iter 18/20, forcing a hasty fallback (row-only symmetry) without testing whether the fallback produced non-8 values. A sanity check ("does my output contain 8s?") would have flagged the problem.

**Could JS have solved it?**: Yes, with a better strategy. The core issue was not language-dependent. The agent needed: (a) more iterations to explore OOB fallback strategies, (b) a sanity check that the output shouldn't contain 8s, (c) awareness that the grid has a deeper symmetry group than just K-mirrors.

**Specific recommendation**: Add a driver that detects when a symmetry formula produces OOB indices and prompts: "When your symmetry formula goes out of bounds, the boundary cells may follow a different rule. Test multiple fallback strategies on training data before applying to test. Also verify your output doesn't contain the mask value."

---

#### arc-135a2760 -- Repeating Tile Error Correction

**Arcgentica**: Solved in 17 iterations. Used scoring function `errors + 0.5 * tile_area` to select optimal tile period. Iteratively refined penalty parameter from threshold-based (0.2) to score-based (penalty=1.0) to optimized (penalty=0.5). Inspected challenge output at each stage to catch issues masked by perfect training accuracy.

**node-rlm**: Score 0. 19 iterations. Found the same tile-detection approach and achieved 2/2 training. But the tile selection heuristic ("prefer smallest tile with score >= 0.85") selected wrong tile periods for 3 of 4 test regions. Detected the problem at iter 12 but all refinement attempts broke training. Reverted to original solution under deadline pressure. 96% of cells correct but score=0 due to exact-match grading.

**What arcgentica did differently**: Arcgentica's key advantage was **challenge output inspection after each refinement**. When the threshold approach masked wrong tiles on training, arcgentica caught it by visually inspecting the challenge output. Arcgentica also derived the penalty parameter analytically (computing crossover points between competing tiles) rather than guessing.

**Our failure mode**: incorrect-tile-period-detection. The "prefer smallest tile" heuristic worked on simple training examples but failed on more complex test regions with larger vertical periods (4x3, 4x4 tiles needed but 1x3 selected).

**Could JS have solved it?**: Yes. The algorithmic fix is well-defined: use `errors + 0.5 * tile_area` instead of "smallest tile above threshold." This is a pure scoring function change, not a language limitation.

**Specific recommendation**: (1) Implement the `errors + penalty * tile_area` scoring function as a utility in our tile detection toolkit with penalty=0.5 as default. (2) Add a driver that encourages inspecting test/challenge output even when training accuracy is 100%. (3) When tile score is below 0.95, flag the region as potentially using a wrong tile period.

---

#### arc-446ef5d2 -- Jigsaw Puzzle Assembly (Scattered Pieces)

**Arcgentica**: Solved in 83 iterations with 2 sub-agents. Explored multiple assembly strategies (edge matching, greedy BFS, canvas placement) before settling on a backtracking tiling solver with frame-border constraint. The frame-border constraint (outer edges of assembled rectangle must all be frame-colored) was the critical insight that made brute-force search tractable.

**node-rlm**: Score 0 (timeout). 20 iterations. Spent all 20 iterations in exploration and hypothesis refinement without ever writing a `solve()` function. Correctly identified the assembly pattern for both training examples but never transitioned from EXPLORE to EXTRACT phase.

**What arcgentica did differently**: Arcgentica committed to implementation early (iter 12) even with imperfect understanding, then iteratively refined through 6 implementation attempts. It also used sub-agents for parallel analysis. Crucially, arcgentica spent 30+ iterations on failed assembly approaches before finding backtracking, which required the large iteration budget (83 iterations) that our system lacks.

**Our failure mode**: Pure timeout due to over-analysis. The agent demonstrated 0 EXTRACT iterations and 0 implementation attempts in 20 iterations. This is the most extreme case of "analysis paralysis" in our dataset.

**Could JS have solved it?**: Extremely unlikely within 20 iterations. Arcgentica needed 83 iterations and 2 sub-agents. The problem requires: (a) piece extraction with compound piece splitting, (b) a backtracking tiling solver with frame-border constraints, (c) indicator/anchor detection. This is the most algorithically complex problem in the set.

**Specific recommendations**: (1) Add a phase-transition driver that forces implementation by iteration 12 (60% of budget). "By iteration 12, you must have attempted at least one `solve()` function, even if incomplete." (2) Increase iteration budget for complex problems (this alone would help significantly). (3) Add a "puzzle assembly" pattern recognizer that detects "scattered pieces on background" and routes to a backtracking solver template.

---

#### arc-4e34c42c -- Tile/Puzzle Edge-Overlap Assembly

**Arcgentica**: Partial credit (0.5). 22 iterations. Developed greedy assembly with pixel-count-weighted scoring. Got 1/2 test challenges correct. The fundamental limitation: greedy assembly doesn't handle 2D tree structures well (6 tiles with branching connections).

**node-rlm**: Score 0. 20 iterations. Successfully solved the 1D horizontal chaining pattern (2/2 training) but failed on test cases requiring 2D assembly. Discovered the 2D requirement at iter 19 (last iteration before deadline) -- too late to implement.

**What arcgentica did differently**: Arcgentica started with implementation earlier and iterated through 5 scoring function versions. The pixel-count weighting insight (rarer values weighted higher to prevent coincidental matches) was key. Even arcgentica only got 0.5/1.0 -- this was the hardest problem for both systems.

**Our failure mode**: Spent 7 iterations (10-16) on chain-ordering parameter search (diminishing returns) instead of checking whether the 1D chain assumption held for test data. Late test inspection (iter 18) revealed the 2D requirement but left no time to implement.

**Could JS have solved it?**: Partially. Getting to arcgentica's 0.5 is feasible with: (a) earlier test data inspection, (b) implementing both horizontal and vertical overlap matching, (c) pixel-count-weighted scoring. Getting to 1.0 would require a graph-based pairwise matching approach that neither system achieved.

**Specific recommendations**: (1) Add a driver: "After training validation, immediately inspect test case structure to verify your assumptions hold. If test cases have more objects or different layouts than training, your approach may need generalization." (2) Implement `findOverlap(obj1, obj2, direction)` supporting all 4 directions (not just horizontal). (3) Add value-rarity-weighted overlap scoring as a default.

---

#### arc-195c6913 -- Zigzag Path Through Blob Regions

**Arcgentica**: Solved in 109 iterations (!). Extremely thorough trajectory: 27 iterations of manual cell-by-cell tracing, then implementation that was 98%+ correct, fixed with a single boundary-stop conditional, then 42 iterations of redundant verification. The agent correctly identified the fixed RIGHT+UP direction rule and rejected a dynamic direction generalization.

**node-rlm**: Score 0. 19 iterations. Correctly understood the pattern by iter 13 (achieving 1 diff on Train 0). Failed to generalize the turn logic for Train 1 and 2 (52 and 93 diffs respectively). Attempted solve2 (boundary-following) and solve3 (boundary-hugging) but neither fixed the turn direction issue. Returned a known-failing solution.

**What arcgentica did differently**: Arcgentica's 27 iterations of pre-code exploration established the zigzag rule with complete confidence. The key insight (fixed RIGHT+UP directions, not dynamic) was proven by training data when a dynamic direction generalization (H3) broke an example. Arcgentica had the iteration budget (109) to make this mistake and recover.

**Our failure mode**: Turn direction logic. The core algorithm was correct for Train 0 (marker goes RIGHT then UP) but the turn direction heuristic ("try both perpendicular directions, pick whichever has bg1 cells") failed for Train 1/2 where staircase geometry differs. The agent understood the issue but couldn't fix it in the remaining iterations.

**Could JS have solved it?**: Yes, with more iterations and better debugging. The turn logic fix is not language-dependent. The agent needed to discover that the directions are fixed (always RIGHT and UP from the marker's perspective) rather than dynamically determined by local geometry.

**Specific recommendations**: (1) When a solution works on 1/3 training and the failure mode involves direction/orientation, explicitly test whether the directions are fixed constants (RIGHT+UP, LEFT+DOWN, etc.) before trying complex dynamic logic. (2) Sub-problem decomposition: trace just the path geometry first (verify on all training), then add pattern tiling. This isolates bugs faster.

---

#### arc-78332cb0 -- Panel Rearrangement Chain

**Arcgentica**: Solved in 7 iterations. Single hypothesis, single-shot implementation. 16K-token reasoning block analyzed panel structure, endpoint matching, and chain-building logic. Used edge_info (which edges have endpoints) to determine output orientation.

**node-rlm**: Score 0. 17 iterations. Ten hypotheses tested (H1-H10). Spent 9 iterations in hypothesis churn trying to find a unified block ordering rule. Eventually fell back to hardcoded case-specific rules (H10) that passed training but produced swapped dimensions on test.

**What arcgentica did differently**: Arcgentica immediately recognized this as a "chain panels by matching edge endpoints" problem and implemented a general solution. node-rlm got stuck trying to find an ordering/sorting rule (count-based, color-based, rotation-based, parity-based) when the real insight was about endpoint matching.

**Our failure mode**: Hypothesis lock-in on ordering/sorting approaches (9 iterations) followed by pragmatic but brittle hardcoding. The hardcoded rules overfitted to training transformations without discovering the underlying endpoint-matching rule. Critical miss: Test 1 input (23x5) exactly matched Train 0 output (23x5), signaling an inverse relationship the agent didn't notice.

**Could JS have solved it?**: Yes. This is a pure reasoning failure, not a tooling gap. The agent needed to: (a) abandon sorting hypotheses earlier, (b) focus on the endpoint connection structure, (c) verify test output dimensions match expected patterns.

**Specific recommendations**: (1) Add a driver: "If you've tested 5+ ordering/sorting hypotheses without success, step back and reconsider whether the transformation is about ordering at all. Consider structural matching, endpoint connections, or geometric operations." (2) Add dimension-checking sanity validation before returning.

---

#### arc-89565ca0 -- Compartment Counting with Noisy Grid Lines

**Arcgentica**: Solved in 25 iterations with 2 sub-agents. Identified noise color via fill ratio. Key insight: when detecting vertical lines, exclude rows that are horizontal lines (to prevent cross-contamination). Four hypothesis progressions: section counting (H1, failed) -> connected components (H2, failed) -> explicit line detection (H3, 2/3) -> refined line detection with mutual exclusion (H4, 3/3).

**node-rlm**: Score 0. 19 iterations. Same general approach (noise detection, grid structure analysis, staircase output). But never found the correct sorting property for rectangles. Tested cell counts (various thresholds), pixel counts, and overlap counts -- none matched expected ordering. Also hard-coded output width as 4 (from training) when expected was 6. Returned a known-failing answer under deadline pressure.

**What arcgentica did differently**: Arcgentica focused on getting the compartment count right (the sorting key is compartment count, which requires robust noisy-grid-line detection). The mutual exclusion insight (detect horizontal lines first, exclude those rows when detecting vertical lines) was the breakthrough. node-rlm never reliably computed compartment counts and thus never found the correct sort key.

**Our failure mode**: Two failures compounded: (1) never discovered the correct sorting property (compartment count), (2) hardcoded output width from training instead of computing it from data. The agent spent too many iterations on threshold tuning for grid analysis without ever successfully computing correct compartment counts.

**Could JS have solved it?**: Yes, but it requires robust grid-line detection with noise handling. The mutual-exclusion algorithm (horizontal lines first, then vertical lines excluding horizontal-line rows) is not language-dependent. However, scipy's connected component labeling would help with the final compartment counting step.

**Specific recommendations**: (1) Implement a reusable `detectGridLines(region, wallColor, noiseColor)` utility with the mutual-exclusion algorithm. (2) Never hard-code output dimensions from training -- always compute them from the discovered pattern. (3) When grid structure analysis gives inconsistent results across training examples, the analysis algorithm is wrong (not the task understanding).

---

### Category 3: node-rlm Solved, Arcgentica Didn't (0 Problems)

There are zero problems where node-rlm succeeded and arcgentica failed. This confirms that arcgentica's system is a strict superset of our capabilities on this problem set.

---

## Part 2: Cross-Cutting Analysis

### 1. The scipy/numpy Advantage

**Problems where scipy.ndimage.label was decisive:**
- **arc-2ba387bc**: Instant component extraction + classification (6 vs 10 iterations)
- **arc-5961cc34**: Connected component labeling for shapes + BFS chain (5 vs 14 iterations)
- **arc-6e453dd6**: Component labeling + binary_fill_holes (6 vs 11 iterations)
- **arc-7ed72f31**: 8-connectivity labeling (5 vs 10 iterations)
- **arc-aa4ec2a5**: Label + fill_holes + dilation (9 vs 12 iterations)
- **arc-8f3a5a89**: Label for both room fill and wall components (7 vs 17 iterations)

**Average iteration savings from scipy**: On these 6 problems, arcgentica averaged 6.3 iterations vs node-rlm's 12.3 iterations -- a **~2x efficiency gain** directly attributable to library support.

**Specific scipy operations and JS equivalents needed:**

| scipy operation | Use count | JS equivalent needed |
|----------------|-----------|---------------------|
| `ndimage.label(mask, structure)` | 10+ tasks | BFS/flood-fill with configurable connectivity (4 vs 8) |
| `binary_fill_holes(mask)` | 3 tasks | Flood-fill background from edges; unflooded interior = holes |
| `binary_dilation(mask, structure)` | 2 tasks | 8-neighbor expansion kernel |
| `np.bincount` / array ops | Most tasks | JS Array operations (already available) |

**Could we replicate these in JS?** Yes, absolutely. The operations themselves are well-defined algorithms (BFS, flood-fill, kernel convolution). The cost is implementation time and debugging. A pre-built `gridUtils` library with these primitives would close most of the scipy gap.

**Estimated impact**: Implementing a robust `gridUtils` library with connected component labeling (4/8 connectivity), hole detection, and morphological dilation would save ~3-5 iterations per problem, potentially converting 2-3 of our failures to successes (where the extra iterations would have provided enough time for refinement).

### 2. Hypothesis Efficiency

| Metric | Arcgentica (all 20) | node-rlm (all 20) |
|--------|---------------------|-------------------|
| Avg hypotheses tested | 2.1 | 4.4 |
| Avg hypotheses rejected | 1.0 | 3.2 |
| Avg breakthrough iteration | 8.3 (of variable max) | 8.8 (of 20) |
| Avg iters on rejected hypotheses | 4.3 | 4.9 |

Arcgentica tests **half as many hypotheses** as node-rlm. This is driven by front-loaded reasoning: arcgentica's large reasoning blocks (12K-88K tokens) work through multiple candidate hypotheses analytically before committing to code, while node-rlm tests hypotheses through code execution.

**Is arcgentica more efficient at hypothesis selection?** Yes, by approximately 2x. However, this comes at the cost of wall time (arcgentica reasoning blocks can take 30-120 seconds). The tradeoff depends on whether iteration budget or wall time is the binding constraint. For our system (hard 20-iteration limit), hypothesis efficiency is critical.

### 3. The pass@2 Effect

Arcgentica uses pass@2 (two independent attempts, best result submitted). Of the 20 problems:

- **10 problems** used attempt 0 (first attempt was best/sufficient)
- **10 problems** used attempt 1 (second attempt was better)

For problems where attempt 1 was selected, the first attempt typically had a longer trajectory or more hypothesis churn. Attempt 1 benefited from a "fresh start" with the same model, often finding a more efficient path.

**Would pass@2 have helped us on our 7 failures?**

- **arc-0934a4d8**: Possibly. A second attempt might try different OOB fallback strategies.
- **arc-135a2760**: Likely yes. The correct scoring function (penalty=0.5) was close to what we had; a fresh attempt with different tile selection heuristic would likely find it.
- **arc-446ef5d2**: Unlikely in 20 iterations. Even arcgentica needed 83 iterations.
- **arc-4e34c42c**: Possibly. A second attempt might start with 2D overlap detection.
- **arc-195c6913**: Likely yes. A fresh attempt knowing the "fixed directions" insight would avoid the turn-logic debugging.
- **arc-78332cb0**: Possibly. A fresh attempt might skip the sorting hypothesis churn.
- **arc-89565ca0**: Possibly. A fresh attempt with better grid-line detection might find compartment counts.

**Estimated impact of pass@2**: Could convert 2-4 failures to successes, bringing our score from 65% to ~75-85%.

### 4. Sub-Agent Usage

Arcgentica used sub-agents on 4 of 20 problems:

| Problem | Sub-agents | Was it helpful? |
|---------|-----------|----------------|
| arc-0934a4d8 | 1 | **Critical**: Sub-agent discovered K=31 mirror constant |
| arc-446ef5d2 | 2 | **Useful**: Parallel analysis of rule + challenge structure |
| arc-89565ca0 | 2 | **Marginal**: Main agent solved independently; sub-agents validated |
| arc-4e34c42c | 4 (attempt 1) | **Not helpful**: Permutation approach also failed |

Sub-agents were **decisive** in exactly 1 problem (0934a4d8) and **useful** in 1 more (446ef5d2). The pattern: sub-agents work best when the main agent has exhausted its local hypothesis space and needs a fresh perspective (0934a4d8 at iter 18 after 17 failed symmetry hypotheses).

**Could our system benefit from delegation?** node-rlm's cbebaa4b trajectory attempted delegation (child RLM at iter 10) which timed out. For our system, delegation would help most on problems requiring deep parallel exploration (symmetry search, assembly strategies). However, our max-depth-2 constraint limits this.

### 5. Front-Loaded Reasoning

Arcgentica's most distinctive pattern is massive reasoning blocks before writing code:

| Problem | Reasoning tokens (largest block) | Iterations to first code |
|---------|--------------------------------|-------------------------|
| arc-36a08778 | 88,735 tokens | 5 iterations |
| arc-8f3a5a89 | 39,721 tokens | 4 iterations |
| arc-5961cc34 | ~25,000 tokens | 3 iterations |
| arc-135a2760 | 21,918 tokens | 4 iterations |
| arc-136b0064 | 21,918 tokens | 4 iterations |
| arc-78332cb0 | 16,000 tokens | 3 iterations |
| arc-6e453dd6 | 12,000 tokens | 3 iterations |

**Average reasoning tokens before coding**: ~32K tokens across the top examples.

**node-rlm's pattern**: Write code earlier (typically by iteration 3-5), use code execution as the hypothesis-testing mechanism.

**Which approach works better?** On this dataset, front-loaded reasoning clearly wins: problems where arcgentica spent 20K+ tokens reasoning before coding had a **100% single-shot implementation success rate** (first implementation correct or within 1-2 cells of correct). node-rlm's code-first approach required 2-3 implementation attempts on average.

However, front-loaded reasoning requires: (a) the model spending many tokens on reasoning (cost), (b) system architecture that allows large reasoning blocks, (c) enough context to reason about all examples simultaneously.

**Could we replicate this?** Partially. Our system could add a "deep analysis" phase that explicitly prompts: "Before writing any code, spend time analyzing all training examples and formulating your complete algorithm. Trace through at least 2 examples manually." This wouldn't match arcgentica's 88K-token blocks but could significantly reduce implementation attempts.

### 6. Concrete Recommendations

Based on this analysis, here are the top changes to close the 21-point gap, ranked by estimated impact:

#### Recommendation 1: Implement pass@2 (Estimated: +10-15 points)

The single highest-impact change. A second independent attempt doubles the chance of finding the right approach, especially on problems where the first attempt gets stuck in a local optimum (wrong hypothesis space, brittle heuristic). Arcgentica selected attempt 1 on 50% of problems, confirming that a fresh start frequently outperforms continued refinement.

**Implementation**: Run the same task twice with independent seeds/contexts. Submit the answer that passes more training examples (or has higher soft accuracy if both pass all training).

#### Recommendation 2: Build a gridUtils Library (Estimated: +5-10 points)

Implement the following JS primitives:
- `labelComponents(grid, connectivity)` -- Connected component labeling (4 or 8 connectivity)
- `fillHoles(binaryMask)` -- Flood-fill from edges to find topological holes
- `dilate(binaryMask, connectivity)` -- Morphological dilation (8-neighbor expansion)
- `findRectangles(grid, borderColor)` -- Brute-force border scanning for rectangles
- `detectGridLines(region, wallColor, noiseColor)` -- Grid line detection with mutual exclusion
- `find2DTilePeriod(region, scoringFn)` -- 2D tile period detection with configurable scoring

These 6 functions cover the scipy operations used across all 20 problems. Average iteration savings: 3-5 per problem.

#### Recommendation 3: Add a "Deep Analysis Before Coding" Driver (Estimated: +5 points)

Add a driver that fires before the first implementation attempt, prompting:
> "Before writing code, trace through at least 2 training examples manually. For each example, write out the step-by-step transformation. Identify all edge cases visible in training. Only proceed to implementation when you can describe the complete algorithm."

This replicates arcgentica's front-loaded reasoning pattern within our iteration-constrained system.

#### Recommendation 4: Phase Transition Forcing (Estimated: +3-5 points)

The 446ef5d2 timeout (0 implementations in 20 iterations) and 78332cb0 hypothesis churn (10 hypotheses, 1 implementation) demonstrate the need for explicit phase transitions:
- By iteration 8 (40% of budget): Must have attempted at least one implementation
- By iteration 12 (60%): Must have a solution that passes at least 1 training example
- By iteration 16 (80%): Must be applying to test cases
- Before return(): Verify output dimensions match expected patterns; verify output doesn't contain mask/placeholder values

#### Recommendation 5: Test Data Pre-Inspection Driver (Estimated: +3 points)

Three of our 7 failures (4e34c42c, 78332cb0, 89565ca0) involved test cases that differed structurally from training. A driver that inspects test input structure early (by iteration 5) could catch these:
> "Inspect test inputs now. Compare: number of objects, grid dimensions, layout structure. If test inputs differ from training (more objects, different aspect ratios, 2D vs 1D layouts), your solution must handle these generalizations."

---

## Part 3: Appendix -- Iteration and Hypothesis Statistics

### Per-Problem Data Table

| Problem ID | Arc iters | Arc hyp | Arc time | RLM iters | RLM hyp | RLM time | Both? | Gap driver |
|-----------|----------|---------|----------|----------|---------|----------|-------|------------|
| 247ef758 | 9 | 1 | 333s | 11 | 3 | 152s | Both | Multi-marker edge case |
| 0934a4d8 | 60 | 6 | 876s | 19 | 9 | 209s | Arc only | OOB symmetry + sub-agent |
| 135a2760 | 17 | 3 | 1678s | 19 | 5 | 247s | Arc only | Tile scoring function |
| 2ba387bc | 6 | 1 | 93s | 10 | 3 | 99s | Both | scipy.ndimage.label |
| 136b0064 | 9 | 3 | 547s | 17 | 4 | 285s | Both | Front-loaded reasoning |
| 36a08778 | 7 | 1 | 1963s | 18 | 1 | 330s | Both | 88K reasoning block |
| 5961cc34 | 5 | 1 | n/a | 14 | 3 | 265s | Both | scipy + reasoning |
| 446ef5d2 | 83 | 4 | 1769s | 20 | 9 | 349s | Arc only | Backtracking solver + budget |
| 4e34c42c | 22 | 5 | 2557s | 20 | 8 | 421s | Arc only | 2D assembly awareness |
| 6e453dd6 | 6 | 1 | n/a | 11 | 3 | 156s | Both | binary_fill_holes |
| 7ed72f31 | 5 | 1 | 192s | 10 | 3 | n/a | Both | 8-connectivity |
| 195c6913 | 109 | 3 | 1104s | 19 | 5 | 806s | Arc only | Fixed directions + budget |
| 78332cb0 | 7 | 1 | n/a | 17 | 10 | 330s | Arc only | Endpoint matching insight |
| a251c730 | 24 | 3 | 684s | 13 | 2 | 190s | Both | Rectangle detection |
| aa4ec2a5 | 9 | 1 | 650s | 12 | 3 | 136s | Both | Morphological ops |
| 8f3a5a89 | 7 | 1 | 1023s | 17 | 5 | 256s | Both | 39K reasoning block |
| 89565ca0 | 25 | 4 | 819s | 19 | 5 | 364s | Arc only | Noisy grid-line detection |
| b99e7126 | 6 | 1 | 576s | 14 | 3 | 206s | Both | Fractal recognition |
| db695cfb | 6 | 1 | 512s | 10 | 6 | 159s | Both | Diagonal geometry |
| cbebaa4b | 12 | 2 | 1188s | 18 | 5 | 461s | Both | Greedy BFS assembly |

### Key Observations

1. **Iteration budget is the binding constraint for 3 of 7 failures**: 446ef5d2 (83 vs 20), 195c6913 (109 vs 19), and 0934a4d8 (60 vs 19) all required far more iterations than our 20-iteration limit. These problems are essentially unsolvable within 20 iterations even with perfect hypothesis selection.

2. **Hypothesis selection quality accounts for 2 of 7 failures**: 78332cb0 (10 hypotheses, all about ordering when the answer was endpoint matching) and 89565ca0 (never found correct sort key). These could be solved with better initial framing.

3. **Edge case handling accounts for 2 of 7 failures**: 135a2760 (wrong tile scoring) and 4e34c42c (1D-only overlap when 2D was needed). These are refinement failures -- the core approach was correct but insufficiently general.

4. **Wall time is NOT the binding constraint**: node-rlm is consistently faster in wall time (often 2-5x faster). Arcgentica's wall time is dominated by massive reasoning blocks. Our faster execution speed means we could potentially do more iterations per unit time.

5. **Zero problems where node-rlm beat arcgentica**: This is a one-directional comparison -- every problem we solve, arcgentica also solves. Our 13/20 is a strict subset of arcgentica's 19.5/20. The question is purely "how do we close the gap?" not "what are we doing right that they're not?"
