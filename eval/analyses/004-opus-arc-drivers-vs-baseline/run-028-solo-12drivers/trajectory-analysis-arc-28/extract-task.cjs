// Helper script to extract a single task's trace data from the results JSON
const fs = require('fs');

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: node extract-task.js <taskId>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync('eval/results/arc_anthropic_claude-opus-4-6_2026-02-13T19-50-35-182Z.json', 'utf8'));
const task = data.results.find(t => t.taskId === taskId);

if (!task) {
  console.error(`Task ${taskId} not found`);
  process.exit(1);
}

console.log(JSON.stringify(task, null, 2));
