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
  frame: number[][][],    // shape: [1][64][64] — see below
  state: "NOT_FINISHED" | "NOT_STARTED" | "WIN" | "GAME_OVER",
  levels_completed: number,
  win_levels: number,
  available_actions: number[]  // which actions are valid right now
}
```

**IMPORTANT: Frame indexing.** The `frame` field has shape `[1][64][64]`. To read a pixel:

```javascript
const grid = frame.frame[0];  // 64x64 grid (the [0] unwraps the outer array)
const pixel = grid[row][col]; // color index 0-15
```

- `frame.frame.length` is 1 (not 64) — always index `frame.frame[0]` first
- `frame.frame[0]` is the 64x64 grid: `frame.frame[0][row][col]` gives a color index (integer 0-15)
- Row 0 is the top of the screen, row 63 is the bottom

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

### Strategy

**Act early, learn by doing.** Don't spend many iterations analyzing frames before taking actions. Take an action, observe what changed, adjust.

**Use a game loop.** Take multiple actions per iteration using a loop. You have limited iterations but can take many actions per iteration:

```javascript
const frame = await arc3.start();
const grid = frame.frame[0]; // 64x64 grid
// ... analyze grid, decide on a sequence of actions ...

// Take multiple actions in one iteration
for (const action of plannedActions) {
  const next = await arc3.step(action);
  if (arc3.completed) break;
  // ... observe next.frame[0], adjust plan ...
}
```

**Track changes between frames.** After each action, compare the new `frame[0]` to the previous one to understand what the action did.

**Check `available_actions`** before choosing — not all actions are valid in every state.

**Minimize total actions** — efficiency is the scoring metric, not iterations.
