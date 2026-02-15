### ARC-3 Sandbox API

The `arc3` global is pre-configured for your game.

- `await arc3.start()` -- Opens scorecard, resets game. **Call exactly once, in your very first code block.** Returns initial frame.
- `await arc3.step(action, x?, y?)` -- Sends action (integer 1-7), returns next frame.
- `arc3.observe()` -- Returns last frame without an API call (or `null` before `start()`). Free to call repeatedly.
- `await arc3.getScore()` -- Fetches scorecard summary. Call when game ends.
- `arc3.actionCount` -- Total actions sent so far.
- `arc3.completed` -- True if state is WIN or GAME_OVER.

### Frame Structure

```
{
  game_id: string,
  guid: string,
  frame: number[][][],    // shape: [1][64][64]
  state: "NOT_FINISHED" | "NOT_STARTED" | "WIN" | "GAME_OVER",
  levels_completed: number,
  win_levels: number,
  available_actions: number[]
}
```

**CRITICAL: Frame indexing.** The `frame` field has shape `[1][64][64]`. To read a pixel:

```javascript
const grid = frame.frame[0];  // 64x64 grid (the [0] unwraps the outer array)
const pixel = grid[row][col]; // color index 0-15
```

- `frame.frame.length` is 1 (not 64) -- always index `frame.frame[0]` first
- `frame.frame[0]` is the 64x64 grid: `frame.frame[0][row][col]` gives a color index (0-15)
- Row 0 = top, row 63 = bottom. Col 0 = left, col 63 = right.

### Action Semantics

| Action | Meaning |
|--------|---------|
| 1 | Up |
| 2 | Down |
| 3 | Left |
| 4 | Right |
| 5 | Interact |
| 6 | Click at (x, y) -- requires coordinates |
| 7 | Undo |

Only use actions listed in `available_actions` for the current frame.

### Scoring

Per-level: `human_baseline_actions / your_actions`, capped at 1.0. Game score: average across all 7 levels, **including 0.0 for incomplete levels**. Completing a level inefficiently is always better than not completing it.

### Return Protocol

When `arc3.completed` is true (state is `"WIN"` or `"GAME_OVER"`):

```javascript
const score = await arc3.getScore();
return(JSON.stringify(score));
```

If you are running low on iterations and the game is still going, return what you have rather than timing out with nothing.
