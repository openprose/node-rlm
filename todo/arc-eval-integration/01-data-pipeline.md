# ARC Data Pipeline Plan

How to download, cache, and store ARC-AGI-2 data following the same patterns as our OOLONG pipeline.

## Raw Data Sources

### Primary: GitHub (arcprize/ARC-AGI-2)

The official ARC-AGI-2 repository at https://github.com/arcprize/ARC-AGI-2 contains individual task files:

```
data/
  training/     # 1,000 task JSON files (one per task)
  evaluation/   # 120 task JSON files (one per task)
```

Each file is a single JSON object with `train` and `test` keys.

### Secondary: Kaggle Competition Data

The Kaggle competition provides combined JSON files:
- `arc-agi_evaluation_challenges.json` -- all 120 evaluation tasks in one file
- `arc-agi_evaluation_solutions.json` -- all 120 solutions in one file

### What Arcgentica Includes

Arcgentica ships with pre-packaged combined JSON files in `data/arc-prize-2025/`:
- `arc-agi_evaluation_challenges.json` (984 KB)
- `arc-agi_evaluation_solutions.json` (224 KB)

These are the combined Kaggle-format files, not the individual GitHub files.

## Recommended Approach: GitHub Release Asset

Follow the same pattern as OOLONG: package the data as a GitHub Release asset on our repo.

### Why Not Download from arcprize/ARC-AGI-2 at Runtime?

1. The GitHub repo has individual files (120 separate JSON files for evaluation), which would require 120 HTTP requests
2. We need both challenges and solutions; the GitHub repo does not have a combined solutions file for the evaluation split (solutions are only available through Kaggle or pre-packaged repos like arcgentica)
3. Downloading from Kaggle requires authentication
4. A GitHub Release asset on our own repo is fast, reliable, and deterministic

### Data Packaging Plan

1. **Source the data** from the arcgentica repo's `data/arc-prize-2025/` directory (already in Kaggle combined format)
2. **Create a tarball** containing both files:
   ```bash
   cd arcgentica/data/arc-prize-2025
   tar czf arc-agi-2-evaluation.tar.gz \
     arc-agi_evaluation_challenges.json \
     arc-agi_evaluation_solutions.json
   ```
   Expected size: ~200 KB compressed (the raw files are ~1.2 MB total, JSON compresses well)
3. **Upload as a GitHub Release asset** on `openprose/node-rlm`:
   ```bash
   # Create release (or add to existing eval-data-v1)
   gh release create eval-data-v2 arc-agi-2-evaluation.tar.gz \
     --title "Eval Data v2" \
     --notes "ARC-AGI-2 public evaluation data (120 tasks)"

   # Or add to existing release
   gh release upload eval-data-v1 arc-agi-2-evaluation.tar.gz
   ```

## Local Storage

### Directory Structure

```
eval/data/arc/
  arc-agi_evaluation_challenges.json    # 120 tasks with train + test
  arc-agi_evaluation_solutions.json     # 120 solutions (ground truth)
```

This mirrors the OOLONG pattern:
```
eval/data/oolong/
  validation.jsonl
```

### .gitignore

`eval/data/` is already gitignored, so `eval/data/arc/` will be automatically excluded.

## Download Implementation

### Changes to `eval/download.ts`

Add a new `--dataset arc` option alongside the existing `--dataset oolong`:

