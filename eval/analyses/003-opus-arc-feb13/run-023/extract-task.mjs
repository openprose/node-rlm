#!/usr/bin/env node
// Extract a specific task's raw trace data from the results JSON

import { readFileSync } from 'fs';

const resultsPath = process.argv[2];
const taskId = process.argv[3];

if (!resultsPath || !taskId) {
  console.error('Usage: node extract-task.mjs <results-file> <task-id>');
  process.exit(1);
}

const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const task = results.results.find(r => r.taskId === taskId);

if (!task) {
  console.error(`Task ${taskId} not found`);
  process.exit(1);
}

console.log(JSON.stringify(task, null, 2));
