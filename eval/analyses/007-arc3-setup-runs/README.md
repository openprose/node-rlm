# 007: ARC-AGI-3 Setup Runs

**Date:** 2026-02-14
**Benchmark:** ARC-AGI-3 (interactive game environments)
**Branch:** `feat/arc3-benchmark`

---

## What is ARC-AGI-3?

Unlike ARC-AGI-2 (static grid puzzles with known answers), ARC-3 has agents play video-game-like environments: observe a frame, choose actions, repeat until the game is won. Scored on action efficiency vs humans. Current frontier AI scores: 0%.

**Key differences from ARC-2:**
- Interactive (API-based, not static files)
- Sequential decisions (observe-act loop, not one-shot grid transform)
- Efficiency-scored (fewer actions = higher score, capped at human baseline)
- Multi-level (each game has 7 levels of increasing difficulty)

## Available Games

Our API key exposes 3 games (anonymous users also see these 3):

| Game ID | Full API ID | Levels | Available Actions | Type |
|---------|-------------|:------:|-------------------|------|
| ls20 | `ls20-cb3b57cc` | 7 | 1,2,3,4 (directional) | Navigation |
| ft09 | `ft09-9ab2447a` | 7 | TBD | TBD |
| vc33 | `vc33-9851e02b` | 7 | 6 (click only) | Click/puzzle |

**Note:** Game IDs have suffixes (e.g. `ls20-cb3b57cc`). The `--game ls20` flag resolves via prefix matching.

**Total benchmark size:** 3 games x 7 levels = 21 levels.

## Scoring

Three-tier hierarchy:
1. **Per-level:** `min(1.0, human_baseline_actions / ai_actions)` — 0 if level not completed
2. **Per-game:** Average of all 7 per-level scores (including zeros for incomplete levels)
3. **Total:** Average of all per-game scores (0-100%)

Human baselines from the ls20 scorecard: `[29, 41, 172, 49, 53, 62, 82]` actions per level.

## E2E Smoke Test Results (2026-02-14)

### API Client Verification

All round trips confirmed working:

| Component | Status | Notes |
|-----------|--------|-------|
| `listGames()` | OK | Returns 3 games with suffixed IDs |
| `Arc3Client.start()` | OK | Opens scorecard, resets game, returns frame |
| `Arc3Client.step()` | OK | Sends actions, returns updated frame |
| `Arc3Client.getScore()` | OK | Requires session cookies (AWSALBAPP) |
| `Arc3Client.cleanup()` | OK | Best-effort close, errors swallowed |
| Cookie affinity | OK | AWSALBAPP cookies auto-captured |
| Sandbox globals (`arc3`) | OK | Agent code calls `arc3.start()`, `arc3.step()`, etc. |

### Gemini 2.5 Flash Run (plumbing test)

```
Model:      google/gemini-2.5-flash
Game:       ls20
Iterations: 5 (max)
Score:      0% (ran out of iterations before completing any level)
Time:       10.6s
Cost:       ~$0.06
```

The model successfully:
- Called `arc3.start()` (iter 1)
- Called `arc3.observe()` and inspected the frame (iter 2-3)
- Analyzed frame pixel data — identified a 64x64 grid with color indices (iter 4-5)
- Hit the iteration limit before taking strategic actions

This confirms the full pipeline works: CLI -> task loader -> sandbox injection -> LLM -> arc3 API -> scoring.

## Running Locally

### Basic Command

```bash
npx tsx eval/run.ts --benchmark arc3 --game <game> --model <model> \
  --max-iterations <N> --app arc3-player
```

### Model Options (via OpenRouter)

| Model | `--model` flag | Cost | Notes |
|-------|---------------|------|-------|
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | Cheap | Good for plumbing tests |
| Claude Sonnet 4.5 | `anthropic/claude-sonnet-4-5-20250929` | Mid | Reasonable for exploration |
| Claude Opus 4.6 | `anthropic/claude-opus-4-6` | Expensive | Best shot at actual scores |

### Key Parameters

| Flag | Default | Recommendation |
|------|---------|----------------|
| `--max-iterations` | 15 | 25+ for real attempts (7 levels need many iterations) |
| `--max-depth` | 1 | 2 for delegation |
| `--game` | all 3 | Single game for partial runs |
| `--app` | none | `arc3-player` (required — provides API docs) |
| `--max-blocks-per-iteration` | unlimited | `1` for focused single-block output |
| `--concurrency` | 5 | 3 for ARC-3 (rate limit: 600 RPM) |

