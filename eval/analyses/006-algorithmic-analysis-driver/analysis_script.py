#!/usr/bin/env python3
"""
Comprehensive statistical comparison of ARC-AGI-2 eval runs:
  Run-026 (baseline best, 13/20 = 65%) vs Run-035 (algorithmic-analysis driver, 12/20 = 60%)
"""

import json
import numpy as np
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

# =============================================================================
# LOAD DATA
# =============================================================================

with open('/Users/sl/code/trinity/node-rlm/eval/analyses/004-opus-arc-drivers-vs-baseline/run-026-drivers/results/arc_anthropic_claude-opus-4-6_2026-02-13T17-38-47-083Z.json') as f:
    run026 = json.load(f)

with open('/Users/sl/code/trinity/node-rlm/eval/analyses/006-algorithmic-analysis-driver/run-035-algorithmic/results/arc_anthropic_claude-opus-4-6_2026-02-13T23-16-23-702Z.json') as f:
    run035 = json.load(f)

# Build task-id-indexed dicts for paired comparisons
r026 = {r['taskId']: r for r in run026['results']}
r035 = {r['taskId']: r for r in run035['results']}

task_ids = sorted(r026.keys())
assert set(task_ids) == set(r035.keys()), "Task IDs must match"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def cohens_d(x, y):
    """Cohen's d for paired samples."""
    diff = np.array(x) - np.array(y)
    return np.mean(diff) / np.std(diff, ddof=1) if np.std(diff, ddof=1) > 0 else 0.0

def bootstrap_ci(x, y, n_boot=10000, ci=0.95, seed=42):
    """Bootstrap 95% CI for mean difference (x - y)."""
    rng = np.random.RandomState(seed)
    diffs = np.array(x) - np.array(y)
    n = len(diffs)
    boot_means = np.array([np.mean(rng.choice(diffs, size=n, replace=True)) for _ in range(n_boot)])
    alpha = (1 - ci) / 2
    return np.percentile(boot_means, [alpha * 100, (1 - alpha) * 100])

def paired_test(x, y, name=""):
    """Run both paired t-test and Wilcoxon signed-rank, return results dict."""
    x, y = np.array(x, dtype=float), np.array(y, dtype=float)
    diff = x - y
    result = {
        'mean_x': np.mean(x),
        'mean_y': np.mean(y),
        'mean_diff': np.mean(diff),
        'median_diff': np.median(diff),
    }
    # Paired t-test
    t_stat, t_p = stats.ttest_rel(x, y)
    result['t_stat'] = t_stat
    result['t_p'] = t_p
    # Wilcoxon signed-rank (requires non-zero differences)
    nonzero_diff = diff[diff != 0]
    if len(nonzero_diff) > 0:
        w_stat, w_p = stats.wilcoxon(nonzero_diff)
        result['w_stat'] = w_stat
        result['w_p'] = w_p
    else:
        result['w_stat'] = np.nan
        result['w_p'] = np.nan
    # Effect size
    result['cohens_d'] = cohens_d(x, y)
    # Bootstrap CI
    ci_lo, ci_hi = bootstrap_ci(x, y)
    result['boot_ci_lo'] = ci_lo
    result['boot_ci_hi'] = ci_hi
    return result

def fmt_p(p):
    if p < 0.001:
        return f"{p:.2e}"
    return f"{p:.4f}"

def fmt_n(n, decimals=1):
    if abs(n) >= 1000000:
        return f"{n/1000000:.{decimals}f}M"
    if abs(n) >= 1000:
        return f"{n/1000:.{decimals}f}K"
    return f"{n:.{decimals}f}"

def summary_stats(arr):
    a = np.array(arr, dtype=float)
    return {
        'mean': np.mean(a),
        'median': np.median(a),
        'std': np.std(a, ddof=1),
        'min': np.min(a),
        'max': np.max(a),
        'sum': np.sum(a),
    }

# =============================================================================
# EXTRACT PAIRED DATA
# =============================================================================

scores_026, scores_035 = [], []
iters_026, iters_035 = [], []
wall_026, wall_035 = [], []
input_chars_026, input_chars_035 = [], []
output_chars_026, output_chars_035 = [], []
total_chars_026, total_chars_035 = [], []

for tid in task_ids:
    a, b = r026[tid], r035[tid]
    scores_026.append(a['score'])
    scores_035.append(b['score'])
    iters_026.append(a['iterations'])
    iters_035.append(b['iterations'])
    wall_026.append(a['wallTimeMs'])
    wall_035.append(b['wallTimeMs'])
    input_chars_026.append(a['charCount']['input'])
    input_chars_035.append(b['charCount']['input'])
    output_chars_026.append(a['charCount']['output'])
    output_chars_035.append(b['charCount']['output'])
    total_chars_026.append(a['charCount']['input'] + a['charCount']['output'])
    total_chars_035.append(b['charCount']['input'] + b['charCount']['output'])

# =============================================================================
# SECTION 0: SCORE COMPARISON
# =============================================================================

