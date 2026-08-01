/**
 * Comprehensive provider catalogue derived from packages/ai/src/providers/*.
 *
 * Each entry maps a provider id (the canonical key in `auth.json`, the
 * slash-command argument to `/login <id>`, and the path inside `MODELS`)
 * to:
 *
 *   - `label` — user-facing name shown in the Account section
 *   - `hint` — a one-line description of what models you get
 *   - `oauth` — true if the cli's `/login <id>` handles an OAuth device-code
 *     flow (Anthropic, GitHub Copilot, OpenAI Codex)
 *   - `keyless` — true if the provider has no API key UI (e.g. AWS Bedrock
 *     reads the AWS SDK chain, Vertex AI reads gcloud ADC). We just point
 *     users at the right env vars instead of opening an input form.
 *   - `envVars` — env-var names that authenticate this provider ambient-ly.
 *     Surfaced so users can paste them into shell or `.env`.
 *   - `consoleUrl` — link to the API-key management console
 *   - `group` — visual grouping in the Account section ("Major", "Asia",
 *     "Specialty")
 *
 * Keep this list in sync with packages/ai/src/providers/all.ts.
 */

export interface ProviderSpec {
	id: string;
	label: string;
	hint: string;
	oauth: boolean;
	/**
	 * Multi-field key. When true we don't show a paste-back input — instead we
	 * link the user to the provider's console and explain how to wire it up.
	 */
	complex?: boolean;
	/** Env vars that authenticate this provider when no stored credential exists. */
	envVars: string[];
	consoleUrl: string;
	group: "Major" | "Asia" | "Specialty" | "Self-hosted";
}

