---
name: arc3-delegation-test
kind: app
version: 0.1.0
description: ARC-3 delegation experiment -- delegate scouting to a child, then play using learnings
author: sl
tags: [arc, arc3, delegation, experiment]
requires: []
---

## ARC-3 Delegation Test

You are running a **delegation experiment**. Your goal is to solve an ARC-3 game, but instead of exploring blindly, you will delegate game exploration to a scout child agent first, then use its learnings to play efficiently.

The `arc3` sandbox API is documented in your Environment section.

### Available Child Apps

- `arc3-scout` -- A game scout that explores mechanics, discovers patterns, and returns a structured JSON report. Give it a generous iteration budget (~30-50 iterations).

### Strategy

#### Step 1: Delegate Scouting

Spawn a scout to explore the game. The scout will start the game, probe all actions, discover mechanics, and try to complete at least one level. It returns a structured JSON report.

```javascript
console.log("Delegating game scouting to child agent...");
const scoutReport = await rlm(
  "Explore this ARC-3 game. Discover the mechanics, probe all actions, map the board, " +
  "and try to complete at least one level. Return a structured JSON report of your findings.",
  undefined,
  {
    app: "arc3-scout",
    model: "fast",
    maxIterations: 50,
  }
);
console.log("Scout report received:");
console.log(scoutReport);
```

#### Step 2: Parse and Use Learnings

Parse the scout's report and use it to inform your strategy:

```javascript
let report;
try {
  report = JSON.parse(scoutReport);
  console.log("Parsed report successfully");
  console.log("Mechanics:", JSON.stringify(report.mechanics));
  console.log("Strategy recommendations:", JSON.stringify(report.strategyRecommendations));
  console.log("Levels completed by scout:", report.levelsCompleted);
  console.log("Actions used by scout:", report.actionsUsed);
} catch (e) {
  console.log("Could not parse scout report as JSON, using raw text");
  report = { raw: scoutReport };
}
```

#### Step 3: Continue Playing

The scout has already started the game and made progress. Continue from where it left off using the arc3 API (the sandbox is shared -- `arc3` still has the active game session):

```javascript
// The game is already in progress -- check current state
const currentFrame = arc3.observe();
console.log("Current state:", currentFrame.state);
console.log("Levels completed:", currentFrame.levels_completed);
console.log("Actions so far:", arc3.actionCount);

// Now play using the scout's learnings...
// Use report.mechanics.actionMeanings to know what each action does
// Use report.strategyRecommendations to guide your approach
```

#### Step 4: Return Results

When the game ends (or you're running low on iterations), get the scorecard:

```javascript
if (arc3.completed) {
  const score = await arc3.getScore();
  return(JSON.stringify(score));
} else {
  // Return partial results
  const frame = arc3.observe();
  return(JSON.stringify({
    status: "incomplete",
    levelsCompleted: frame.levels_completed,
    actionsUsed: arc3.actionCount,
    scoutFindings: report,
  }));
}
```

### Key Rules

1. **Delegate scouting first.** Don't start exploring on your own -- that's what the scout is for.
2. **The sandbox is shared.** After the scout returns, `arc3` still has the active game session. Don't call `arc3.start()` again.
3. **Parse the scout's report.** It returns structured JSON. Extract the mechanics and strategy recommendations.
4. **Play efficiently.** The scout already burned actions exploring. Use its learnings to minimize further actions.
5. **Always return something.** Even if the game isn't finished, return partial results with the scout's findings.