print("=" * 80)
print("SECTION 0: SCORE / ACCURACY COMPARISON")
print("=" * 80)

print(f"\nRun-026 (baseline): {sum(scores_026)}/20 = {sum(scores_026)/20*100:.0f}%")
print(f"Run-035 (algorithmic): {sum(scores_035)}/20 = {sum(scores_035)/20*100:.0f}%")

# McNemar's test for paired binary outcomes
both_pass = sum(1 for a, b in zip(scores_026, scores_035) if a == 1 and b == 1)
only_026 = sum(1 for a, b in zip(scores_026, scores_035) if a == 1 and b == 0)
only_035 = sum(1 for a, b in zip(scores_026, scores_035) if a == 0 and b == 1)
both_fail = sum(1 for a, b in zip(scores_026, scores_035) if a == 0 and b == 0)

print(f"\nContingency table:")
print(f"  Both pass: {both_pass}")
print(f"  Only Run-026 pass: {only_026}")
print(f"  Only Run-035 pass: {only_035}")
print(f"  Both fail: {both_fail}")

# McNemar's exact test
if only_026 + only_035 > 0:
    # Use binomial test for exact McNemar
    mcnemar_p = stats.binom_test(only_026, only_026 + only_035, 0.5) if hasattr(stats, 'binom_test') else stats.binomtest(only_026, only_026 + only_035, 0.5).pvalue
    print(f"  McNemar's exact test p-value: {fmt_p(mcnemar_p)}")
else:
    mcnemar_p = 1.0
    print(f"  McNemar's test: no discordant pairs")

# List specific tasks
print(f"\nTask-level breakdown:")
for tid in task_ids:
    s026, s035 = r026[tid]['score'], r035[tid]['score']
    marker = ""
    if s026 == 1 and s035 == 0: marker = " <-- REGRESSION"
    elif s026 == 0 and s035 == 1: marker = " <-- IMPROVEMENT"
    print(f"  {tid}: 026={s026} 035={s035}{marker}")

# =============================================================================
# SECTION 1: TOKEN / CHARACTER USAGE
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 1: TOKEN / CHARACTER USAGE")
print("=" * 80)

for label, d026, d035 in [
    ("Input Chars", input_chars_026, input_chars_035),
    ("Output Chars", output_chars_026, output_chars_035),
    ("Total Chars", total_chars_026, total_chars_035),
]:
    s026 = summary_stats(d026)
    s035 = summary_stats(d035)
    t = paired_test(d035, d026, label)  # positive = 035 uses more

    print(f"\n--- {label} ---")
    print(f"  {'Metric':<15} {'Run-026':>15} {'Run-035':>15} {'Diff':>15}")
    print(f"  {'Mean':<15} {s026['mean']:>15,.0f} {s035['mean']:>15,.0f} {t['mean_diff']:>+15,.0f}")
    print(f"  {'Median':<15} {s026['median']:>15,.0f} {s035['median']:>15,.0f} {t['median_diff']:>+15,.0f}")
    print(f"  {'Std':<15} {s026['std']:>15,.0f} {s035['std']:>15,.0f}")
    print(f"  {'Min':<15} {s026['min']:>15,.0f} {s035['min']:>15,.0f}")
    print(f"  {'Max':<15} {s026['max']:>15,.0f} {s035['max']:>15,.0f}")
    print(f"  {'Sum':<15} {s026['sum']:>15,.0f} {s035['sum']:>15,.0f}")
    print(f"  Paired t-test: t={t['t_stat']:.3f}, p={fmt_p(t['t_p'])}")
    print(f"  Wilcoxon signed-rank: W={t['w_stat']:.1f}, p={fmt_p(t['w_p'])}")
    print(f"  Cohen's d: {t['cohens_d']:.3f}")
    print(f"  Bootstrap 95% CI for diff: [{t['boot_ci_lo']:+,.0f}, {t['boot_ci_hi']:+,.0f}]")

# Cost comparison
print(f"\n--- Cost ---")
cost_026 = run026['aggregate']['costEstimateUsd']
cost_035 = run035['aggregate']['costEstimateUsd']
print(f"  Run-026: ${cost_026:.2f}")
print(f"  Run-035: ${cost_035:.2f}")
print(f"  Difference: ${cost_035 - cost_026:+.2f} ({(cost_035 - cost_026)/cost_026*100:+.1f}%)")
# Per-solve cost
solves_026 = sum(scores_026)
solves_035 = sum(scores_035)
print(f"  Cost per solve Run-026: ${cost_026/solves_026:.2f} ({solves_026} solves)")
print(f"  Cost per solve Run-035: ${cost_035/solves_035:.2f} ({solves_035} solves)")

# =============================================================================
# SECTION 2: WALL CLOCK TIME
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 2: WALL CLOCK TIME")
print("=" * 80)

s026 = summary_stats(wall_026)
s035 = summary_stats(wall_035)
t = paired_test(wall_035, wall_026, "Wall Time")