export const PROVIDER_SPECS: ProviderSpec[] = [
	// ---- Major Western providers ----------------------------------------
	{
		id: "anthropic",
		label: "Anthropic",
		hint: "Claude models — Opus, Sonnet, Haiku.",
		oauth: true,
		envVars: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
		consoleUrl: "https://console.anthropic.com/settings/keys",
		group: "Major",
	},
	{
		id: "openai",
		label: "OpenAI",
		hint: "GPT and o-series models.",
		oauth: false,
		envVars: ["OPENAI_API_KEY"],
		consoleUrl: "https://platform.openai.com/api-keys",
		group: "Major",
	},
	{
		id: "openai-codex",
		label: "OpenAI Codex (ChatGPT Plus/Pro)",
		hint: "Uses your ChatGPT subscription via OAuth.",
		oauth: true,
		envVars: [],
		consoleUrl: "https://chatgpt.com",
		group: "Major",
	},
	{
		id: "github-copilot",
		label: "GitHub Copilot",
		hint: "Copilot subscription. Models vary by tier.",
		oauth: true,
		envVars: ["COPILOT_GITHUB_TOKEN"],
		consoleUrl: "https://github.com/settings/tokens",
		group: "Major",
	},
	{
		id: "google",
		label: "Google Gemini",
		hint: "Gemini models via the Gemini API.",
		oauth: false,
		envVars: ["GEMINI_API_KEY"],
		consoleUrl: "https://aistudio.google.com/apikey",
		group: "Major",
	},
	{
		id: "google-vertex",
		label: "Google Vertex AI",
		hint: "Uses gcloud application-default credentials.",
		oauth: false,
		complex: true,
		envVars: [
			"GOOGLE_CLOUD_API_KEY",
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GOOGLE_CLOUD_PROJECT",
			"GOOGLE_CLOUD_LOCATION",
		],
		consoleUrl: "https://console.cloud.google.com/vertex-ai",
		group: "Major",
	},
	{
		id: "xai",
		label: "xAI",
		hint: "Grok models.",
		oauth: false,
		envVars: ["XAI_API_KEY"],
		consoleUrl: "https://console.x.ai",
		group: "Major",
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		hint: "DeepSeek's open-weights reasoning and chat models.",
		oauth: false,
		envVars: ["DEEPSEEK_API_KEY"],
		consoleUrl: "https://platform.deepseek.com/api_keys",
		group: "Major",
	},
	{
		id: "mistral",
		label: "Mistral",
		hint: "Mistral's open and commercial models.",
		oauth: false,
		envVars: ["MISTRAL_API_KEY"],
		consoleUrl: "https://console.mistral.ai/api-keys",
		group: "Major",
	},
	{
		id: "groq",
		label: "Groq",
		hint: "Fast inference for open-source LLMs.",
		oauth: false,
		envVars: ["GROQ_API_KEY"],
		consoleUrl: "https://console.groq.com/keys",
		group: "Major",
	},

	// ---- Aggregators / gateways -----------------------------------------
	{
		id: "openrouter",
		label: "OpenRouter",
		hint: "Routes requests to many providers under one key.",
		oauth: false,
		envVars: ["OPENROUTER_API_KEY"],
		consoleUrl: "https://openrouter.ai/keys",
		group: "Major",
	},
	{
		id: "together",
		label: "Together AI",
		hint: "Open-source models hosted by Together.",
		oauth: false,
		envVars: ["TOGETHER_API_KEY"],
		consoleUrl: "https://api.together.ai/settings/api-keys",
		group: "Major",
	},
	{
		id: "fireworks",
		label: "Fireworks",
		hint: "Fast open-source model inference.",
		oauth: false,
		envVars: ["FIREWORKS_API_KEY"],
		consoleUrl: "https://fireworks.ai/account/api-keys",
		group: "Major",
	},
	{
		id: "cerebras",
		label: "Cerebras",
		hint: "High-speed inference on Cerebras hardware.",
		oauth: false,
		envVars: ["CEREBRAS_API_KEY"],
		consoleUrl: "https://cloud.cerebras.ai",
		group: "Major",
	},
	{
		id: "nvidia",
		label: "NVIDIA NIM",
		hint: "NVIDIA-hosted NIM endpoints.",
		oauth: false,
		envVars: ["NVIDIA_API_KEY"],
		consoleUrl: "https://build.nvidia.com",
		group: "Major",
	},
	{
		id: "huggingface",
		label: "Hugging Face",
		hint: "Routes to community-hosted models.",
		oauth: false,
		envVars: ["HF_TOKEN"],
		consoleUrl: "https://huggingface.co/settings/tokens",
		group: "Major",
	},
	{
		id: "vercel-ai-gateway",
		label: "Vercel AI Gateway",
		hint: "Vercel's multi-provider gateway.",
		oauth: false,
		envVars: ["AI_GATEWAY_API_KEY"],
		consoleUrl: "https://vercel.com/dashboard/ai-gateway",
		group: "Major",
	},
	{
		id: "cloudflare-ai-gateway",
		label: "Cloudflare AI Gateway",
		hint: "Requires API key + account ID + gateway ID.",
		oauth: false,
		complex: true,
		envVars: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
		consoleUrl: "https://dash.cloudflare.com/?to=/:account/ai/ai-gateway",
		group: "Major",
	},
	{
		id: "cloudflare-workers-ai",
		label: "Cloudflare Workers AI",
		hint: "Cloudflare account ID + API key.",
		oauth: false,
		complex: true,
		envVars: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
		consoleUrl: "https://dash.cloudflare.com/?to=/:account/workers/ai",
		group: "Major",
	},
	{
		id: "amazon-bedrock",
		label: "Amazon Bedrock",
		hint: "AWS-resident models — uses your AWS credentials.",
		oauth: false,
		complex: true,
		envVars: [
			"AWS_BEARER_TOKEN_BEDROCK",
			"AWS_PROFILE",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
		],
		consoleUrl: "https://console.aws.amazon.com/bedrock",
		group: "Major",
	},
	{
		id: "azure-openai-responses",
		label: "Azure OpenAI",
		hint: "Azure-hosted OpenAI models.",
		oauth: false,
		envVars: ["AZURE_OPENAI_API_KEY"],
		consoleUrl: "https://oai.azure.com",
		group: "Major",
	},

	// ---- Asian providers ------------------------------------------------
	{
		id: "kimi-coding",
		label: "Kimi (Moonshot)",
		hint: "Kimi K2 — strong for code.",
		oauth: false,
		envVars: ["KIMI_API_KEY"],
		consoleUrl: "https://platform.moonshot.cn/console/api-keys",
		group: "Asia",
	},
	{
		id: "moonshotai",
		label: "Moonshot AI (.ai)",
		hint: "International Moonshot AI endpoint.",
		oauth: false,
		envVars: ["MOONSHOT_API_KEY"],
		consoleUrl: "https://platform.moonshot.ai/console/api-keys",
		group: "Asia",
	},
	{
		id: "moonshotai-cn",
		label: "Moonshot AI (.cn)",
		hint: "China-region Moonshot AI endpoint.",
		oauth: false,
		envVars: ["MOONSHOT_API_KEY"],
		consoleUrl: "https://platform.moonshot.cn/console/api-keys",
		group: "Asia",
	},
	{
		id: "minimax",
		label: "MiniMax (international)",
		hint: "MiniMax's hosted models.",
		oauth: false,
		envVars: ["MINIMAX_API_KEY"],
		consoleUrl: "https://platform.MiniMax.io",
		group: "Asia",
	},
	{
		id: "minimax-cn",
		label: "MiniMax (China)",
		hint: "China-region MiniMax endpoint.",
		oauth: false,
		envVars: ["MINIMAX_CN_API_KEY"],
		consoleUrl: "https://platform.MiniMax.cn",
		group: "Asia",
	},
	{
		id: "zai",
		label: "Z.AI (international)",
		hint: "Z.AI's hosted GLM models.",
		oauth: false,
		envVars: ["ZAI_API_KEY"],
		consoleUrl: "https://z.ai",
		group: "Asia",
	},
	{
		id: "zai-coding-cn",
		label: "Z.AI Coding (.cn)",
		hint: "China-region Z.AI coding endpoint.",
		oauth: false,
		envVars: ["ZAI_CODING_CN_API_KEY"],
		consoleUrl: "https://open.bigmodel.cn",
		group: "Asia",
	},
	{
		id: "xiaomi",
		label: "Xiaomi MiMo",
		hint: "Xiaomi's hosted MiMo models.",
		oauth: false,
		envVars: ["XIAOMI_API_KEY"],
		consoleUrl: "https://api.xiaomimimo.com",
		group: "Asia",
	},
	{
		id: "xiaomi-token-plan-ams",
		label: "Xiaomi Token Plan (Amsterdam)",
		hint: "Xiaomi token-plan endpoint in Amsterdam.",
		oauth: false,
		envVars: ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
		consoleUrl: "https://token-plan-ams.xiaomimimo.com",
		group: "Asia",
	},
	{
		id: "xiaomi-token-plan-cn",
		label: "Xiaomi Token Plan (China)",
		hint: "Xiaomi token-plan endpoint in China.",
		oauth: false,
		envVars: ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
		consoleUrl: "https://token-plan-cn.xiaomimimo.com",
		group: "Asia",
	},
	{
		id: "xiaomi-token-plan-sgp",
		label: "Xiaomi Token Plan (Singapore)",
		hint: "Xiaomi token-plan endpoint in Singapore.",
		oauth: false,
		envVars: ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
		consoleUrl: "https://token-plan-sgp.xiaomimimo.com",
		group: "Asia",
	},

	// ---- Specialty / self-hosted ----------------------------------------
	{
		id: "opencode",
		label: "OpenCode",
		hint: "OpenCode's hosted models.",
		oauth: false,
		envVars: ["OPENCODE_API_KEY"],
		consoleUrl: "https://opencode.ai",
		group: "Specialty",
	},
	{
		id: "opencode-go",
		label: "OpenCode Go",
		hint: "OpenCode's free Go tier.",
		oauth: false,
		envVars: ["OPENCODE_API_KEY"],
		consoleUrl: "https://opencode.ai",
		group: "Specialty",
	},
	{
		id: "ollama-cloud",
		label: "Ollama Cloud",
		hint: "Hosted Ollama-compatible endpoint.",
		oauth: false,
		envVars: ["OLLAMA_API_KEY"],
		consoleUrl: "https://ollama.com",
		group: "Specialty",
	},
	{
		id: "openadapter",
		label: "OpenAdapter",
		hint: "OpenAdapter's free tier.",
		oauth: false,
		envVars: ["OPENADAPTER_API_KEY"],
		consoleUrl: "https://openadapter.in",
		group: "Specialty",
	},
	{
		id: "ant-ling",
		label: "Ant Ling",
		hint: "Ant Ling open-source access.",
		oauth: false,
		envVars: ["ANT_LING_API_KEY"],
		consoleUrl: "https://api.ant-ling.com",
		group: "Specialty",
	},
];

/** Provider specs grouped for the Account UI. */
export function groupedProviders(): Array<{ group: string; providers: ProviderSpec[] }> {
	const out: Array<{ group: string; providers: ProviderSpec[] }> = [];
	for (const spec of PROVIDER_SPECS) {
		const last = out[out.length - 1];
		if (last && last.group === spec.group) {
			last.providers.push(spec);
		} else {
			out.push({ group: spec.group, providers: [spec] });
		}
	}
	return out;
}
