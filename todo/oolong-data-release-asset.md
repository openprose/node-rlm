# OOLONG Data: GitHub Release Asset + Actions Cache

## Problem

The OOLONG eval downloads ~1,300 rows from HuggingFace's Datasets Server API (paginated, 20 rows/page) every CI run. This takes 10-15 minutes, is unreliable (HF 500 errors, rate limits, skipped pages), and the current local download is incomplete (700/1300 rows, missing all context lengths > 16K).

The eval only needs `trec_coarse` rows (650 of 1300). The `spam` rows are never used. For the paper's Table 1, only 131K context is needed (50 rows). For scaling experiments (Figure 1), all 11 context lengths are needed (550 rows).

## Plan

### Phase 1: Download all trec_coarse data locally

- [ ] Download the full validation split from HuggingFace (fix the incomplete local data)
- [ ] Extract only trec_coarse rows into a clean JSONL file
- [ ] Verify row counts: 50 rows × 13 context lengths = 650 rows (or 11 lengths = 550)
- [ ] Compress as `trec_coarse_validation.jsonl.gz`
- [ ] Record final file size

### Phase 2: Create GitHub Release with data asset

- [ ] Create a GitHub release (e.g. `v0.0.0-data` or `eval-data-v1`) via `gh release create`
- [ ] Upload the compressed JSONL as a release asset
- [ ] Verify the download URL works: `gh release download`

### Phase 3: Update download.ts

- [ ] Add a `--from-release` mode that downloads from the GitHub Release asset instead of HF
- [ ] Make this the default path; fall back to HF API if release download fails
- [ ] Keep the existing HF download path as `--from-hf` for regenerating/updating data

### Phase 4: Update GitHub Actions workflow

- [ ] Add `actions/cache` for `eval/data/oolong/` keyed on a data version string
- [ ] On cache miss, download from the release asset (not HF)
- [ ] Remove (or gate behind a flag) the existing HF download step
- [ ] Test: trigger workflow_dispatch and verify fast data loading

### Phase 5: Update oolong.ts loader

- [ ] Ensure `loadOolongTasks()` works with the new single-file layout (trec_coarse only, no split files)
- [ ] Or: keep the existing file layout (validation.jsonl) — just the contents are filtered

## Data Sizes (estimated)

| Scope | Rows | Uncompressed | Gzipped |
|---|---|---|---|
| Table 1 only (131K) | 50 | ~15 MB | ~5 MB |
| All 11 ctx lengths | 550 | ~240 MB | ~69 MB |
| Full trec_coarse (13 lengths?) | 650 | ~280 MB | ~80 MB |
| Full validation split | 1,300 | ~4.4 GB | ~1.2 GB |

## Design Decisions

- **Release asset naming**: `oolong-trec-coarse-validation.jsonl.gz`
- **Release tag**: `eval-data-v1` (separate from code releases)
- **Cache key**: `oolong-eval-data-v1` (bump version to invalidate)
- **File layout**: Keep writing to `eval/data/oolong/validation.jsonl` so the loader doesn't change

## Status

- [ ] Phase 1: Download data
- [ ] Phase 2: Create release
- [ ] Phase 3: Update download.ts
- [ ] Phase 4: Update workflow
- [ ] Phase 5: Verify loader compatibility
- [ ] End-to-end test via workflow_dispatch