print(f"\n  {'Metric':<15} {'Run-026 (ms)':>15} {'Run-035 (ms)':>15} {'Diff (ms)':>15}")
print(f"  {'Mean':<15} {s026['mean']:>15,.0f} {s035['mean']:>15,.0f} {t['mean_diff']:>+15,.0f}")
print(f"  {'Median':<15} {s026['median']:>15,.0f} {s035['median']:>15,.0f} {t['median_diff']:>+15,.0f}")
print(f"  {'Std':<15} {s026['std']:>15,.0f} {s035['std']:>15,.0f}")
print(f"  {'Min':<15} {s026['min']:>15,.0f} {s035['min']:>15,.0f}")
print(f"  {'Max':<15} {s026['max']:>15,.0f} {s035['max']:>15,.0f}")
print(f"  {'Total':<15} {s026['sum']:>15,.0f} {s035['sum']:>15,.0f}")

print(f"\n  Mean (seconds): Run-026={s026['mean']/1000:.1f}s, Run-035={s035['mean']/1000:.1f}s")
print(f"  Total (minutes): Run-026={s026['sum']/60000:.1f}min, Run-035={s035['sum']/60000:.1f}min")
print(f"  Paired t-test: t={t['t_stat']:.3f}, p={fmt_p(t['t_p'])}")
print(f"  Wilcoxon signed-rank: W={t['w_stat']:.1f}, p={fmt_p(t['w_p'])}")
print(f"  Cohen's d: {t['cohens_d']:.3f}")
print(f"  Bootstrap 95% CI for diff (ms): [{t['boot_ci_lo']:+,.0f}, {t['boot_ci_hi']:+,.0f}]")

# Per-task wall time comparison
print(f"\n  Per-task wall time (seconds):")
print(f"  {'Task':<20} {'026 (s)':>10} {'035 (s)':>10} {'Diff (s)':>10} {'%Change':>10}")
for tid in task_ids:
    w026 = r026[tid]['wallTimeMs'] / 1000
    w035 = r035[tid]['wallTimeMs'] / 1000
    diff = w035 - w026
    pct = diff / w026 * 100 if w026 > 0 else 0
    print(f"  {tid:<20} {w026:>10.1f} {w035:>10.1f} {diff:>+10.1f} {pct:>+10.1f}%")

# =============================================================================
# SECTION 3: ITERATION COUNTS
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 3: ITERATION COUNTS")
print("=" * 80)

s026 = summary_stats(iters_026)
s035 = summary_stats(iters_035)
t = paired_test(iters_035, iters_026, "Iterations")

print(f"\n  All tasks (n=20):")
print(f"  {'Metric':<15} {'Run-026':>10} {'Run-035':>10} {'Diff':>10}")
print(f"  {'Mean':<15} {s026['mean']:>10.1f} {s035['mean']:>10.1f} {t['mean_diff']:>+10.1f}")
print(f"  {'Median':<15} {s026['median']:>10.1f} {s035['median']:>10.1f} {t['median_diff']:>+10.1f}")
print(f"  {'Std':<15} {s026['std']:>10.1f} {s035['std']:>10.1f}")
print(f"  {'Min':<15} {s026['min']:>10.0f} {s035['min']:>10.0f}")
print(f"  {'Max':<15} {s026['max']:>10.0f} {s035['max']:>10.0f}")
print(f"  Paired t-test: t={t['t_stat']:.3f}, p={fmt_p(t['t_p'])}")
print(f"  Wilcoxon: W={t['w_stat']:.1f}, p={fmt_p(t['w_p'])}")
print(f"  Cohen's d: {t['cohens_d']:.3f}")

# Both-pass tasks only
bp_iters_026 = [r026[tid]['iterations'] for tid in task_ids if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]
bp_iters_035 = [r035[tid]['iterations'] for tid in task_ids if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]

if len(bp_iters_026) > 1:
    print(f"\n  Both-pass tasks (n={len(bp_iters_026)}):")
    s_bp026 = summary_stats(bp_iters_026)
    s_bp035 = summary_stats(bp_iters_035)
    t_bp = paired_test(bp_iters_035, bp_iters_026, "Both-pass iters")
    print(f"  {'Metric':<15} {'Run-026':>10} {'Run-035':>10} {'Diff':>10}")
    print(f"  {'Mean':<15} {s_bp026['mean']:>10.1f} {s_bp035['mean']:>10.1f} {t_bp['mean_diff']:>+10.1f}")
    print(f"  {'Median':<15} {s_bp026['median']:>10.1f} {s_bp035['median']:>10.1f} {t_bp['median_diff']:>+10.1f}")
    print(f"  Paired t-test: t={t_bp['t_stat']:.3f}, p={fmt_p(t_bp['t_p'])}")
    print(f"  Wilcoxon: W={t_bp['w_stat']:.1f}, p={fmt_p(t_bp['w_p'])}")
    print(f"  Cohen's d: {t_bp['cohens_d']:.3f}")
    print(f"  Bootstrap 95% CI: [{t_bp['boot_ci_lo']:+.1f}, {t_bp['boot_ci_hi']:+.1f}]")

