import type { CallLLM } from "../../src/rlm.js";
import { fromOpenRouterCompatible } from "../../src/drivers/openrouter-compatible.js";

export function fromOpenRouter(model: string, apiKey: string): CallLLM {
	return fromOpenRouterCompatible({
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey,
		model,
		tools: true,
	});
}
