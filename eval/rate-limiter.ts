import type { CallLLM } from "../src/rlm.js";

export interface RateLimitConfig {
	requestsPerSecond: number;
	burst?: number;
}

class TokenBucket {
	private tokens: number;
	private readonly capacity: number;
	private readonly refillRate: number; // tokens per ms
	private lastRefill: number;

	constructor(capacity: number, refillPerSecond: number) {
		this.capacity = capacity;
		this.tokens = capacity;
		this.refillRate = refillPerSecond / 1000;
		this.lastRefill = Date.now();
	}

	async acquire(): Promise<void> {
		while (true) {
			this.refill();
			if (this.tokens >= 1) {
				this.tokens -= 1;
				return;
			}
			// Wait until at least one token is available
			const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}

	private refill(): void {
		const now = Date.now();
		const elapsed = now - this.lastRefill;
		if (elapsed <= 0) return;
		this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
		this.lastRefill = now;
	}
}

export function withRateLimit(callLLM: CallLLM, config: RateLimitConfig): CallLLM {
	const bucket = new TokenBucket(
		config.burst ?? config.requestsPerSecond,
		config.requestsPerSecond,
	);
	return async (messages, systemPrompt) => {
		await bucket.acquire();
		return callLLM(messages, systemPrompt);
	};
}