# Solved tasks: iteration comparison
print(f"\n  Per-task iteration counts:")
print(f"  {'Task':<20} {'026 iters':>10} {'035 iters':>10} {'Diff':>10} {'026 pass':>10} {'035 pass':>10}")
for tid in task_ids:
    i026 = r026[tid]['iterations']
    i035 = r035[tid]['iterations']
    s026v = r026[tid]['score']
    s035v = r035[tid]['score']
    diff = i035 - i026
    print(f"  {tid:<20} {i026:>10} {i035:>10} {diff:>+10} {s026v:>10} {s035v:>10}")

# =============================================================================
# SECTION 4: PER-ITERATION ANALYSIS
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 4: PER-ITERATION TRACE ANALYSIS")
print("=" * 80)

def extract_trace_stats(results_dict, task_ids):
    """Extract per-iteration stats from traces."""
    all_reasoning_lens = []
    all_code_lens = []
    all_output_lens = []
    all_error_counts = []
    iter0_reasoning = []
    iter0_code = []
    iter0_output = []
    iterN_reasoning = []
    iterN_code = []
    iterN_output = []

    per_task_avg_reasoning = []
    per_task_avg_code = []
    per_task_avg_output = []

    for tid in task_ids:
        r = results_dict[tid]
        trace = r.get('trace', [])
        task_reasoning = []
        task_code = []
        task_output = []

        for i, entry in enumerate(trace):
            reasoning_len = len(entry.get('reasoning', '') or '')
            code_parts = entry.get('code', []) or []
            code_len = sum(len(c) for c in code_parts) if isinstance(code_parts, list) else len(str(code_parts))
            output_len = len(entry.get('output', '') or '')
            has_error = 1 if entry.get('error') else 0

            all_reasoning_lens.append(reasoning_len)
            all_code_lens.append(code_len)
            all_output_lens.append(output_len)
            all_error_counts.append(has_error)
            task_reasoning.append(reasoning_len)
            task_code.append(code_len)
            task_output.append(output_len)

            if i == 0:
                iter0_reasoning.append(reasoning_len)
                iter0_code.append(code_len)
                iter0_output.append(output_len)
            else:
                iterN_reasoning.append(reasoning_len)
                iterN_code.append(code_len)
                iterN_output.append(output_len)

        if task_reasoning:
            per_task_avg_reasoning.append(np.mean(task_reasoning))
            per_task_avg_code.append(np.mean(task_code))
            per_task_avg_output.append(np.mean(task_output))

    return {
        'all_reasoning': all_reasoning_lens,
        'all_code': all_code_lens,
        'all_output': all_output_lens,
        'all_errors': all_error_counts,
        'iter0_reasoning': iter0_reasoning,
        'iter0_code': iter0_code,
        'iter0_output': iter0_output,
        'iterN_reasoning': iterN_reasoning,
        'iterN_code': iterN_code,
        'iterN_output': iterN_output,
        'per_task_avg_reasoning': per_task_avg_reasoning,
        'per_task_avg_code': per_task_avg_code,
        'per_task_avg_output': per_task_avg_output,
    }

ts026 = extract_trace_stats(r026, task_ids)
ts035 = extract_trace_stats(r035, task_ids)

print(f"\n  Total iterations analyzed: Run-026={len(ts026['all_reasoning'])}, Run-035={len(ts035['all_reasoning'])}")

# Per-iteration averages
for label, key in [("Reasoning length", "all_reasoning"), ("Code length", "all_code"), ("Output length", "all_output")]:
    s1 = summary_stats(ts026[key])
    s2 = summary_stats(ts035[key])
    print(f"\n  --- {label} (per iteration) ---")
    print(f"  {'Metric':<15} {'Run-026':>12} {'Run-035':>12}")
    print(f"  {'Mean':<15} {s1['mean']:>12,.0f} {s2['mean']:>12,.0f}")
    print(f"  {'Median':<15} {s1['median']:>12,.0f} {s2['median']:>12,.0f}")
    print(f"  {'Std':<15} {s1['std']:>12,.0f} {s2['std']:>12,.0f}")
    # Mann-Whitney U since these are unpaired (different number of iterations)
    u_stat, u_p = stats.mannwhitneyu(ts026[key], ts035[key], alternative='two-sided')
    print(f"  Mann-Whitney U: U={u_stat:.0f}, p={fmt_p(u_p)}")

# Iteration 0 analysis (paired by task)
print(f"\n  --- Iteration 0 comparison (paired, n=20) ---")
for label, key0 in [("Reasoning", "iter0_reasoning"), ("Code", "iter0_code"), ("Output", "iter0_output")]:
    t = paired_test(ts035[key0], ts026[key0])
    print(f"  {label}: 026 mean={np.mean(ts026[key0]):,.0f}, 035 mean={np.mean(ts035[key0]):,.0f}, "
          f"diff={t['mean_diff']:+,.0f}, t={t['t_stat']:.2f}, p={fmt_p(t['t_p'])}, d={t['cohens_d']:.3f}")

