---
name: ratchet
kind: program-node
role: coordinator
version: 0.1.0
slots: [advancer, ratchet]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Ratchet

Advancer proposes steps, ratchet certifies. Certified progress is never rolled back.

## Shape

```
shape:
  self: [manage the advance-certify loop, maintain certified progress log]
  delegates:
    advancer: [propose the next incremental step]
    ratchet: [certify or reject the proposed step]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      advancer: string             -- component name for the advancer
      ratchet: string              -- component name for the ratchet/certifier
      task_brief: string           -- the overall goal
      max_steps: number            -- (optional, default 5)
      certified_progress: any[]    -- (optional, default []) — prior certified steps

ensures:
  - Advancer receives the task brief plus all certified progress so far
  - Ratchet receives the proposed step and decides: certify or reject
  - Certified steps are appended to &compositeState.certified_progress — never removed
  - Rejected steps are discarded — advancer receives the rejection reason and proposes differently
  - Progress is monotonic: the certified_progress array only grows
  - &compositeState.result contains the final certified progress
```

## Delegation Loop

```javascript
const { advancer, ratchet, task_brief, max_steps = 5 } = __compositeState;
let certified = __compositeState.certified_progress || [];
let consecutiveRejects = 0;

for (let step = 0; step < max_steps; step++) {
  // Advancer proposes
  let advancerBrief = `Propose the next incremental step toward the goal.\n\nGoal: ${task_brief}\n\nCertified progress so far:\n${certified.length ? certified.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none yet)"}`;
  if (consecutiveRejects > 0) {
    advancerBrief += `\n\nYour last ${consecutiveRejects} proposal(s) were rejected. Try a different approach.`;
  }

  const proposal = await rlm(advancerBrief, null, { use: advancer });

  // Ratchet certifies
  const ratchetBrief = `Evaluate this proposed step. Does it maintain all invariants? Does it advance toward the goal? Is it consistent with prior certified progress?\n\nGoal: ${task_brief}\nCertified progress: ${JSON.stringify(certified)}\n\nProposed step:\n${proposal}`;
  const verdict = await rlm(ratchetBrief, null, { use: ratchet });

  const verdictStr = String(verdict).toLowerCase();
  if (/certif|accept|approve/.test(verdictStr)) {
    certified.push(proposal);
    __compositeState.certified_progress = certified;
    consecutiveRejects = 0;
  } else {
    consecutiveRejects++;
  }
}

__compositeState.result = certified;
return(certified);
```

## Notes

This is a seed pattern. The advancer does not know a ratchet will evaluate its proposals. The ratchet does not know its verdicts drive a retry loop. The structural guarantee is monotonic progress — once a step is certified, it is committed. This is valuable when rollback is expensive or when partial progress must be preserved across failures.
