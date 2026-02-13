// ARC-AGI-2 dataset loader.
// Data is downloaded by eval/download.ts into eval/data/arc/.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalTask } from "../types.js";

const EVAL_DIR = new URL("..", import.meta.url).pathname;
const DATA_DIR = join(EVAL_DIR, "data", "arc");

interface ArcChallenge {
	train: Array<{ input: number[][]; output: number[][] }>;
	test: Array<{ input: number[][] }>;
}

type ArcChallenges = Record<string, ArcChallenge>;
type ArcSolutions = Record<string, number[][][]>;

export async function loadArcTasks(
	maxTasks?: number | null,
	selectedProblems?: string[],
): Promise<EvalTask[]> {
	const challengesPath = join(DATA_DIR, "arc-agi_evaluation_challenges.json");
	const solutionsPath = join(DATA_DIR, "arc-agi_evaluation_solutions.json");

	if (!existsSync(challengesPath) || !existsSync(solutionsPath)) {
		throw new Error(
			`ARC data not found at ${DATA_DIR}. Run 'npx tsx eval/download.ts --dataset arc' first.`,
		);
	}

	const challenges: ArcChallenges = JSON.parse(readFileSync(challengesPath, "utf-8"));
	const solutions: ArcSolutions = JSON.parse(readFileSync(solutionsPath, "utf-8"));

	let taskIds = Object.keys(challenges);

	// Filter to selected problems if specified
	if (selectedProblems && selectedProblems.length > 0) {
		const selected = new Set(selectedProblems);
		taskIds = taskIds.filter((id) => selected.has(id));
	}

	// Limit to maxTasks
	if (maxTasks && maxTasks > 0) {
		taskIds = taskIds.slice(0, maxTasks);
	}

	return taskIds.map((taskId) => {
		const challenge = challenges[taskId];
		const solution = solutions[taskId];

		if (!solution) {
			throw new Error(`No solution found for ARC task ${taskId}`);
		}

		// Build the context: the full task data
		const context = JSON.stringify({
			train: challenge.train,
			test: challenge.test,
		});

		// Build expected answer
		// Most tasks have 1 test input; some have multiple
		const expected = challenge.test.length === 1
			? JSON.stringify(solution[0])
			: JSON.stringify(solution);

		return {
			id: `arc-${taskId}`,
			query: buildArcQuery(challenge),
			context,
			expected,
			metadata: {
				numTrainExamples: challenge.train.length,
				numTestInputs: challenge.test.length,
			},
		};
	});
}

function buildArcQuery(challenge: ArcChallenge): string {
	const numTests = challenge.test.length;
	const returnFormat = numTests === 1
		? "Return the output as a JSON 2D array of integers, e.g.: [[1,2,3],[4,5,6]]"
		: `There are ${numTests} test inputs. Return an array of ${numTests} output grids as JSON, e.g.: [[[1,2],[3,4]], [[5,6],[7,8]]]`;

	return `You are solving an ARC-AGI task. The task data is available in the \`context\` variable as a JSON string.

The JSON contains:
- "train": Training examples, each with "input" and "output" grids (2D arrays of ints 0-9)
- "test": Test inputs with "input" grids only (you must predict the outputs)

Analyze all training examples to discover the transformation rule that maps each input to its output. The rule must be consistent across ALL training examples. Then apply it to the test input(s).

${returnFormat}

Return ONLY the raw JSON grid(s). No explanation, no markdown, no wrapping.`;
}
