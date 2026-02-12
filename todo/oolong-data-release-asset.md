# OOLONG Data: GitHub Release Asset + Actions Cache

## Problem

The OOLONG eval downloads ~1,300 rows from HuggingFace's Datasets Server API (paginated, 20 rows/page) every CI run. This takes 10-15 minutes, is unreliable (HF 500 errors, rate limits, skipped pages), and the current local download is incomplete (700/1300 rows, missing all context lengths > 16K).

The eval only needs `trec_coarse` rows (650 of 1300). The `spam` rows are never used. For the paper's Table 1, only 131K context is needed (50 rows). For scaling experiments (Figure 1), all 11 context lengths are needed (550 rows).

## Plan

### Phase 1: Download all trec_coarse data locally

- [x] Downloaded all 650 trec_coarse rows via HF filter API (paginated, dataset='trec_coarse')
- [x] Filtered to the 11 context lengths used by the paper (1K-1M) = 550 rows
- [x] Verified: 50 rows x 11 context lengths = 550 rows
- [x] Compressed: `oolong-trec-coarse-validation.jsonl.gz` = **134 MB** (535 MB uncompressed)

Note: The HF dataset has 13 context lengths (up to 4M), but the paper only uses 11 (up to 1M). Dropping the 2M and 4M rows saves ~400MB compressed. Use `--from-hf` if those are ever needed.

### Phase 2: Create GitHub Release with data asset

- [x] Created release `eval-data-v1` via `gh release create`
- [x] Uploaded `oolong-trec-coarse-validation.jsonl.gz` (134 MB)
- [x] URL: https://github.com/openprose/node-rlm/releases/tag/eval-data-v1

### Phase 3: Update download.ts

- [x] Added `--from-release` mode (default) — streams from GitHub Release asset, gunzips to `validation.jsonl`
- [x] Kept `--from-hf` for regenerating data from HuggingFace
- [x] TypeScript compiles clean, all 82 tests pass

### Phase 4: Update GitHub Actions workflow

- [x] Added `actions/cache@v4` for `eval/data/oolong/` with key `oolong-eval-data-v1`
- [x] On cache miss, downloads from release asset (`npx tsx eval/download.ts --from-release`)
- [x] Removed `NODE_OPTIONS: --max-old-space-size=4096` from download step (streaming = low memory)

### Phase 5: Verify loader compatibility

- [x] `loadOolongTasks()` works unchanged — reads `validation.jsonl` as before
- [x] Tested locally: loads 5 tasks from 131K context length correctly

## Actual Data Sizes

| Scope | Rows | Uncompressed | Gzipped |
|---|---|---|---|
| Table 1 only (131K) | 50 | ~15 MB | ~5 MB |
| **Release asset (11 ctx lengths, 1K-1M)** | **550** | **535 MB** | **134 MB** |
| Full trec_coarse (13 lengths, up to 4M) | 650 | 2.1 GB | 537 MB |
| Full validation split (trec_coarse + spam) | 1,300 | ~4.4 GB | ~1.2 GB |

## CI Test Results

### Run 1 (cache miss — first download from release asset)
- Run ID: 21957373194
- Total job time: **43 seconds**
- Download step: **6 seconds** (was 10-15 minutes from HF)
- 2 tasks @ 131K, max-iterations=5, max-depth=1

### Run 2 (cache hit — download skipped)
- Run ID: 21957435859
- Total job time: **1m 18s** (1 task eval takes longer than download)
- Download step: **skipped** (cache hit)
- `Cache hit for: oolong-eval-data-v1`

## Design Decisions

- **Release asset naming**: `oolong-trec-coarse-validation.jsonl.gz`
- **Release tag**: `eval-data-v1` (separate from code releases)
- **Cache key**: `oolong-eval-data-v1` (bump version to invalidate)
- **File layout**: Keep writing to `eval/data/oolong/validation.jsonl` so the loader doesn't change
- **Context lengths**: Only the 11 used by the paper (1K-1M). Use `--from-hf` for 2M/4M.

## Status: COMPLETE

All phases done. Both CI runs passed. The download step went from ~15 minutes (flaky) to 6 seconds (cache miss) or 0 seconds (cache hit).
