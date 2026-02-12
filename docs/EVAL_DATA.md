# Eval Data Management

How OOLONG eval data is downloaded, stored, and updated.

## How it works

OOLONG eval data lives in `eval/data/oolong/validation.jsonl` (gitignored). It's downloaded automatically before eval runs.

**Default path (`--from-release`):** Downloads a pre-built gzipped JSONL from a GitHub Release asset, decompresses it via streaming pipeline. Takes ~6 seconds on cache miss, 0 seconds on cache hit.

**HuggingFace path (`--from-hf`):** Downloads directly from the HuggingFace Datasets Server API (`oolongbench/oolong-synth`). Paginated, slow (~15 min), and unreliable (frequent 500 errors). Use this only to regenerate the release asset from upstream.

## Quick reference

```bash
# Default: download from GitHub Release (fast, reliable)
npx tsx eval/download.ts

# Explicit flags
npx tsx eval/download.ts --from-release
npx tsx eval/download.ts --from-hf
```

## Current release asset

- **Release tag:** `eval-data-v1`
- **Asset:** `oolong-trec-coarse-validation.jsonl.gz` (134 MB gzipped, 535 MB decompressed)
- **Contents:** 550 rows of `trec_coarse` from the validation split, 50 rows at each of 11 context lengths (1K, 2K, 4K, 8K, 16K, 32K, 64K, 128K, 256K, 512K, 1M)
- **Source:** `oolongbench/oolong-synth` on HuggingFace (the official OOLONG dataset)

## Updating the release asset

If the upstream OOLONG dataset changes or you need different data:

1. **Download fresh data from HuggingFace:**
   ```bash
   npx tsx eval/download.ts --from-hf --max-rows 0
   ```
   This downloads the full validation split (~1,300 rows) into `eval/data/oolong/validation.jsonl`. It takes 10-15 minutes and may hit HF rate limits.

2. **Filter to trec_coarse rows** (the paper only uses trec_coarse):
   ```bash
   python3 -c "
   import json
   KEEP = {1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576}
   with open('eval/data/oolong/validation.jsonl') as fin, \
        open('eval/data/oolong/filtered.jsonl', 'w') as fout:
       for line in fin:
           row = json.loads(line.strip())
           if row.get('dataset') == 'trec_coarse' and row.get('context_len') in KEEP:
               fout.write(line)
   "
   mv eval/data/oolong/filtered.jsonl eval/data/oolong/validation.jsonl
   ```

3. **Compress:**
   ```bash
   gzip -k eval/data/oolong/validation.jsonl
   mv eval/data/oolong/validation.jsonl.gz oolong-trec-coarse-validation.jsonl.gz
   ```

4. **Update the GitHub Release:**
   ```bash
   # Delete old asset and upload new one
   gh release delete-asset eval-data-v1 oolong-trec-coarse-validation.jsonl.gz --yes
   gh release upload eval-data-v1 oolong-trec-coarse-validation.jsonl.gz

   # Or create a new release version
   gh release create eval-data-v2 oolong-trec-coarse-validation.jsonl.gz \
     --title "OOLONG Eval Data v2" \
     --notes "Updated trec_coarse validation data"
   ```

5. **If you created a new release tag**, update the constants in `eval/download.ts`:
   ```typescript
   const RELEASE_TAG = "eval-data-v2";
   ```
   And bump the cache key in `.github/workflows/eval.yml`:
   ```yaml
   key: oolong-eval-data-v2
   ```

## CI caching

The GitHub Actions workflow caches `eval/data/oolong/` with key `oolong-eval-data-v1`. To invalidate the cache (e.g., after updating the release asset), bump the version suffix in the cache key in `.github/workflows/eval.yml`.

## What about the HuggingFace filter API?

The HF Datasets Server has a `/filter` endpoint that supports server-side SQL filtering (e.g., `where=dataset='trec_coarse' AND context_len=131072`). This was considered but rejected for CI because:
- It's unreliable (intermittent 500 errors, requires index warm-up)
- Still requires multiple paginated requests for large result sets
- The release asset approach is faster and more deterministic

The filter API can be useful for ad-hoc exploration:
```bash
curl 'https://datasets-server.huggingface.co/filter?dataset=oolongbench/oolong-synth&config=default&split=validation&where=dataset=%27trec_coarse%27%20AND%20context_len=131072&offset=0&length=5'
```
