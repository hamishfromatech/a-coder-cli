import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { INCEPTION_MODELS } from "./inception.models.ts";

export function inceptionProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "inception",
		name: "Inception",
		baseUrl: "https://api.inceptionlabs.ai/v1",
		auth: { apiKey: envApiKeyAuth("Inception API key", ["INCEPTION_API_KEY"]) },
		models: Object.values(INCEPTION_MODELS),
		api: openAICompletionsApi(),
	});
}
