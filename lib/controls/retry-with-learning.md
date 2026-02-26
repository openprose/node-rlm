---
name: retry-with-learning
kind: program-node
role: coordinator
version: 0.1.0
slots: [target]
delegates: []
prohibited: []
state:
  reads: [&controlState]
  writes: [&controlState]
---

# Retry With Learning

Retry a component, passing failure analysis to each subsequent attempt. Each retry differs because it receives the history of all prior failures.

## Shape

```
shape:
  self: [analyze failures, enrich briefs with failure history, track attempts]
  delegates:
    target: [execute the task]
  prohibited: none
```

## Contract

```
requires:
  - &controlState exists at __controlState with:
      target: string          -- component name to retry
      task_brief: string      -- the original task
      max_retries: number     -- (optional, default 3)
      is_failure: function    -- (optional) predicate that takes a result and returns
                                 true if it should be retried. Default: retry on thrown error.

ensures:
  - First attempt: target receives the original brief
  - On failure: analyze what went wrong, construct enriched brief with:
      original task, what was tried, why it failed, what to try differently
  - Each retry receives the FULL failure history, not just the last attempt
  - Returns on first success
  - After max_retries: returns the last result with &controlState.failure_history
  - &controlState.result contains the final output
  - &controlState.attempts contains the attempt count
  - &controlState.failure_history contains analysis of each failed attempt
```

## Delegation Loop

```javascript
const { target, task_brief, max_retries = 3 } = __controlState;
const failures = [];

for (let attempt = 0; attempt < max_retries; attempt++) {
  let brief = task_brief;
  if (failures.length > 0) {
    brief += `\n\nPrior attempts failed. You MUST try a different approach.\n`;
    failures.forEach((f, i) => {
      brief += `\nAttempt ${i + 1}: ${f.summary}\nFailure reason: ${f.reason}\n`;
    });
  }

  try {
    const result = await rlm(brief, null, { use: target });

    // Check if the result is considered a failure
    const isFail = __controlState.is_failure;
    if (isFail && isFail(result)) {
      failures.push({ summary: String(result).slice(0, 200), reason: "Result did not meet success criteria" });
      continue;
    }

    __controlState.result = result;
    __controlState.attempts = attempt + 1;
    __controlState.failure_history = failures;
    return(result);
  } catch (e) {
    failures.push({ summary: `Error: ${e.message}`, reason: e.message });
  }
}

__controlState.result = null;
__controlState.attempts = max_retries;
__controlState.failure_history = failures;
return(null);
```

## Notes

This is a seed pattern. The target component does not know it is being retried. Each invocation looks like a fresh delegation — the failure history appears as context in the brief, not as retry metadata. Different from worker-critic: retry-with-learning uses failure analysis as the signal, worker-critic uses external critique.
