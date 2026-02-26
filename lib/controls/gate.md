---
name: gate
kind: program-node
role: coordinator
version: 0.1.0
slots: [guard, target]
delegates: []
prohibited: []
state:
  reads: [&controlState]
  writes: [&controlState]
---

# Gate

Check before delegating. Fail-fast pattern.

## Shape

```
shape:
  self: [delegate to guard, if cleared delegate to target, otherwise return guard's reason]
  delegates:
    guard: [evaluate whether the task should proceed]
    target: [execute the task if guard approves]
  prohibited: none
```

## Contract

```
requires:
  - &controlState exists at __controlState with:
      guard: string          -- component name for the guard
      target: string         -- component name for the target
      task_brief: string     -- the task (goes to both guard and target)

ensures:
  - Guard receives the brief and returns { proceed: boolean, reason: string }
  - If proceed: target receives the ORIGINAL brief unchanged
  - If blocked: return immediately with the guard's reason — no delegation to target
  - The gate does NOT modify the brief based on the guard's output — binary pass/block
  - &controlState.result contains the target's output (if proceeded) or guard's reason (if blocked)
  - &controlState.proceeded is true/false
```

## Delegation

```javascript
const { guard, target, task_brief } = __controlState;

// Guard decides
const guardBrief = `Evaluate whether this task should proceed. Return your decision and reasoning.\n\n${task_brief}`;
const guardResult = await rlm(guardBrief, null, { use: guard });

const guardStr = String(guardResult).toLowerCase();
const proceed = /proceed|yes|pass|approve|allow/.test(guardStr) && !/block|reject|deny|fail/.test(guardStr);

if (!proceed) {
  __controlState.result = guardResult;
  __controlState.proceeded = false;
  return(guardResult);
}

// Target executes
const result = await rlm(task_brief, null, { use: target });
__controlState.result = result;
__controlState.proceeded = true;
return(result);
```

## Notes

This is a seed pattern. The guard does not know it controls access to another component. The target does not know a guard was consulted. The gate is a binary decision point — not a filter that modifies the brief. Useful when delegation is expensive and preconditions should be checked cheaply first.