# Iteration 0 vs subsequent
print(f"\n  --- Iteration 0 vs subsequent iterations (within each run) ---")
for run_label, ts in [("Run-026", ts026), ("Run-035", ts035)]:
    for label, key0, keyN in [
        ("Reasoning", "iter0_reasoning", "iterN_reasoning"),
        ("Code", "iter0_code", "iterN_code"),
        ("Output", "iter0_output", "iterN_output"),
    ]:
        mean0 = np.mean(ts[key0])
        meanN = np.mean(ts[keyN])
        u_stat, u_p = stats.mannwhitneyu(ts[key0], ts[keyN], alternative='two-sided')
        print(f"  {run_label} {label}: iter0 mean={mean0:,.0f}, subsequent mean={meanN:,.0f}, "
              f"ratio={mean0/meanN:.2f}x, U-test p={fmt_p(u_p)}")

# Per-task average comparison (paired)
print(f"\n  --- Per-task average trace lengths (paired, n=20) ---")
for label, key in [("Reasoning", "per_task_avg_reasoning"), ("Code", "per_task_avg_code"), ("Output", "per_task_avg_output")]:
    t = paired_test(ts035[key], ts026[key])
    print(f"  {label}: 026 mean={np.mean(ts026[key]):,.0f}, 035 mean={np.mean(ts035[key]):,.0f}, "
          f"diff={t['mean_diff']:+,.0f}, p(t)={fmt_p(t['t_p'])}, d={t['cohens_d']:.3f}, "
          f"95% CI=[{t['boot_ci_lo']:+,.0f}, {t['boot_ci_hi']:+,.0f}]")

# Error rate
err_rate_026 = np.mean(ts026['all_errors'])
err_rate_035 = np.mean(ts035['all_errors'])
print(f"\n  Error rate (fraction of iterations with error):")
print(f"  Run-026: {err_rate_026:.3f} ({sum(ts026['all_errors'])}/{len(ts026['all_errors'])})")
print(f"  Run-035: {err_rate_035:.3f} ({sum(ts035['all_errors'])}/{len(ts035['all_errors'])})")

# =============================================================================
# SECTION 5: EFFICIENCY METRICS
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 5: EFFICIENCY METRICS")
print("=" * 80)

# Chars per iteration
chars_per_iter_026 = [total_chars_026[i] / iters_026[i] for i in range(20)]
chars_per_iter_035 = [total_chars_035[i] / iters_035[i] for i in range(20)]
input_per_iter_026 = [input_chars_026[i] / iters_026[i] for i in range(20)]
input_per_iter_035 = [input_chars_035[i] / iters_035[i] for i in range(20)]
output_per_iter_026 = [output_chars_026[i] / iters_026[i] for i in range(20)]
output_per_iter_035 = [output_chars_035[i] / iters_035[i] for i in range(20)]

# Wall time per iteration
wall_per_iter_026 = [wall_026[i] / iters_026[i] for i in range(20)]
wall_per_iter_035 = [wall_035[i] / iters_035[i] for i in range(20)]

for label, d026, d035 in [
    ("Total chars/iteration", chars_per_iter_026, chars_per_iter_035),
    ("Input chars/iteration", input_per_iter_026, input_per_iter_035),
    ("Output chars/iteration", output_per_iter_026, output_per_iter_035),
    ("Wall ms/iteration", wall_per_iter_026, wall_per_iter_035),
]:
    t = paired_test(d035, d026)
    print(f"\n  --- {label} ---")
    print(f"  Run-026: mean={np.mean(d026):,.0f}, median={np.median(d026):,.0f}")
    print(f"  Run-035: mean={np.mean(d035):,.0f}, median={np.median(d035):,.0f}")
    print(f"  Diff: {t['mean_diff']:+,.0f} ({t['mean_diff']/np.mean(d026)*100:+.1f}%)")
    print(f"  Paired t-test: t={t['t_stat']:.3f}, p={fmt_p(t['t_p'])}, d={t['cohens_d']:.3f}")
    print(f"  Bootstrap 95% CI: [{t['boot_ci_lo']:+,.0f}, {t['boot_ci_hi']:+,.0f}]")

# Cost per solve
print(f"\n  --- Cost per solve ---")
cps_026 = cost_026 / solves_026
cps_035 = cost_035 / solves_035
print(f"  Run-026: ${cps_026:.2f}/solve ({solves_026} solves @ ${cost_026:.2f} total)")
print(f"  Run-035: ${cps_035:.2f}/solve ({solves_035} solves @ ${cost_035:.2f} total)")
print(f"  Diff: ${cps_035 - cps_026:+.2f}/solve ({(cps_035 - cps_026)/cps_026*100:+.1f}%)")

