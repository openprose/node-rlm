# Analysis 006: Algorithmic-Analysis Driver

**Date:** 2026-02-13
**Model:** Claude Opus 4.6
**Benchmark:** ARC-AGI-2, same 20 tasks as all prior runs
**Run ID:** 22006123877 (GitHub Actions run-035)
**Commit:** `2f2285b`

---

## Configuration

| Parameter | Run-026 (baseline best) | Run-035 (this run) |
|---|---|---|
| Drivers | 9 composable | **10** (same 9 + `algorithmic-analysis`) |
| Model | claude-opus-4-6 | claude-opus-4-6 |
| Max iterations | 20 | 20 |
| Max depth | 2 | 2 |
| Blocks/iteration | 1 | 1 |

The only change is adding `algorithmic-analysis` to the driver stack.

---

## Score Summary

| Metric | Run-026 (baseline) | Run-035 (algorithmic) | Delta |
|--------|:---:|:---:|:---:|
| **Overall** | **13/20 (65%)** | **12/20 (60%)** | **-1** |
| Mean iterations | — | 15.3 | — |
| Wall time | — | 22m 21s | — |

**Net result: -5pp.** The algorithmic-analysis driver hurt performance.

---

## Per-Task Comparison

| Task ID | Run-026 | Run-035 | Delta | Category |
|---------|:---:|:---:|:---:|----------|
| arc-0934a4d8 | 0 (19i) | 0 (19i) | = | both-fail |
| arc-135a2760 | 0 (19i) | **1** (16i) | **+1** | **gained** |
| arc-136b0064 | **1** (17i) | **1** (17i) | = | both-pass |
| arc-195c6913 | 0 (19i) | 0 (19i) | = | both-fail |
| arc-247ef758 | **1** (11i) | **1** (16i) | = (+5i) | both-pass (slower) |
| arc-2ba387bc | **1** (10i) | **1** (11i) | = (+1i) | both-pass |
| arc-36a08778 | **1** (18i) | 0 (19i) | **-1** | **lost** |
| arc-446ef5d2 | 0 (20i) | 0 (20i) | = | both-fail |
| arc-4e34c42c | 0 (20i) | 0 (20i) | = | both-fail |
| arc-5961cc34 | **1** (14i) | **1** (16i) | = (+2i) | both-pass |
| arc-6e453dd6 | **1** (11i) | **1** (10i) | = (-1i) | both-pass |
| arc-78332cb0 | 0 (17i) | 0 (19i) | = | both-fail |
| arc-7ed72f31 | **1** (10i) | **1** (13i) | = (+3i) | both-pass |
| arc-8f3a5a89 | **1** (17i) | **1** (14i) | = (-3i) | both-pass |
| arc-89565ca0 | 0 (19i) | 0 (19i) | = | both-fail |
| arc-a251c730 | **1** (13i) | **1** (11i) | = (-2i) | both-pass |
| arc-aa4ec2a5 | **1** (12i) | **1** (10i) | = (-2i) | both-pass |
| arc-b99e7126 | **1** (14i) | **1** (10i) | = (-4i) | both-pass |
| arc-cbebaa4b | **1** (18i) | 0 (19i) | **-1** | **lost** |
| arc-db695cfb | **1** (10i) | **1** (9i) | = (-1i) | both-pass |
| **Totals** | **13** | **12** | **-1** | |

**Gained 1:** arc-135a2760 (tile periodicity — the algorithmic analysis helped here)
**Lost 2:** arc-36a08778 (segment chaining), arc-cbebaa4b (object assembly)

---

## Driver Adoption Analysis

### Grand Survey (iteration 0)

The driver's flagship technique — a 6-section analysis battery in iteration 0 — was **partially adopted**. Every task ran exactly 2 of 6 sections:

| Section | Adopted | Rate |
|---------|:---:|:---:|
| Dimensional analysis | 20/20 | 100% |
| Color inventory | 20/20 | 100% |
| Color transition matrix | 0/20 | 0% |
| Change/diff analysis | 0/20 | 0% |
| Connected components | 0/20 | 0% |
| Symmetry transforms | 0/20 | 0% |

The model copied the dimensional analysis and color inventory verbatim from the driver template, but then diverged to print raw grids instead of running the heavier analyses. The Grand Survey was designed as a single dense code block; the model treated it as a menu and picked the lightest options.

### Novel Techniques

| Technique | Tasks using it | Correlation with success |
|-----------|:---:|---|
| Local rule mining (neighborhood radius) | 2/20 | Both passed (arc-a251c730, arc-db695cfb) |
| Tiling/tile detection | 4/20 | 1 pass, 3 fail |
| Periodicity detection | 3/20 | 1 pass, 2 fail |

The local rule mining technique was barely used. The tiling/period techniques appeared more often but mostly on tasks that failed anyway.

### Iteration Efficiency

For the 11 tasks that both runs solved:

