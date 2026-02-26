---
name: dialectic
kind: program-node
role: coordinator
version: 0.1.0
slots: [thesis, antithesis]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Dialectic

Thesis and antithesis argue positions. Disagreement IS the output.

## Shape

```
shape:
  self: [manage argument rounds, pass each agent the other's prior argument]
  delegates:
    thesis: [argue for a position]
    antithesis: [argue against it]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      thesis: string        -- component name for thesis agent
      antithesis: string    -- component name for antithesis agent
      task_brief: string    -- the question or proposition to argue
      rounds: number        -- (optional, default 2)

ensures:
  - Round 1: thesis argues first, antithesis responds
  - Subsequent rounds: each agent sees the other's prior argument
  - This composite does NOT resolve the tension — the full exchange is the output
  - The parent extracts insight from the tension
  - &compositeState.result contains the full exchange
  - &compositeState.exchange contains the structured round-by-round arguments
```

## Delegation Loop

```javascript
const { thesis, antithesis, task_brief, rounds = 2 } = __compositeState;
const exchange = [];

let lastThesis = null;
let lastAntithesis = null;

for (let round = 0; round < rounds; round++) {
  // Thesis argues
  let thesisBrief = round === 0
    ? `Argue FOR the following position.\n\n${task_brief}`
    : `Argue FOR the following position, responding to the counterargument.\n\n${task_brief}\n\nCounterargument from prior round:\n${lastAntithesis}`;
  lastThesis = await rlm(thesisBrief, null, { use: thesis });

  // Antithesis argues
  const antithesisBrief = `Argue AGAINST the following position.\n\n${task_brief}\n\nArgument to counter:\n${lastThesis}`;
  lastAntithesis = await rlm(antithesisBrief, null, { use: antithesis });

  exchange.push({ round: round + 1, thesis: lastThesis, antithesis: lastAntithesis });
}

__compositeState.result = exchange;
__compositeState.exchange = exchange;
return(exchange);
```

## Notes

This is a seed pattern. Neither agent knows it is part of a dialectic. Each receives a brief asking it to argue a position. The structural value is in the tension between positions — premature consensus is more dangerous than unresolved disagreement.
