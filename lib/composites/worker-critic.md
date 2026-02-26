---
name: worker-critic
kind: program-node
role: coordinator
version: 0.1.0
slots: [worker, critic]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Worker-Critic

One agent works, another evaluates. Retry until the critic accepts or budget exhausts.

## Shape

```
shape:
  self: [manage retry loop, pass critique to worker, return accepted result]
  delegates:
    worker: [produce result from brief]
    critic: [evaluate result against criteria]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      worker: string        -- component name to use as worker
      critic: string        -- component name to use as critic
      task_brief: string    -- the task to pass to the worker
      criteria: string      -- acceptance criteria for the critic
      max_retries: number   -- (optional, default 3)

ensures:
  - Worker receives only the task brief (first attempt) or task brief + critique (retries)
  - Critic receives the worker's result AND the original task brief AND the criteria
  - Critic returns { verdict: "accept" | "reject", reasoning, issues, suggestions }
  - On reject: worker receives the critique as learning signal — not the raw task repeated
  - On accept: return the worker's result immediately
  - After max_retries exhausted: return the best attempt with the final critique
  - &compositeState.result contains the final output
  - &compositeState.attempts contains the count
```

## Delegation Loop

```javascript
const { worker, critic, task_brief, criteria, max_retries = 3 } = __compositeState;
let lastResult = null;
let lastCritique = null;

for (let attempt = 0; attempt < max_retries; attempt++) {
  // Build worker brief
  let workerBrief = task_brief;
  if (lastCritique) {
    workerBrief += `\n\nPrevious attempt was rejected.\nCritique: ${lastCritique.reasoning}`;
    if (lastCritique.suggestions?.length) {
      workerBrief += `\nSuggestions: ${lastCritique.suggestions.join("; ")}`;
    }
  }

  lastResult = await rlm(workerBrief, null, { use: worker });

  // Build critic brief
  const criticBrief = `Evaluate this result against the criteria.\n\nOriginal task: ${task_brief}\nCriteria: ${criteria}\n\nResult to evaluate:\n${lastResult}`;
  const verdict = await rlm(criticBrief, null, { use: critic });

  // Parse verdict — critic should return structured assessment
  if (verdict?.verdict === "accept" || /accept/i.test(String(verdict))) {
    __compositeState.result = lastResult;
    __compositeState.attempts = attempt + 1;
    return(lastResult);
  }

  lastCritique = verdict;
}

__compositeState.result = lastResult;
__compositeState.attempts = max_retries;
__compositeState.final_critique = lastCritique;
return(lastResult);
```

## Notes

This is a seed pattern in the standard library. The worker does not know it will be critiqued. The critic does not know its verdict triggers a retry. Multi-polarity is managed here, not in the children.