# Chars per solve (for solved tasks only)
solved_chars_026 = [total_chars_026[i] for i in range(20) if scores_026[i] == 1]
solved_chars_035 = [total_chars_035[i] for i in range(20) if scores_035[i] == 1]
print(f"\n  --- Chars per solved task ---")
print(f"  Run-026: mean={np.mean(solved_chars_026):,.0f} (n={len(solved_chars_026)})")
print(f"  Run-035: mean={np.mean(solved_chars_035):,.0f} (n={len(solved_chars_035)})")

# For both-pass tasks (paired)
bp_total_026 = [total_chars_026[i] for i, tid in enumerate(task_ids) if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]
bp_total_035 = [total_chars_035[i] for i, tid in enumerate(task_ids) if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]
bp_wall_026 = [wall_026[i] for i, tid in enumerate(task_ids) if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]
bp_wall_035 = [wall_035[i] for i, tid in enumerate(task_ids) if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]

if len(bp_total_026) > 1:
    t_chars = paired_test(bp_total_035, bp_total_026)
    t_wall = paired_test(bp_wall_035, bp_wall_026)
    print(f"\n  --- Both-pass tasks efficiency (n={len(bp_total_026)}) ---")
    print(f"  Total chars: 026 mean={np.mean(bp_total_026):,.0f}, 035 mean={np.mean(bp_total_035):,.0f}, "
          f"diff={t_chars['mean_diff']:+,.0f}, p={fmt_p(t_chars['t_p'])}, d={t_chars['cohens_d']:.3f}")
    print(f"  Wall time:   026 mean={np.mean(bp_wall_026):,.0f}ms, 035 mean={np.mean(bp_wall_035):,.0f}ms, "
          f"diff={t_wall['mean_diff']:+,.0f}ms, p={fmt_p(t_wall['t_p'])}, d={t_wall['cohens_d']:.3f}")

# =============================================================================
# SECTION 6: TRACE DEPTH ANALYSIS
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 6: TRACE DEPTH ANALYSIS")
print("=" * 80)

# Per-iteration-index analysis (iteration 0, 1, 2, ... up to max)
max_iter = max(max(iters_026), max(iters_035))

def per_iteration_stats(results_dict, task_ids, max_iter):
    """Get stats per iteration index across all tasks."""
    stats_by_iter = {}
    for idx in range(max_iter):
        reasoning_lens = []
        code_lens = []
        output_lens = []
        error_count = 0
        total = 0
        for tid in task_ids:
            trace = results_dict[tid].get('trace', [])
            if idx < len(trace):
                entry = trace[idx]
                reasoning_lens.append(len(entry.get('reasoning', '') or ''))
                code_parts = entry.get('code', []) or []
                code_len = sum(len(c) for c in code_parts) if isinstance(code_parts, list) else len(str(code_parts))
                code_lens.append(code_len)
                output_lens.append(len(entry.get('output', '') or ''))
                if entry.get('error'):
                    error_count += 1
                total += 1
        if total > 0:
            stats_by_iter[idx] = {
                'n': total,
                'mean_reasoning': np.mean(reasoning_lens),
                'mean_code': np.mean(code_lens),
                'mean_output': np.mean(output_lens),
                'error_rate': error_count / total,
            }
    return stats_by_iter

pis026 = per_iteration_stats(r026, task_ids, max_iter)
pis035 = per_iteration_stats(r035, task_ids, max_iter)

print(f"\n  Per-iteration-index average lengths:")
print(f"  {'Iter':<6} {'n_026':>6} {'n_035':>6} | {'Reas_026':>10} {'Reas_035':>10} | {'Code_026':>10} {'Code_035':>10} | {'Out_026':>10} {'Out_035':>10} | {'Err%_026':>8} {'Err%_035':>8}")
for idx in range(min(20, max_iter)):
    if idx in pis026 or idx in pis035:
        s026 = pis026.get(idx, {})
        s035 = pis035.get(idx, {})
        n026 = s026.get('n', 0)
        n035 = s035.get('n', 0)
        print(f"  {idx:<6} {n026:>6} {n035:>6} | "
              f"{s026.get('mean_reasoning', 0):>10,.0f} {s035.get('mean_reasoning', 0):>10,.0f} | "
              f"{s026.get('mean_code', 0):>10,.0f} {s035.get('mean_code', 0):>10,.0f} | "
              f"{s026.get('mean_output', 0):>10,.0f} {s035.get('mean_output', 0):>10,.0f} | "
              f"{s026.get('error_rate', 0)*100:>7.1f}% {s035.get('error_rate', 0)*100:>7.1f}%")

# Code block size distribution
print(f"\n  Code block size distribution (chars):")
for label, key in [("Run-026", ts026), ("Run-035", ts035)]:
    arr = np.array(key['all_code'])
    pcts = np.percentile(arr, [10, 25, 50, 75, 90])
    print(f"  {label}: p10={pcts[0]:,.0f} p25={pcts[1]:,.0f} p50={pcts[2]:,.0f} p75={pcts[3]:,.0f} p90={pcts[4]:,.0f}")

