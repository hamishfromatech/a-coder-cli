import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENADAPTER_MODELS } from "./openadapter.models.ts";

export function openadapterProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "openadapter",
		name: "OpenAdapter",
		baseUrl: "https://api.openadapter.in/v1",
		auth: { apiKey: envApiKeyAuth("OpenAdapter API key", ["OPENADAPTER_API_KEY"]) },
		models: Object.values(OPENADAPTER_MODELS),
		api: openAICompletionsApi(),
	});
}
