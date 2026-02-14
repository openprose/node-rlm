// ARC-AGI-3 dataset loader.
// Games are played via the REST API — no local data download needed.

import { listGames } from "../arc3-client.js";
import type { EvalTask } from "../types.js";

export async function loadArc3Tasks(
	games?: string[],
	maxTasks?: number | null,
): Promise<EvalTask[]> {
	let gameIds: string[];

	if (games && games.length > 0) {
		gameIds = games;
	} else {
		const available = await listGames();
		gameIds = available.map((g) => g.game_id);
	}

	if (maxTasks && maxTasks > 0) {
		gameIds = gameIds.slice(0, maxTasks);
	}

	return gameIds.map((gameId) => ({
		id: `arc3-${gameId}`,
		query: `Play the ARC-AGI-3 game '${gameId}'. The \`arc3\` sandbox global provides the game API. Minimize actions — you are scored on efficiency. When done, return the scorecard JSON.`,
		context: "",
		expected: "interactive",
		metadata: { gameId },
	}));
}