print(f"\n  Reasoning length distribution (chars):")
for label, key in [("Run-026", ts026), ("Run-035", ts035)]:
    arr = np.array(key['all_reasoning'])
    pcts = np.percentile(arr, [10, 25, 50, 75, 90])
    print(f"  {label}: p10={pcts[0]:,.0f} p25={pcts[1]:,.0f} p50={pcts[2]:,.0f} p75={pcts[3]:,.0f} p90={pcts[4]:,.0f}")

print(f"\n  Output length distribution (chars):")
for label, key in [("Run-026", ts026), ("Run-035", ts035)]:
    arr = np.array(key['all_output'])
    pcts = np.percentile(arr, [10, 25, 50, 75, 90])
    print(f"  {label}: p10={pcts[0]:,.0f} p25={pcts[1]:,.0f} p50={pcts[2]:,.0f} p75={pcts[3]:,.0f} p90={pcts[4]:,.0f}")

# =============================================================================
# SECTION 7: EFFECT SIZE & CONFIDENCE SUMMARY
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 7: EFFECT SIZE & CONFIDENCE SUMMARY")
print("=" * 80)

effects = []

def add_effect(name, x, y, direction="035 vs 026"):
    """Compute and store effect size info. x=run035, y=run026."""
    t = paired_test(x, y)
    sig = "***" if t['t_p'] < 0.001 else "**" if t['t_p'] < 0.01 else "*" if t['t_p'] < 0.05 else "ns"
    d_interp = "negligible" if abs(t['cohens_d']) < 0.2 else "small" if abs(t['cohens_d']) < 0.5 else "medium" if abs(t['cohens_d']) < 0.8 else "large"
    effects.append({
        'name': name,
        'mean_diff': t['mean_diff'],
        'cohens_d': t['cohens_d'],
        'd_interp': d_interp,
        't_p': t['t_p'],
        'w_p': t['w_p'],
        'sig': sig,
        'ci_lo': t['boot_ci_lo'],
        'ci_hi': t['boot_ci_hi'],
    })
    return effects[-1]

# All 20 tasks
add_effect("Input chars (all)", input_chars_035, input_chars_026)
add_effect("Output chars (all)", output_chars_035, output_chars_026)
add_effect("Total chars (all)", total_chars_035, total_chars_026)
add_effect("Wall time ms (all)", wall_035, wall_026)
add_effect("Iterations (all)", iters_035, iters_026)
add_effect("Chars/iteration (all)", chars_per_iter_035, chars_per_iter_026)
add_effect("Input chars/iter (all)", input_per_iter_035, input_per_iter_026)
add_effect("Output chars/iter (all)", output_per_iter_035, output_per_iter_026)
add_effect("Wall ms/iter (all)", wall_per_iter_035, wall_per_iter_026)

# Both-pass tasks
if len(bp_total_026) > 1:
    bp_tids = [tid for tid in task_ids if r026[tid]['score'] == 1 and r035[tid]['score'] == 1]
    bp_input_026 = [r026[tid]['charCount']['input'] for tid in bp_tids]
    bp_input_035 = [r035[tid]['charCount']['input'] for tid in bp_tids]
    bp_output_026 = [r026[tid]['charCount']['output'] for tid in bp_tids]
    bp_output_035 = [r035[tid]['charCount']['output'] for tid in bp_tids]
    add_effect(f"Iterations (both-pass, n={len(bp_tids)})", bp_iters_035, bp_iters_026)
    add_effect(f"Total chars (both-pass, n={len(bp_tids)})", bp_total_035, bp_total_026)
    add_effect(f"Wall time (both-pass, n={len(bp_tids)})", bp_wall_035, bp_wall_026)

# Iteration 0 (paired by task)
add_effect("Iter-0 reasoning len", ts035['iter0_reasoning'], ts026['iter0_reasoning'])
add_effect("Iter-0 code len", ts035['iter0_code'], ts026['iter0_code'])

print(f"\n  {'Metric':<35} {'Mean Diff':>12} {'Cohen d':>10} {'Interp':>12} {'p(t)':>12} {'p(W)':>12} {'Sig':>5} {'95% CI':>25}")
for e in effects:
    ci_str = f"[{e['ci_lo']:+,.0f}, {e['ci_hi']:+,.0f}]"
    print(f"  {e['name']:<35} {e['mean_diff']:>+12,.1f} {e['cohens_d']:>+10.3f} {e['d_interp']:>12} {fmt_p(e['t_p']):>12} {fmt_p(e['w_p']):>12} {e['sig']:>5} {ci_str:>25}")

