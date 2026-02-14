---
name: arc3-player
kind: app
version: 0.1.0
description: ARC-AGI-3 interactive game player via sandbox API
author: sl
tags: [arc, arc3, interactive, games]
requires: []
---

## ARC-AGI-3 Player

You are playing an ARC-AGI-3 game. The game is a video-game-like environment where you observe a 64x64 frame, choose actions, and try to complete levels efficiently. You are scored on action efficiency vs human baselines.

### Sandbox API

The `arc3` global is an `Arc3Client` instance pre-configured for your game.

#### `await arc3.start()` → Frame

Opens a scorecard and resets the game. **Call this first.** Returns the initial frame.

#### `await arc3.step(action, x?, y?)` → Frame

Sends an action and returns the next frame.

- `action` is an integer 1-7 (see Action Semantics below)
- For action 6 (click), you must also pass `x` and `y` coordinates

#### `arc3.observe()` → Frame | null

Returns the last received frame without making an API call. Use this to re-examine the current state without wasting an action.

#### `await arc3.getScore()` → Scorecard

Fetches the current scorecard summary. Call this when the game ends (state = WIN or GAME_OVER).

#### Properties

- `arc3.gameId` — the game ID
- `arc3.actionCount` — total actions sent so far
- `arc3.completed` — true if state is WIN or GAME_OVER

### Frame Structure

```
{
  game_id: string,
  guid: string,           // unique frame ID (used internally)
  frame: number[][][],    // 64x64 grid, color indices 0-15
  state: "NOT_FINISHED" | "NOT_STARTED" | "WIN" | "GAME_OVER",
  levels_completed: number,
  win_levels: number,
  available_actions: number[]  // which actions are valid right now
}
```

The `frame` is a 64x64 grid where each cell is a color index (0-15). Analyze the visual patterns to understand the game mechanics.

### Action Semantics

| Action | Meaning |
|--------|---------|
| 1 | Move up |
| 2 | Move down |
| 3 | Move left |
| 4 | Move right |
| 5 | Interact |
| 6 | Click at (x, y) — requires coordinates |
| 7 | Undo last action |

Always check `available_actions` before choosing — not all actions are valid in every state.

### Scoring

Each level is scored: `human_baseline_actions / your_actions`, capped at 1.0. Your total score is the average across levels. Fewer actions = higher score.

### Return Protocol

When the game ends (state is `"WIN"` or `"GAME_OVER"`):

```javascript
const score = await arc3.getScore();
return(JSON.stringify(score));
```

### Strategy Tips

- Start by observing the initial frame to understand the game layout
- Track what changes between frames to understand action effects
- Use `available_actions` to know what's possible
- Minimize actions — efficiency is the metric
- Use `arc3.observe()` to re-examine state without API calls
