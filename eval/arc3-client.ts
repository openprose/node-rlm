// ARC-AGI-3 REST API client.
// Manages scorecard lifecycle, cookie-based session affinity, and retry logic.

const BASE_URL = "https://three.arcprize.org";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface Arc3Frame {
	game_id: string;
	guid: string;
	frame: number[][][];
	state: "NOT_FINISHED" | "NOT_STARTED" | "WIN" | "GAME_OVER";
	levels_completed: number;
	win_levels: number;
	available_actions: number[];
}

export interface Arc3Scorecard {
	card_id: string;
	score: number;
	total_levels: number;
	[key: string]: unknown;
}

export interface Arc3Game {
	game_id: string;
	title: string;
}

/** Fetch the list of available ARC-3 games. */
export async function listGames(apiKey?: string): Promise<Arc3Game[]> {
	const key = apiKey ?? process.env.ARC3_API_KEY;
	if (!key) throw new Error("ARC3_API_KEY not set");

	const res = await fetch(`${BASE_URL}/api/games`, {
		headers: { "X-API-Key": key },
	});
	if (!res.ok) throw new Error(`GET /api/games failed: ${res.status} ${res.statusText}`);
	return res.json() as Promise<Arc3Game[]>;
}

export class Arc3Client {
	readonly gameId: string;
	private _apiKey: string;
	private _cookies: string = "";
	private _scorecardId: string | null = null;
	private _lastFrame: Arc3Frame | null = null;
	private _actionCount: number = 0;
	private _closed: boolean = false;

	constructor(gameId: string, apiKey?: string) {
		this.gameId = gameId;
		const key = apiKey ?? process.env.ARC3_API_KEY;
		if (!key) throw new Error("ARC3_API_KEY not set");
		this._apiKey = key;
	}

	get lastFrame(): Arc3Frame | null { return this._lastFrame; }
	get actionCount(): number { return this._actionCount; }
	get scorecardId(): string | null { return this._scorecardId; }

	get completed(): boolean {
		if (!this._lastFrame) return false;
		return this._lastFrame.state === "WIN" || this._lastFrame.state === "GAME_OVER";
	}

	/** Open a scorecard and reset the game. Returns the initial frame. */
	async start(): Promise<Arc3Frame> {
		// Open scorecard
		const cardRes = await this._request("POST", "/api/scorecard/open", {});
		this._scorecardId = cardRes.card_id as string;

		// Reset game
		const frame = await this._request("POST", "/api/cmd/RESET", {
			game_id: this.gameId,
			card_id: this._scorecardId,
		}) as unknown as Arc3Frame;

		this._lastFrame = frame;
		this._actionCount = 0;
		return frame;
	}

	/** Send an action and return the resulting frame. */
	async step(action: number, x?: number, y?: number): Promise<Arc3Frame> {
		if (!this._lastFrame) throw new Error("Call start() before step()");
		if (this.completed) throw new Error("Game already completed");

		const cmd = `ACTION${action}`;
		const body: Record<string, unknown> = {
			game_id: this.gameId,
			guid: this._lastFrame.guid,
		};
		if (action === 6 && x !== undefined && y !== undefined) {
			body.x = x;
			body.y = y;
		}

		const frame = await this._request("POST", `/api/cmd/${cmd}`, body) as unknown as Arc3Frame;
		this._lastFrame = frame;
		this._actionCount++;
		return frame;
	}

	/** Return the last received frame without making an API call. */
	observe(): Arc3Frame | null {
		return this._lastFrame;
	}

	/** Fetch the scorecard summary. */
	async getScore(): Promise<Arc3Scorecard> {
		if (!this._scorecardId) throw new Error("No scorecard open");
		const res = await this._request("GET", `/api/scorecard/${this._scorecardId}`);
		return res as unknown as Arc3Scorecard;
	}

	/** Close the scorecard. Idempotent. */
	async cleanup(): Promise<void> {
		if (this._closed || !this._scorecardId) return;
		this._closed = true;
		try {
			await this._request("POST", "/api/scorecard/close", {
				card_id: this._scorecardId,
			});
		} catch {
			// Best-effort cleanup
		}
	}

	private async _request(method: string, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
		const url = `${BASE_URL}${path}`;
		const headers: Record<string, string> = {
			"X-API-Key": this._apiKey,
			"Content-Type": "application/json",
		};
		if (this._cookies) {
			headers["Cookie"] = this._cookies;
		}

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			const res = await fetch(url, {
				method,
				headers,
				...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}),
			});

			// Capture session affinity cookies
			const setCookies = res.headers.getSetCookie?.() ?? [];
			if (setCookies.length > 0) {
				const awsCookies = setCookies
					.map((c) => c.split(";")[0])
					.filter((c) => c.startsWith("AWSALB"));
				if (awsCookies.length > 0) {
					this._cookies = awsCookies.join("; ");
				}
			}

			if (res.ok) {
				return res.json() as Promise<Record<string, unknown>>;
			}

			// Retry on 429 or 5xx
			if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
				const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
				await new Promise((r) => setTimeout(r, delay));
				continue;
			}

			const text = await res.text().catch(() => "");
			throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
		}

		throw new Error(`${method} ${path} failed after ${MAX_RETRIES} retries`);
	}
}
