# Matched Trajectories: Our 20 Problem IDs vs ARCgentica

All 20 of our eval problem IDs have corresponding trajectories and results in the ARCgentica 85.28% run.

**Summary: 19/20 fully solved, 1 partially solved (4e34c42c). Their pass@2 score on our 20 = 19.5/20 (97.5%)**

## Base Paths

- Results: `/Users/sl/code/trinity/node-rlm/arcgentica/output/2025/anthropic/claude-opus-4-6/final/results/`
- Logs: `/Users/sl/code/trinity/node-rlm/arcgentica/output/2025/anthropic/claude-opus-4-6/final/logs/`

---

## Per-Problem Detail

### 1. 0934a4d8 -- PASS

- **Result path**: `results/0934a4d8/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/0934a4d8/0/0/agent-0.log`, `agent-1.log`, `agent-2.log` (attempt 0); `logs/0934a4d8/1/0/agent-0.log`, `agent-1.log` (attempt 1)
- **Outcome**: All test cases correct
- **Attempt 0**: 3 agents, 75 iterations, 1610s
- **Attempt 1**: 2 agents, 60 iterations, 876s
- **Notable**: Heavy use of sub-agents; complex problem requiring D2 symmetry analysis. Sub-agents analyzed grid structure, extra rows/cols, and symmetry partners.

### 2. 135a2760 -- PASS

- **Result path**: `results/135a2760/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/135a2760/0/0/agent-0.log`, `logs/135a2760/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 17 iterations, 1678s
- **Attempt 1**: 1 agent, 19 iterations, 785s
- **Notable**: Solved with single agent in both attempts. No sub-agents needed.

### 3. 136b0064 -- PASS

- **Result path**: `results/136b0064/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/136b0064/0/0/agent-0.log`, `logs/136b0064/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 23 iterations, 678s
- **Attempt 1**: 1 agent, 9 iterations, 547s
- **Notable**: Single agent. Attempt 1 was more efficient (9 vs 23 iterations).

### 4. 195c6913 -- PASS

- **Result path**: `results/195c6913/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/195c6913/0/0/agent-0.log`, `logs/195c6913/1/0/agent-0.log` + `agent-1.log`, `agent-2.log`, `agent-3.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 1 agent, 109 iterations, 1104s
- **Attempt 1**: 2 agents (3 sub-agents), 43 iterations, 1619s
- **Notable**: Attempt 0 took 109 iterations (very high), suggesting significant refinement. Attempt 1 used sub-agents more efficiently.

### 5. 247ef758 -- PASS

- **Result path**: `results/247ef758/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/247ef758/0/0/agent-0.log`, `logs/247ef758/1/0/agent-0.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 1 agent, 17 iterations, 348s
- **Attempt 1**: 1 agent, 9 iterations, 333s
- **Notable**: Relatively quick solve. Single agent for both.

### 6. 2ba387bc -- PASS

- **Result path**: `results/2ba387bc/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/2ba387bc/0/0/agent-0.log`, `logs/2ba387bc/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 6 iterations, 93s
- **Attempt 1**: 1 agent, 7 iterations, 104s
- **Notable**: Fastest solve among our 20. Identified hollow vs solid 4x4 blocks pattern quickly. Used scipy.ndimage.label for object detection.

### 7. 36a08778 -- PASS

- **Result path**: `results/36a08778/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/36a08778/0/0/agent-0.log`, `logs/36a08778/1/0/agent-0.log` + `agent-1.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 1 agent, 7 iterations, 1963s
- **Attempt 1**: 2 agents, 26 iterations, 2905s
- **Notable**: 6 training examples (most among our 20). Long solve times despite low iteration counts.

### 8. 446ef5d2 -- PASS

- **Result path**: `results/446ef5d2/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/446ef5d2/0/0/agent-0.log` + `agent-1.log`, `agent-2.log`; `logs/446ef5d2/1/0/agent-0.log` + `agent-1.log`, `agent-2.log`, `agent-3.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 3 agents, 83 iterations, 1769s
- **Attempt 1**: 4 agents, 103 iterations, 2779s
- **Notable**: Heavy sub-agent usage. Both attempts needed multiple sub-agents and many iterations.

### 9. 4e34c42c -- PARTIAL FAIL (0.5 credit)

- **Result path**: `results/4e34c42c/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/4e34c42c/0/0/agent-0.log`; `logs/4e34c42c/1/0/agent-0.log` + `agent-1.log`, `agent-2.log`, `agent-3.log`
- **Outcome**: 2 test inputs -- test_0 FAILED in both attempts, test_1 PASSED in attempt 1
- **Attempt 0**: 1 agent, 22 iterations, 2557s
- **Attempt 1**: 4 agents, 39 iterations, 2406s
- **Notable**: The only one of our 20 that was not fully solved. Test case 0 was not matched by either attempt. Attempt 1 used 4 agents but still failed on test_0. Pass@2 score = 0.5 (1/2 test cases).

### 10. 5961cc34 -- PASS

- **Result path**: `results/5961cc34/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/5961cc34/0/0/agent-0.log`, `logs/5961cc34/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 7 iterations, 582s
- **Attempt 1**: 1 agent, 5 iterations, 546s
- **Notable**: Efficient solve, single agent, low iteration count.