# Normality checks
print(f"\n  Shapiro-Wilk normality tests on paired differences:")
for label, x, y in [
    ("Total chars diff", total_chars_035, total_chars_026),
    ("Wall time diff", wall_035, wall_026),
    ("Iterations diff", iters_035, iters_026),
]:
    diff = np.array(x) - np.array(y)
    w_stat, w_p = stats.shapiro(diff)
    print(f"  {label}: W={w_stat:.4f}, p={fmt_p(w_p)} {'(non-normal)' if w_p < 0.05 else '(normal)'}")

# =============================================================================
# SECTION 8: SUMMARY TABLE
# =============================================================================

print("\n" + "=" * 80)
print("SECTION 8: SUMMARY COMPARISON TABLE")
print("=" * 80)

print(f"""
  +--------------------------------------------+------------------+------------------+------------------+
  | Metric                                     | Run-026 (base)   | Run-035 (algo)   | Difference       |
  +--------------------------------------------+------------------+------------------+------------------+
  | Score                                      | {sum(scores_026)}/20 (65%)      | {sum(scores_035)}/20 (60%)      | -1 task          |
  | McNemar's p-value                          |                  |                  | {fmt_p(mcnemar_p):>16} |
  +--------------------------------------------+------------------+------------------+------------------+
  | Total cost (USD)                           | ${cost_026:<16.2f} | ${cost_035:<16.2f} | ${cost_035-cost_026:<+15.2f} |
  | Cost per solve (USD)                       | ${cps_026:<16.2f} | ${cps_035:<16.2f} | ${cps_035-cps_026:<+15.2f} |
  +--------------------------------------------+------------------+------------------+------------------+
  | Mean iterations                            | {np.mean(iters_026):<16.1f} | {np.mean(iters_035):<16.1f} | {np.mean(iters_035)-np.mean(iters_026):<+15.1f}  |
  | Median iterations                          | {np.median(iters_026):<16.1f} | {np.median(iters_035):<16.1f} | {np.median(iters_035)-np.median(iters_026):<+15.1f}  |
  +--------------------------------------------+------------------+------------------+------------------+
  | Mean wall time (s)                         | {np.mean(wall_026)/1000:<16.1f} | {np.mean(wall_035)/1000:<16.1f} | {(np.mean(wall_035)-np.mean(wall_026))/1000:<+15.1f}  |
  | Total wall time (min)                      | {np.sum(wall_026)/60000:<16.1f} | {np.sum(wall_035)/60000:<16.1f} | {(np.sum(wall_035)-np.sum(wall_026))/60000:<+15.1f}  |
  +--------------------------------------------+------------------+------------------+------------------+
  | Mean input chars/task                      | {np.mean(input_chars_026):<16,.0f} | {np.mean(input_chars_035):<16,.0f} | {np.mean(input_chars_035)-np.mean(input_chars_026):<+15,.0f}  |
  | Mean output chars/task                     | {np.mean(output_chars_026):<16,.0f} | {np.mean(output_chars_035):<16,.0f} | {np.mean(output_chars_035)-np.mean(output_chars_026):<+15,.0f}  |
  | Mean total chars/task                      | {np.mean(total_chars_026):<16,.0f} | {np.mean(total_chars_035):<16,.0f} | {np.mean(total_chars_035)-np.mean(total_chars_026):<+15,.0f}  |
  +--------------------------------------------+------------------+------------------+------------------+
  | Mean input chars/iteration                 | {np.mean(input_per_iter_026):<16,.0f} | {np.mean(input_per_iter_035):<16,.0f} | {np.mean(input_per_iter_035)-np.mean(input_per_iter_026):<+15,.0f}  |
  | Mean output chars/iteration                | {np.mean(output_per_iter_026):<16,.0f} | {np.mean(output_per_iter_035):<16,.0f} | {np.mean(output_per_iter_035)-np.mean(output_per_iter_026):<+15,.0f}  |
  | Mean wall ms/iteration                     | {np.mean(wall_per_iter_026):<16,.0f} | {np.mean(wall_per_iter_035):<16,.0f} | {np.mean(wall_per_iter_035)-np.mean(wall_per_iter_026):<+15,.0f}  |
  +--------------------------------------------+------------------+------------------+------------------+
  | Error rate (per iteration)                 | {err_rate_026:<16.3f} | {err_rate_035:<16.3f} | {err_rate_035-err_rate_026:<+15.3f}  |
  +--------------------------------------------+------------------+------------------+------------------+
  | Mean iter-0 reasoning length               | {np.mean(ts026['iter0_reasoning']):<16,.0f} | {np.mean(ts035['iter0_reasoning']):<16,.0f} | {np.mean(ts035['iter0_reasoning'])-np.mean(ts026['iter0_reasoning']):<+15,.0f}  |
  | Mean iter-0 code length                    | {np.mean(ts026['iter0_code']):<16,.0f} | {np.mean(ts035['iter0_code']):<16,.0f} | {np.mean(ts035['iter0_code'])-np.mean(ts026['iter0_code']):<+15,.0f}  |
  +--------------------------------------------+------------------+------------------+------------------+
""")

print("=" * 80)
print("ANALYSIS COMPLETE")
print("=" * 80)