```typescript
// New constants
const ARC_RELEASE_TAG = "eval-data-v1"; // or v2 if we create a new release
const ARC_RELEASE_ASSET = "arc-agi-2-evaluation.tar.gz";
const ARC_DIR = join(DATA_DIR, "arc");

async function downloadArcFromRelease(): Promise<void> {
  const assetUrl = `https://github.com/${GITHUB_REPO}/releases/download/${ARC_RELEASE_TAG}/${ARC_RELEASE_ASSET}`;
  const outputDir = ARC_DIR;

  console.log("Downloading ARC-AGI-2 data from GitHub Release...");
  console.log(`  Asset: ${ARC_RELEASE_ASSET}`);
  console.log(`  URL: ${assetUrl}`);
  console.log(`  Target: ${outputDir}`);

  mkdirSync(outputDir, { recursive: true });

  const response = await fetch(assetUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to download: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Response body is empty");
  }

  // Download and extract tar.gz
  // Use pipeline with createGunzip and tar extraction
  // (tar -xzf reads from stdin)
  const tempFile = join(outputDir, ".download.tar.gz");
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(tempFile),
  );

  // Extract using tar
  const { execSync } = await import("node:child_process");
  execSync(`tar xzf "${tempFile}" -C "${outputDir}"`);
  unlinkSync(tempFile);

  // Verify files exist
  const challengesFile = join(outputDir, "arc-agi_evaluation_challenges.json");
  const solutionsFile = join(outputDir, "arc-agi_evaluation_solutions.json");
  if (!existsSync(challengesFile) || !existsSync(solutionsFile)) {
    throw new Error("Extraction failed: expected files not found");
  }

  console.log(`  Downloaded and extracted to ${outputDir}`);

  // Summarize
  const challenges = JSON.parse(readFileSync(challengesFile, "utf-8"));
  console.log(`  Tasks: ${Object.keys(challenges).length}`);
}
```

Update the `main()` switch to handle `--dataset arc`:

```typescript
case "arc":
  await downloadArcFromRelease();
  break;
```

### CLI Usage

```bash
# Download ARC data
npx tsx eval/download.ts --dataset arc

# Download OOLONG data (existing, unchanged)
npx tsx eval/download.ts --dataset oolong
# or just
npx tsx eval/download.ts
```

## CI Caching

### Cache Key Strategy

Follow the same pattern as OOLONG:

```yaml
- name: Cache ARC eval data
  if: inputs.benchmark == 'arc'
  id: cache-arc
  uses: actions/cache@v4
  with:
    path: eval/data/arc
    key: arc-eval-data-v1

- name: Download ARC dataset
  if: inputs.benchmark == 'arc' && steps.cache-arc.outputs.cache-hit != 'true'
  run: npx tsx eval/download.ts --dataset arc
```

### Cache Invalidation

To invalidate (e.g., if the data changes):
1. Bump the version suffix: `arc-eval-data-v1` -> `arc-eval-data-v2`
2. If also updating the release asset, update `ARC_RELEASE_TAG` in `eval/download.ts`

## Data Integrity

The ARC data is small (~1.2 MB uncompressed) and static (it is a fixed evaluation set). Unlike OOLONG which is 535 MB, there is no concern about file size limits or streaming. The entire challenges file can be loaded into memory as a single JSON object.

### Verification

After download, verify:
- `arc-agi_evaluation_challenges.json` contains 120 task keys
- `arc-agi_evaluation_solutions.json` contains 120 solution keys
- The key sets match

```typescript
const challenges = JSON.parse(readFileSync(challengesFile, "utf-8"));
const solutions = JSON.parse(readFileSync(solutionsFile, "utf-8"));
const cKeys = new Set(Object.keys(challenges));
const sKeys = new Set(Object.keys(solutions));
if (cKeys.size !== 120 || sKeys.size !== 120) {
  throw new Error(`Expected 120 tasks, got ${cKeys.size} challenges and ${sKeys.size} solutions`);
}
for (const k of cKeys) {
  if (!sKeys.has(k)) throw new Error(`Missing solution for task ${k}`);
}
```

## Alternative: Direct Copy from Arcgentica

Since we already have the arcgentica repo cloned, we could simply copy the data:

```bash
mkdir -p eval/data/arc
cp arcgentica/data/arc-prize-2025/arc-agi_evaluation_challenges.json eval/data/arc/
cp arcgentica/data/arc-prize-2025/arc-agi_evaluation_solutions.json eval/data/arc/
```

This is fine for local development. The GitHub Release approach is for CI and reproducibility.
