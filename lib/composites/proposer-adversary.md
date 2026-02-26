---
name: proposer-adversary
kind: program-node
role: coordinator
version: 0.1.0
slots: [proposer, adversary]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Proposer-Adversary

One proposes, another attacks. The composite returns both — the parent decides.

## Shape

```
shape:
  self: [delegate to proposer, delegate to adversary, return both outputs]
  delegates:
    proposer: [produce a proposal given the brief]
    adversary: [find flaws in the proposal]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      proposer: string      -- component name for the proposer
      adversary: string     -- component name for the adversary
      task_brief: string    -- what to propose

ensures:
  - Proposer receives only the task brief
  - Adversary receives the proposal and the task brief — its job is to find flaws,
    edge cases, and counterexamples
  - This composite does NOT resolve the tension
  - Returns { proposal, attack } — the parent reasons about the disagreement
  - &compositeState.result contains { proposal, attack }
```

## Delegation

```javascript
const { proposer, adversary, task_brief } = __compositeState;

const proposal = await rlm(task_brief, null, { use: proposer });

const adversaryBrief = `Find flaws, edge cases, or counterexamples in this proposal.\n\nOriginal task: ${task_brief}\n\nProposal:\n${proposal}`;
const attack = await rlm(adversaryBrief, null, { use: adversary });

const result = { proposal, attack };
__compositeState.result = result;
return(result);
```

## Notes

This is a seed pattern. The proposer does not know it will be attacked. The adversary does not know its output will be weighed against the proposal. The parent composes both perspectives and makes the final judgment.