### Example Commands

```bash
# Quick smoke test (verify plumbing)
npx tsx eval/run.ts --benchmark arc3 --game ls20 \
  --model google/gemini-2.5-flash --max-iterations 5 --app arc3-player

# Real attempt — single game, Opus
npx tsx eval/run.ts --benchmark arc3 --game ls20 \
  --model anthropic/claude-opus-4-6 --max-iterations 25 \
  --max-depth 2 --app arc3-player

# Full benchmark — all 3 games
npx tsx eval/run.ts --benchmark arc3 \
  --model anthropic/claude-opus-4-6 --max-iterations 25 \
  --max-depth 2 --concurrency 3 --app arc3-player

# With drivers from best ARC-2 config
npx tsx eval/run.ts --benchmark arc3 --game ls20 \
  --model anthropic/claude-opus-4-6 --max-iterations 25 \
  --max-depth 2 --max-blocks-per-iteration 1 --app arc3-player \
  --drivers one-block-per-iteration,deadline-return
```

## Partial Test Strategy

### The Constraint

The full benchmark is 3 games x 7 levels = 21 levels. Each game is one `EvalTask`, so granularity is per-game, not per-level.

### Options for Budget-Constrained Runs

| Strategy | Command | Fraction | Cost Control |
|----------|---------|----------|--------------|
| **Single game** | `--game ls20` | 1/3 | Best option. Tests one complete game (7 levels). |
| **Reduced iterations** | `--max-iterations 10` | Full breadth, less depth | Caps LLM calls per game. Model may not reach later levels. |
| **Cheaper model** | `--model google/gemini-2.5-flash` | Full | 10-50x cheaper than Opus but unlikely to score. |
| **Single game + reduced iters** | `--game ls20 --max-iterations 10` | ~1/6 | Minimal budget. Good for testing changes, not for scoring. |

### Recommended Partial Test

```bash
# ~1/3 budget: single game, full iteration budget
npx tsx eval/run.ts --benchmark arc3 --game ls20 \
  --model anthropic/claude-opus-4-6 --max-iterations 25 \
  --max-depth 2 --app arc3-player
```

**Why `ls20`?**
- Directional actions (1-4) — simpler action space than click-based vc33
- Known human baselines: `[29, 41, 172, 49, 53, 62, 82]` actions per level
- Level 1 baseline is 29 actions — feasible for an AI to attempt

**Why not fewer iterations?**
- Each level requires: observe -> analyze -> strategize -> act (multiple rounds)
- 7 levels means ~3-4 iterations per level at minimum
- At 10 iterations the model likely completes 1-2 levels max
- At 25 iterations it has a realistic chance at 3-5 levels

### Cost Estimates (rough)

| Config | Est. LLM Calls | Est. Cost (Opus) |
|--------|:--------------:|:----------------:|
| 1 game, 25 iters | ~25 | ~$1-3 |
| 3 games, 25 iters | ~75 | ~$3-9 |
| 1 game, 10 iters | ~10 | ~$0.50-1 |

These are rough — actual cost depends on frame data serialization in context and model verbosity.

## Known Issues

1. **Game IDs have suffixes** — `--game ls20` resolves to `ls20-cb3b57cc` via prefix matching (fixed in this branch)
2. **`console.log` prints `[object Object]`** — the sandbox doesn't auto-serialize objects. The model needs to use `JSON.stringify()`. The app plugin documents this but Flash didn't follow it in the smoke test.
3. **Frame data is large** — 64x64x1 = 4096 values per frame, serialized in context. Multiple frames in conversation history grow the context fast.
4. **OpenRouter dependency** — no direct Anthropic API path currently. If OpenRouter is down (as happened during testing — Clerk auth failures), no fallback.

## Next Steps

- [ ] Run ls20 with Opus 4.6 (25 iterations) — first real scoring attempt
- [ ] Analyze trajectory: does the model understand game mechanics from the plugin?
- [ ] Consider whether the app plugin needs strategy hints or if "trust the model" holds
- [ ] Try vc33 (click-based) — different action space, may need different plugin guidance
- [ ] Investigate whether more games become available with a paid API key
