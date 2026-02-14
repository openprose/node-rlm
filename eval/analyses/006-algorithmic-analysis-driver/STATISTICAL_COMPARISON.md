# Statistical Comparison: Run-026 (Baseline) vs Run-035 (Algorithmic-Analysis Driver)

**Date:** 2026-02-13
**Benchmark:** ARC-AGI-2 (20 tasks)
**Model:** claude-opus-4-6

## Executive Summary

The algorithmic-analysis driver (Run-035) scored 12/20 (60%) compared to the baseline's 13/20 (65%), a non-significant difference (McNemar's p=1.0). However, the algorithmic driver consumed **39.7% more tokens per iteration** (Cohen's d=2.84, p<0.001), costing **$20.30 vs $15.13** (+34%) with no accuracy benefit. The driver's "Grand Survey" bloats iteration-0 reasoning and code by ~95% and ~120% respectively (Cohen's d>5.7), and this overhead propagates through every subsequent iteration via the growing context window, making it strictly worse than the baseline on cost-effectiveness.

---

## 1. Accuracy / Score Comparison

| Metric | Run-026 (Baseline) | Run-035 (Algorithmic) |
|---|---|---|
| Score | 13/20 (65%) | 12/20 (60%) |
| McNemar's exact p-value | -- | 1.0000 |

### Contingency Table (Paired Binary Outcomes)

| | Run-035 Pass | Run-035 Fail |
|---|---|---|
| **Run-026 Pass** | 11 | 2 |
| **Run-026 Fail** | 1 | 6 |

- **Both pass:** 11 tasks
- **Only Run-026 pass (regressions):** 2 tasks (arc-36a08778, arc-cbebaa4b)
- **Only Run-035 pass (improvements):** 1 task (arc-135a2760)
- **Both fail:** 6 tasks

**Interpretation:** The 1-task difference is not statistically significant. With only 3 discordant pairs and a 2:1 split favoring the baseline, McNemar's exact test yields p=1.0. There is no evidence that the algorithmic-analysis driver improves or harms accuracy.

### Per-Task Breakdown

| Task | Run-026 | Run-035 | Note |
|---|---|---|---|
| arc-0934a4d8 | 0 | 0 | |
| arc-135a2760 | 0 | **1** | Improvement |
| arc-136b0064 | 1 | 1 | |
| arc-195c6913 | 0 | 0 | |
| arc-247ef758 | 1 | 1 | |
| arc-2ba387bc | 1 | 1 | |
| arc-36a08778 | **1** | 0 | Regression |
| arc-446ef5d2 | 0 | 0 | |
| arc-4e34c42c | 0 | 0 | |
| arc-5961cc34 | 1 | 1 | |
| arc-6e453dd6 | 1 | 1 | |
| arc-78332cb0 | 0 | 0 | |
| arc-7ed72f31 | 1 | 1 | |
| arc-89565ca0 | 0 | 0 | |
| arc-8f3a5a89 | 1 | 1 | |
| arc-a251c730 | 1 | 1 | |
| arc-aa4ec2a5 | 1 | 1 | |
| arc-b99e7126 | 1 | 1 | |
| arc-cbebaa4b | **1** | 0 | Regression |
| arc-db695cfb | 1 | 1 | |

---

## 2. Token / Character Usage

### 2.1 Per-Task Character Counts

| Metric | Run-026 | Run-035 | Difference |
|---|---|---|---|
| **Input Chars** | | | |
| Mean | 790,017 | 1,103,914 | +313,897 |
| Median | 851,788 | 1,185,670 | +307,860 |
| Std | 279,065 | 365,981 | |
| Min | 356,339 | 489,272 | |
| Max | 1,164,512 | 1,614,982 | |
| Sum | 15,800,335 | 22,078,284 | +6,277,949 |
| **Output Chars** | | | |
| Mean | 43,699 | 49,858 | +6,158 |
| Median | 42,118 | 50,120 | +6,361 |
| Std | 18,698 | 18,466 | |
| Sum | 873,988 | 997,152 | +123,164 |
| **Total Chars** | | | |
| Mean | 833,716 | 1,153,772 | +320,056 |
| Median | 899,157 | 1,234,948 | +300,076 |
| Sum | 16,674,323 | 23,075,436 | +6,401,113 |

### 2.2 Statistical Tests

| Comparison | Paired t (p) | Wilcoxon (p) | Cohen's d | 95% Boot CI |
|---|---|---|---|---|
| Input chars | t=7.07, **p<0.001** | W=0.0, **p<0.001** | +1.58 (large) | [+229,619, +399,290] |
| Output chars | t=1.69, p=0.107 | W=61.0, p=0.105 | +0.38 (small) | [-795, +13,250] |
| Total chars | t=6.87, **p<0.001** | W=0.0, **p<0.001** | +1.54 (large) | [+232,074, +410,122] |

**Interpretation:** The algorithmic driver uses massively more input characters -- a mean of +314K per task (+39.7%), with a huge effect size (d=1.58). This is overwhelmingly statistically significant (p<0.001 on both parametric and non-parametric tests). The Wilcoxon W=0.0 means every single task consumed more input chars under the algorithmic driver. Output chars show a non-significant increase (+14.1%).

### 2.3 Cost Comparison

| Metric | Run-026 | Run-035 | Difference |
|---|---|---|---|
| Total cost | $15.13 | $20.30 | +$5.17 (+34.2%) |
| Cost per solve | $1.16 | $1.69 | +$0.53 (+45.4%) |

**Interpretation:** The algorithmic driver costs 34% more overall and 45% more per successful solve, since it both costs more and solves fewer tasks. This is a substantial negative ROI.

---

## 3. Wall Clock Time

| Metric | Run-026 (ms) | Run-035 (ms) | Difference |
|---|---|---|---|
| Mean | 278,671 | 291,451 | +12,780 |
| Median | 251,258 | 295,204 | +26,306 |
| Std | 159,369 | 118,179 | |
| Min | 98,745 | 120,345 | |
| Max | 805,993 | 541,990 | |
| Total | 5,573,425 | 5,829,017 | +255,592 |

| Test | Statistic | p-value |
|---|---|---|
| Paired t-test | t=0.415 | 0.683 |
| Wilcoxon | W=70.0 | 0.202 |
| Cohen's d | +0.093 | negligible |
| Bootstrap 95% CI | [-51,347, +65,059] ms | |

**Note:** Shapiro-Wilk test indicates wall time differences are non-normally distributed (W=0.82, p=0.002), so the Wilcoxon test is more trustworthy here.

**Interpretation:** Wall clock time is statistically indistinguishable between runs. Despite consuming ~40% more input tokens, the algorithmic driver is not meaningfully slower in wall time. This suggests the extra tokens are processed within the same API call latency envelope, likely because the additional context window content adds marginal processing time compared to the fixed overhead of each API call.

### Per-Task Wall Time

| Task | Run-026 (s) | Run-035 (s) | Diff (s) | % Change |
|---|---|---|---|---|
| arc-0934a4d8 | 209.1 | 371.8 | +162.7 | +77.8% |
| arc-135a2760 | 246.6 | 225.4 | -21.2 | -8.6% |
| arc-136b0064 | 285.4 | 358.7 | +73.3 | +25.7% |
| arc-195c6913 | 806.0 | 354.6 | -451.4 | -56.0% |
| arc-247ef758 | 151.5 | 288.8 | +137.2 | +90.5% |
| arc-2ba387bc | 98.7 | 161.7 | +63.0 | +63.8% |
| arc-36a08778 | 329.7 | 542.0 | +212.3 | +64.4% |
| arc-446ef5d2 | 349.3 | 498.1 | +148.8 | +42.6% |
| arc-4e34c42c | 421.1 | 460.5 | +39.5 | +9.4% |
| arc-5961cc34 | 265.3 | 318.4 | +53.1 | +20.0% |
| arc-6e453dd6 | 156.0 | 120.3 | -35.7 | -22.9% |
| arc-78332cb0 | 329.9 | 336.3 | +6.4 | +1.9% |
| arc-7ed72f31 | 153.1 | 166.2 | +13.1 | +8.6% |
| arc-89565ca0 | 363.7 | 301.7 | -62.0 | -17.1% |
| arc-8f3a5a89 | 255.9 | 246.2 | -9.7 | -3.8% |
| arc-a251c730 | 189.9 | 190.1 | +0.3 | +0.1% |
| arc-aa4ec2a5 | 135.9 | 189.1 | +53.2 | +39.2% |
| arc-b99e7126 | 206.5 | 250.2 | +43.8 | +21.2% |
| arc-cbebaa4b | 460.6 | 307.5 | -153.0 | -33.2% |
| arc-db695cfb | 159.3 | 141.2 | -18.1 | -11.4% |

---

## 4. Iteration Counts

### 4.1 All Tasks (n=20)

| Metric | Run-026 | Run-035 | Diff |
|---|---|---|---|
| Mean | 15.4 | 15.3 | -0.1 |
| Median | 17.0 | 16.0 | -1.0 |
| Std | 3.7 | 4.0 | |
| Min | 10 | 9 | |
| Max | 20 | 20 | |

- Paired t-test: t=-0.103, p=0.919
- Wilcoxon: W=49.0, p=0.855
- Cohen's d: -0.023 (negligible)

### 4.2 Both-Pass Tasks (n=11)

| Metric | Run-026 | Run-035 | Diff |
|---|---|---|---|
| Mean | 12.6 | 12.5 | -0.2 |
| Median | 12.0 | 11.0 | -1.0 |

- Paired t-test: t=-0.222, p=0.829
- Wilcoxon: W=24.5, p=0.770
- Cohen's d: -0.067 (negligible)
- Bootstrap 95% CI: [-1.6, +1.4]

**Interpretation:** Iteration counts are virtually identical between runs. The algorithmic driver does not cause the model to use more or fewer iterations. The extra cost is purely from larger per-iteration token consumption, not from needing more iterations.

### 4.3 Per-Task Iteration Counts

| Task | Run-026 | Run-035 | Diff | 026 Pass | 035 Pass |
|---|---|---|---|---|---|
| arc-0934a4d8 | 19 | 19 | 0 | 0 | 0 |
| arc-135a2760 | 19 | 16 | -3 | 0 | 1 |
| arc-136b0064 | 17 | 17 | 0 | 1 | 1 |
| arc-195c6913 | 19 | 19 | 0 | 0 | 0 |
| arc-247ef758 | 11 | 16 | +5 | 1 | 1 |
| arc-2ba387bc | 10 | 11 | +1 | 1 | 1 |
| arc-36a08778 | 18 | 19 | +1 | 1 | 0 |
| arc-446ef5d2 | 20 | 20 | 0 | 0 | 0 |
| arc-4e34c42c | 20 | 20 | 0 | 0 | 0 |
| arc-5961cc34 | 14 | 16 | +2 | 1 | 1 |
| arc-6e453dd6 | 11 | 10 | -1 | 1 | 1 |
| arc-78332cb0 | 17 | 19 | +2 | 0 | 0 |
| arc-7ed72f31 | 10 | 13 | +3 | 1 | 1 |
| arc-89565ca0 | 19 | 19 | 0 | 0 | 0 |
| arc-8f3a5a89 | 17 | 14 | -3 | 1 | 1 |
| arc-a251c730 | 13 | 11 | -2 | 1 | 1 |
| arc-aa4ec2a5 | 12 | 10 | -2 | 1 | 1 |
| arc-b99e7126 | 14 | 10 | -4 | 1 | 1 |
| arc-cbebaa4b | 18 | 19 | +1 | 1 | 0 |
| arc-db695cfb | 10 | 9 | -1 | 1 | 1 |

---

## 5. Per-Iteration Trace Analysis

Total iterations analyzed: Run-026=308, Run-035=307.

### 5.1 Per-Iteration Average Lengths

| Metric | Run-026 | Run-035 | Mann-Whitney U | p-value |
|---|---|---|---|---|
| Reasoning (chars) | mean=2,732, med=2,694 | mean=3,248, med=3,232 | U=38,029 | **p<0.001** |
| Code (chars) | mean=2,317, med=2,290 | mean=2,808, med=2,805 | U=38,156 | **p<0.001** |
| Output (chars) | mean=928, med=568 | mean=1,148, med=693 | U=39,792 | **p<0.001** |

### 5.2 Iteration 0 Analysis (Paired, n=20)

| Component | Run-026 Mean | Run-035 Mean | Diff | Cohen's d | p-value |
|---|---|---|---|---|---|
| Reasoning | 762 | 1,484 | +722 (+94.8%) | **+5.79 (large)** | **p<0.001** |
| Code | 591 | 1,301 | +709 (+120.0%) | **+6.04 (large)** | **p<0.001** |
| Output | 2,868 | 4,888 | +2,020 (+70.4%) | +0.47 (small) | p=0.051 |

**Interpretation:** The iteration-0 effect is massive and consistent. The algorithmic-analysis driver injects a "Grand Survey" at the start -- a structured algorithmic decomposition of the task. This nearly doubles the reasoning length and more than doubles the code length at iteration 0. Cohen's d values above 5.0 indicate an extraordinarily large, deterministic effect -- essentially every single task shows this inflation.

### 5.3 Iteration 0 vs Subsequent Iterations

| Run | Component | Iter-0 Mean | Subsequent Mean | Ratio |
|---|---|---|---|---|
| Run-026 | Reasoning | 762 | 2,869 | 0.27x |
| Run-035 | Reasoning | 1,484 | 3,371 | 0.44x |
| Run-026 | Code | 591 | 2,437 | 0.24x |
| Run-035 | Code | 1,301 | 2,913 | 0.45x |
| Run-026 | Output | 2,868 | 793 | 3.62x |
| Run-035 | Output | 4,888 | 888 | 5.50x |

**Interpretation:** In both runs, iteration 0 has shorter reasoning/code (exploration phase) but longer output (initial data dump). The algorithmic driver increases the iter-0 ratios significantly -- iter-0 reasoning goes from 0.27x to 0.44x of the subsequent average, meaning the Grand Survey partially closes the gap between exploration and exploitation phases.

### 5.4 Per-Task Average Trace Lengths (Paired, n=20)

| Component | Run-026 Mean | Run-035 Mean | Diff | Cohen's d | p-value | 95% CI |
|---|---|---|---|---|---|---|
| Reasoning | 2,678 | 3,206 | +527 | +0.60 (medium) | **p=0.015** | [+159, +916] |
| Code | 2,261 | 2,772 | +511 | +0.59 (medium) | **p=0.016** | [+147, +891] |
| Output | 973 | 1,206 | +233 | +0.60 (medium) | **p=0.015** | [+89, +412] |

**Interpretation:** Even averaged across all iterations per task, the algorithmic driver produces medium-effect-size increases in all trace components. The per-task average reasoning is ~20% longer, code ~23% longer, and output ~24% longer.

### 5.5 Error Rates

| Metric | Run-026 | Run-035 |
|---|---|---|
| Errors / Iterations | 6/308 (1.9%) | 1/307 (0.3%) |

**Interpretation:** The algorithmic driver has a lower error rate, though the absolute numbers are small (6 vs 1 errors). This could suggest the structured analysis approach leads to fewer runtime errors, but the sample is too small to draw firm conclusions.

---

## 6. Efficiency Metrics

### 6.1 Per-Iteration Efficiency

| Metric | Run-026 | Run-035 | Diff | Cohen's d | p-value |
|---|---|---|---|---|---|
| Total chars/iter | 52,722 | 73,721 | +20,999 (+39.8%) | **+2.84 (large)** | **p<0.001** |
| Input chars/iter | 49,954 | 70,515 | +20,562 (+41.2%) | **+3.09 (large)** | **p<0.001** |
| Output chars/iter | 2,769 | 3,206 | +437 (+15.8%) | +0.44 (small) | p=0.067 |
| Wall ms/iter | 17,396 | 18,580 | +1,185 (+6.8%) | +0.15 (negligible) | p=0.500 |

**Interpretation:** The dominant effect is on input chars per iteration. The algorithmic driver adds ~20.5K input chars per iteration -- this is the accumulated cost of the Grand Survey content being included in the context window at every subsequent iteration. Despite this 41% increase in input tokens, wall time per iteration only increases by a negligible 6.8%, suggesting the API's time-to-first-token latency dominates over prompt processing time.

### 6.2 Cost per Solve

| Metric | Run-026 | Run-035 | Difference |
|---|---|---|---|
| Cost per solve | $1.16 | $1.69 | +$0.53 (+45.4%) |
| Mean chars per solved task | 700,981 | 902,815 | +201,834 (+28.8%) |

### 6.3 Both-Pass Tasks Efficiency (n=11)

| Metric | Run-026 | Run-035 | Diff | Cohen's d | p-value |
|---|---|---|---|---|---|
| Total chars | 615,837 | 883,134 | +267,297 | +1.22 (large) | **p=0.002** |
| Wall time (ms) | 187,049 | 221,003 | +33,954 | +0.68 (medium) | *p=0.048* |

**Interpretation:** Among the 11 tasks both runs solve, the algorithmic driver uses significantly more tokens (d=1.22, p=0.002) and is marginally slower in wall time (d=0.68, p=0.048). For the same correct answers, the algorithmic driver is strictly less efficient.

---

## 7. Trace Depth Analysis

### 7.1 Per-Iteration-Index Averages

| Iter | n(026) | n(035) | Reasoning 026 | Reasoning 035 | Code 026 | Code 035 | Output 026 | Output 035 | Err% 026 | Err% 035 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 20 | 20 | 762 | 1,484 | 591 | 1,301 | 2,868 | 4,888 | 0.0% | 0.0% |
| 1 | 20 | 20 | 1,470 | 2,390 | 1,216 | 2,035 | 1,900 | 1,323 | 0.0% | 0.0% |
| 2 | 20 | 20 | 2,341 | 2,851 | 2,005 | 2,445 | 1,101 | 1,280 | 0.0% | 0.0% |
| 3 | 20 | 20 | 2,490 | 3,072 | 2,106 | 2,618 | 946 | 1,264 | 5.0% | 0.0% |
| 4 | 20 | 20 | 2,636 | 3,584 | 2,189 | 3,095 | 932 | 634 | 0.0% | 0.0% |
| 5 | 20 | 20 | 2,883 | 3,406 | 2,352 | 2,919 | 705 | 842 | 0.0% | 0.0% |
| 6 | 20 | 20 | 2,758 | 3,845 | 2,247 | 3,348 | 631 | 582 | 0.0% | 0.0% |
| 7 | 20 | 20 | 3,394 | 3,355 | 2,907 | 2,859 | 844 | 802 | 0.0% | 0.0% |
| 8 | 20 | 20 | 2,755 | 3,058 | 2,305 | 2,617 | 732 | 960 | 10.0% | 0.0% |
| 9 | 20 | 19 | 2,516 | 2,917 | 2,145 | 2,466 | 622 | 968 | 0.0% | 0.0% |
| 10 | 17 | 16 | 3,152 | 3,061 | 2,686 | 2,580 | 515 | 785 | 5.9% | 6.2% |
| 11 | 15 | 14 | 3,747 | 3,886 | 3,237 | 3,326 | 678 | 604 | 0.0% | 0.0% |
| 12 | 14 | 14 | 2,765 | 3,806 | 2,353 | 3,333 | 621 | 825 | 7.1% | 0.0% |
| 13 | 13 | 13 | 4,229 | 3,709 | 3,744 | 3,222 | 400 | 684 | 0.0% | 0.0% |
| 14 | 11 | 12 | 3,744 | 3,426 | 3,293 | 2,934 | 725 | 1,033 | 0.0% | 0.0% |
| 15 | 11 | 12 | 3,255 | 2,773 | 2,825 | 2,319 | 660 | 703 | 0.0% | 0.0% |
| 16 | 11 | 9 | 3,002 | 3,768 | 2,597 | 3,373 | 381 | 822 | 9.1% | 0.0% |
| 17 | 8 | 8 | 2,934 | 5,492 | 2,479 | 5,019 | 572 | 1,303 | 0.0% | 0.0% |
| 18 | 6 | 8 | 2,546 | 3,762 | 2,054 | 3,436 | 469 | 262 | 0.0% | 0.0% |
| 19 | 2 | 2 | 4,564 | 6,813 | 4,282 | 6,566 | 271 | 244 | 0.0% | 0.0% |

**Interpretation:** The algorithmic driver's reasoning and code lengths are consistently higher across almost all iteration indices, with the gap being largest at iteration 0 (the Grand Survey) and iterations 1-6 (where the accumulated context from the survey inflates all subsequent prompts). By iterations 10+, the gap narrows somewhat as both runs enter late-game refinement.

### 7.2 Size Distributions

| Percentile | Reasoning 026 | Reasoning 035 | Code 026 | Code 035 | Output 026 | Output 035 |
|---|---|---|---|---|---|---|
| p10 | 679 | 1,318 | 506 | 1,024 | 64 | 161 |
| p25 | 1,644 | 2,180 | 1,244 | 1,752 | 223 | 404 |
| p50 | 2,694 | 3,232 | 2,290 | 2,805 | 568 | 693 |
| p75 | 3,508 | 3,978 | 3,063 | 3,516 | 1,104 | 1,256 |
| p90 | 4,536 | 5,029 | 4,131 | 4,500 | 2,112 | 2,307 |

**Interpretation:** The entire distribution shifts rightward for the algorithmic driver. The p10 for code nearly doubles (506 to 1,024), indicating the floor is raised -- even the shortest iterations are substantially longer.

---

## 8. Effect Size and Confidence Summary

| Metric | Mean Diff | Cohen's d | Interpretation | p(t-test) | p(Wilcoxon) | Sig | 95% Bootstrap CI |
|---|---|---|---|---|---|---|---|
| Input chars (all, n=20) | +313,897 | +1.58 | large | <0.001 | <0.001 | *** | [+229,619, +399,290] |
| Output chars (all, n=20) | +6,158 | +0.38 | small | 0.107 | 0.105 | ns | [-795, +13,250] |
| Total chars (all, n=20) | +320,056 | +1.54 | large | <0.001 | <0.001 | *** | [+232,074, +410,122] |
| Wall time ms (all, n=20) | +12,780 | +0.09 | negligible | 0.683 | 0.202 | ns | [-51,347, +65,059] |
| Iterations (all, n=20) | -0.1 | -0.02 | negligible | 0.919 | 0.855 | ns | [-1, +1] |
| Total chars/iter (all, n=20) | +20,999 | +2.84 | large | <0.001 | <0.001 | *** | [+17,792, +24,185] |
| Input chars/iter (all, n=20) | +20,562 | +3.09 | large | <0.001 | <0.001 | *** | [+17,699, +23,457] |
| Output chars/iter (all, n=20) | +437 | +0.44 | small | 0.067 | 0.090 | ns | [+13, +866] |
| Wall ms/iter (all, n=20) | +1,185 | +0.15 | negligible | 0.500 | 0.143 | ns | [-2,382, +4,137] |
| Iterations (both-pass, n=11) | -0.2 | -0.07 | negligible | 0.829 | 0.770 | ns | [-2, +1] |
| Total chars (both-pass, n=11) | +267,297 | +1.22 | large | 0.002 | <0.001 | ** | [+150,259, +393,917] |
| Wall time (both-pass, n=11) | +33,954 | +0.68 | medium | 0.048 | 0.054 | * | [+7,142, +63,101] |
| Iter-0 reasoning length | +722 | +5.79 | large | <0.001 | <0.001 | *** | [+669, +775] |
| Iter-0 code length | +710 | +6.04 | large | <0.001 | <0.001 | *** | [+659, +760] |

Significance: *** p<0.001, ** p<0.01, * p<0.05, ns = not significant.

### Normality of Paired Differences

| Comparison | Shapiro-Wilk W | p-value | Verdict |
|---|---|---|---|
| Total chars diff | 0.908 | 0.059 | Normal |
| Wall time diff | 0.821 | 0.002 | Non-normal |
| Iterations diff | 0.968 | 0.708 | Normal |

For wall time comparisons, the Wilcoxon signed-rank test should be preferred over the paired t-test due to non-normality.

---

## 9. Final Verdict

### Key Findings

1. **Accuracy: No benefit.** The algorithmic-analysis driver scored 12/20 vs 13/20 baseline. The difference is not statistically significant (McNemar's p=1.0), but the direction is negative.

2. **Token cost: Substantially worse.** The driver increases total token consumption by +38.4% (p<0.001, d=1.54). This is driven almost entirely by input chars (+39.7%), which accumulate because the Grand Survey output at iteration 0 is included in the context window for all subsequent iterations.

3. **Dollar cost: 34% more expensive overall, 45% more per solve.** At $20.30 vs $15.13 total, the algorithmic driver offers no value for additional cost.

4. **Wall time: No significant difference.** Despite 40% more tokens, wall time is essentially unchanged (d=0.09). The API latency structure absorbs the extra tokens.

5. **Iteration count: No difference.** The driver does not help the model converge faster. Mean iterations are 15.3 vs 15.4.

6. **Iteration-0 bloat confirmed.** The Grand Survey adds ~720 chars of reasoning and ~710 chars of code at iteration 0 (Cohen's d > 5.7 -- an extraordinarily large, deterministic effect). This overhead compounds through all subsequent iterations via context accumulation.

7. **Error rate: Slightly lower.** The algorithmic driver has fewer runtime errors (0.3% vs 1.9%), though absolute numbers are small.

### Overall Assessment

The algorithmic-analysis driver is a **net negative** intervention. It adds significant token overhead (+38% total, +41% per iteration) without improving accuracy, speed, or iteration efficiency. The only positive signal -- a marginally lower error rate -- is too small to offset the substantial cost increase. The hypothesis that a structured algorithmic survey at the start would help the model solve tasks more efficiently is not supported by this data. The Grand Survey appears to consume budget that would be better spent on the model's natural exploration process.

**Recommendation:** Do not adopt the algorithmic-analysis driver. Return to the baseline configuration.