### 11. 6e453dd6 -- PASS

- **Result path**: `results/6e453dd6/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/6e453dd6/0/0/agent-0.log`, `logs/6e453dd6/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 10 iterations, 186s
- **Attempt 1**: 1 agent, 6 iterations, 255s
- **Notable**: Quick solve, single agent.

### 12. 78332cb0 -- PASS

- **Result path**: `results/78332cb0/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/78332cb0/0/0/agent-0.log`, `logs/78332cb0/1/0/agent-0.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 1 agent, 7 iterations, 415s
- **Attempt 1**: 1 agent, 23 iterations, 464s
- **Notable**: Single agent. Attempt 1 took more iterations.

### 13. 7ed72f31 -- PASS

- **Result path**: `results/7ed72f31/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/7ed72f31/0/0/agent-0.log`, `logs/7ed72f31/1/0/agent-0.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 1 agent, 5 iterations, 192s
- **Attempt 1**: 1 agent, 6 iterations, 221s
- **Notable**: Quick solve, low iterations.

### 14. 89565ca0 -- PASS

- **Result path**: `results/89565ca0/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/89565ca0/0/0/agent-0.log`; `logs/89565ca0/1/0/agent-0.log` + `agent-1.log`, `agent-2.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 84 iterations, 1166s
- **Attempt 1**: 1 agent, 25 iterations, 819s
- **Notable**: Attempt 0 used 84 iterations (very high refinement). Attempt 1 had sub-agent logs but `num_agents_used=1` suggests they were spawned but not counted (or the count is for the first agent only).

### 15. 8f3a5a89 -- PASS

- **Result path**: `results/8f3a5a89/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/8f3a5a89/0/0/agent-0.log`, `logs/8f3a5a89/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 9 iterations, 830s
- **Attempt 1**: 1 agent, 7 iterations, 1023s
- **Notable**: Single agent both times.

### 16. a251c730 -- PASS

- **Result path**: `results/a251c730/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/a251c730/0/0/agent-0.log`, `logs/a251c730/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 39 iterations, 1642s
- **Attempt 1**: 1 agent, 24 iterations, 684s
- **Notable**: Moderate iteration count, single agent.

### 17. aa4ec2a5 -- PASS

- **Result path**: `results/aa4ec2a5/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/aa4ec2a5/0/0/agent-0.log`, `logs/aa4ec2a5/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 9 iterations, 650s
- **Attempt 1**: 1 agent, 10 iterations, 548s
- **Notable**: Single agent, moderate iterations.

### 18. b99e7126 -- PASS

- **Result path**: `results/b99e7126/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/b99e7126/0/0/agent-0.log`, `logs/b99e7126/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 6 iterations, 576s
- **Attempt 1**: 1 agent, 8 iterations, 702s
- **Notable**: Single agent, efficient.

### 19. cbebaa4b -- PASS

- **Result path**: `results/cbebaa4b/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/cbebaa4b/0/0/agent-0.log`, `logs/cbebaa4b/1/0/agent-0.log`
- **Outcome**: All test cases correct (2 test inputs)
- **Attempt 0**: 1 agent, 15 iterations, 2253s
- **Attempt 1**: 1 agent, 12 iterations, 1188s
- **Notable**: Long solve times despite moderate iterations. Single agent.

### 20. db695cfb -- PASS

- **Result path**: `results/db695cfb/attempt_0.json`, `attempt_1.json`
- **Log path**: `logs/db695cfb/0/0/agent-0.log`, `logs/db695cfb/1/0/agent-0.log`
- **Outcome**: All test cases correct
- **Attempt 0**: 1 agent, 6 iterations, 512s
- **Attempt 1**: 1 agent, 9 iterations, 785s
- **Notable**: Single agent, efficient solve.

---

## Summary Statistics for Our 20 Problems

| Metric | Value |
|--------|-------|
| **Fully Solved** | 19/20 |
| **Partially Solved** | 1/20 (4e34c42c at 0.5) |
| **Total pass@2 Score** | 19.5/20 (97.5%) |
| **Average Agents (attempt 0)** | 1.35 |
| **Average Agents (attempt 1)** | 1.45 |
| **Average Iterations (attempt 0)** | 24.3 |
| **Average Iterations (attempt 1)** | 18.1 |
| **Average Time (attempt 0)** | 955s (15.9 min) |
| **Average Time (attempt 1)** | 902s (15.0 min) |
| **Fastest** | 2ba387bc at 93s (6 iterations) |
| **Slowest** | 36a08778 at 2905s (attempt 1, 26 iterations) |
| **Most Iterations** | 195c6913 at 109 iterations (attempt 0) |
| **Most Agents** | 446ef5d2 at 4 agents (attempt 1) |

### Problems Using Sub-Agents (from our 20)

Only 5 of our 20 problems required sub-agents in at least one attempt:
- 0934a4d8: 3 agents (attempt 0), 2 agents (attempt 1)
- 195c6913: 2 agents (attempt 1)
- 36a08778: 2 agents (attempt 1)
- 446ef5d2: 3 agents (attempt 0), 4 agents (attempt 1)
- 4e34c42c: 4 agents (attempt 1)

The remaining 15 problems were solved with a single agent in both attempts.
