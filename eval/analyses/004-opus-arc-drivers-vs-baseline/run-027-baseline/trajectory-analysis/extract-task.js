#!/usr/bin/env node
// Extract a single task's complete data from results JSON
import fs from 'fs';

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: node extract-task.js <taskId>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync('eval/results/arc_anthropic_claude-opus-4-6_2026-02-13T17-38-49-180Z.json', 'utf8'));
const result = data.results.find(r => r.taskId === taskId);

if (!result) {
  console.error(`Task ${taskId} not found`);
  process.exit(1);
}

// Output the full task data as JSON
console.log(JSON.stringify(result, null, 2));
