// ARC-AGI-3 dataset loader.
// Games are played via the REST API — no local data download needed.

import { listGames } from "../arc3-client.js";
import type { EvalTask } from "../types.js";

export async function loadArc3Tasks(
	games?: string[],
	maxTasks?: number | null,
): Promise<EvalTask[]> {
	// Always fetch the full game list — game IDs have suffixes (e.g. "ls20-cb3b57cc")
	// and the user may pass short prefixes like "ls20".
	const available = await listGames();
	let gameIds: string[];

	if (games && games.length > 0) {
		// Resolve each user-provided name to a full game ID via prefix match
		gameIds = games.map((prefix) => {
			const match = available.find((g) => g.game_id === prefix || g.game_id.startsWith(prefix + "-"));
			if (!match) {
				const known = available.map((g) => g.game_id).join(", ");
				throw new Error(`Game '${prefix}' not found. Available: ${known}`);
			}
			return match.game_id;
		});
	} else {
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