| Metric | Run-026 | Run-035 | Delta |
|--------|:---:|:---:|:---:|
| Mean iterations | 12.6 | 12.1 | -0.5 |
| Faster in 035 | — | 6/11 | 55% |
| Slower in 035 | — | 4/11 | 36% |
| Same | — | 1/11 | 9% |

Mixed signal. Some tasks got slightly faster (b99e7126: 14i→10i, 8f3a5a89: 17i→14i), others slightly slower (247ef758: 11i→16i, 7ed72f31: 10i→13i). The analysis overhead in iteration 0 costs ~1 iteration but sometimes pays back later.

---

## What Happened on the Flipped Tasks

### Gained: arc-135a2760 (tile periodicity)

**Run-026:** Failed. Used a smallest-tile heuristic that selected a 1x3 tile over the correct 4x4 tile.
**Run-035:** Passed in 16 iterations. The algorithmic exploration of period detection across panels (periods 3, 6, 9) with majority-vote recovery led to the correct solution. The driver's periodicity emphasis directly contributed — the agent explored multiple tile periods systematically rather than committing to the first plausible one.

This is the clearest win for the driver's thesis: mathematical exploration of periodicity found the correct answer where heuristic commitment failed.

### Lost: arc-36a08778 (segment chaining)

**Run-026:** Passed in 18 iterations. Found the segment-chaining rule at iter 5, then debugged through 5 implementation attempts (v1: 1/6, v2: 0/6, v3: 4/6, v4: 6/6).
**Run-035:** Failed in 19 iterations. Spent iterations 0-1 on the Grand Survey analysis (dimensions, color inventory, grid printing). Then spent iterations 2-9 analyzing segment structures in detail. Got to 5/6 training examples passing by iter 15, but couldn't fix the last edge case (Train 5: 239/240 cells correct, off by 1 cell). Ran out of budget.

**Root cause:** The Grand Survey consumed iteration 0 with generic analysis that didn't help this task (it's a spatial connectivity problem, not a color/dimension problem). This pushed the real work 1-2 iterations later, and the agent ran out of budget on the final edge case.

### Lost: arc-cbebaa4b (object assembly)

**Run-026:** Passed in 18 iterations. Found object placement rule through spatial analysis.
**Run-035:** Failed in 19 iterations. Spent 10+ iterations on detailed object analysis (bounding boxes, color analysis, 2-cell positions, connection graphs, translation vectors). Got close — correctly identified shift vectors for most objects — but the final assembly had errors on the test input. The additional analysis overhead didn't help and may have created more complexity to track.

**Root cause:** The driver encouraged over-analysis of object properties when the task needed spatial reasoning about connectivity. More math didn't help; the right hypothesis was needed earlier.

---

## Key Findings

### 1. The Grand Survey was too generic for ARC

The driver's iteration-0 template ran dimensions + color inventory on every task, regardless of problem type. For spatial/structural problems (segment chaining, object assembly), this analysis is irrelevant noise that wastes an iteration. ARC problems are too diverse for a one-size-fits-all analysis battery.

### 2. The model didn't adopt the heavy analyses

0/20 tasks used the color transition matrix, diff analysis, connected components, or symmetry checks from the Grand Survey template. The model consistently chose to print raw grids instead — suggesting it found visual inspection of small grids more useful than computed statistics.

### 3. Iteration budget pressure

Both lost tasks (arc-36a08778, arc-cbebaa4b) failed with 19 iterations — 1 short of budget. In both cases, the agent was very close to solving (239/240 cells, correct shift vectors). The 1-2 extra iterations spent on generic analysis in iteration 0 plausibly made the difference.

### 4. Where it helped, it helped clearly

The gained task (arc-135a2760) is a genuine win for the mathematical exploration thesis. Systematic period detection across multiple tile sizes found the correct answer where the baseline's heuristic commitment failed. The driver's emphasis on trying multiple mathematical hypotheses before committing was exactly right for this task.

### 5. Net effect: slight regression due to iteration tax

The driver adds ~1 iteration of overhead per task for generic analysis. For the 11 both-pass tasks, this is mostly absorbed. But for the 2 marginal tasks that needed every iteration, it pushed them over the edge.

---

## Recommendations

1. **Make the Grand Survey problem-type-adaptive** rather than one-size-fits-all. Dimension analysis should trigger different follow-up analyses (same dims → diff/transition analysis; different dims → tiling/scaling analysis).

2. **Reduce the iteration-0 tax.** The survey should be shorter and more targeted. Print one training example visually + run the top 3 most discriminating analyses, not a fixed 6-section battery.

3. **The local rule mining technique has potential** but was barely used (2/20). Consider making it a required check for same-dimension problems, where it's most powerful.

4. **Consider splitting the driver** into problem-type-specific analysis modules rather than one monolithic driver. A "same-dims analysis" driver and a "dim-change analysis" driver would be more targeted.

5. **The periodicity/tiling analysis is the highest-value technique** — it directly caused the only gain. Consider extracting it into its own focused driver for tile/periodicity problems.
