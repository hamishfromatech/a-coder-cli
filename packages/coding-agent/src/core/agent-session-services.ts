import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AuthStorage } from "./auth-storage.ts";
import type { SessionStartEvent, ToolDefinition } from "./extensions/index.ts";
import { ModelRegistry } from "./model-registry.ts";
import {
	DefaultResourceLoader,
	type DefaultResourceLoaderOptions,
	type ResourceLoader,
	type ResourceLoaderReloadOptions,
} from "./resource-loader.ts";
import { type CreateAgentSessionOptions, type CreateAgentSessionResult, createAgentSession } from "./sdk.ts";
import type { SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";

// ============================================================================
// Cwd-bound service cache
// ============================================================================

/** Key that uniquely identifies a set of cwd-bound services. */
interface ServiceCacheKey {
	cwd: string;
	agentDir: string;
	resourceLoaderOptionsHash: string;
}

function serviceCacheKey(
	cwd: string,
	agentDir: string,
	resourceLoaderOptions: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager"> | undefined,
): string {
	return JSON.stringify({
		cwd,
		agentDir,
		// Hash only the parts of resourceLoaderOptions that matter for caching.
		additionalExtensionPaths: resourceLoaderOptions?.additionalExtensionPaths ?? [],
		additionalSkillPaths: resourceLoaderOptions?.additionalSkillPaths ?? [],
		additionalPromptTemplatePaths: resourceLoaderOptions?.additionalPromptTemplatePaths ?? [],
		additionalThemePaths: resourceLoaderOptions?.additionalThemePaths ?? [],
		noExtensions: resourceLoaderOptions?.noExtensions,
		noSkills: resourceLoaderOptions?.noSkills,
		noPromptTemplates: resourceLoaderOptions?.noPromptTemplates,
		noThemes: resourceLoaderOptions?.noThemes,
		noContextFiles: resourceLoaderOptions?.noContextFiles,
		systemPrompt: resourceLoaderOptions?.systemPrompt,
		appendSystemPrompt: resourceLoaderOptions?.appendSystemPrompt,
		extensionFactoriesCount: (resourceLoaderOptions?.extensionFactories ?? []).length,
	});
}

interface CachedServices {
	services: AgentSessionServices;
	projectTrusted: boolean | undefined;
}

const servicesByKey = new Map<string, CachedServices>();

/** Clear the cwd-bound service cache. Primarily useful in tests. */
export function clearAgentSessionServicesCache(): void {
	servicesByKey.clear();
}

/** Return cached services when cwd, agentDir, and resource-loader config match.
 *
 *  The cache is keyed by the *structural* resource-loader options, not by
 *  mutable runtime state (settings on disk, auth storage contents, or model
 *  registry dynamic models). Those are live objects and will be reused directly.
 */
function getCachedServices(
	cwd: string,
	agentDir: string,
	resourceLoaderOptions: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager"> | undefined,
): CachedServices | undefined {
	return servicesByKey.get(serviceCacheKey(cwd, agentDir, resourceLoaderOptions));
}

function setCachedServices(
	cwd: string,
	agentDir: string,
	resourceLoaderOptions: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager"> | undefined,
	cached: CachedServices,
): void {
	servicesByKey.set(serviceCacheKey(cwd, agentDir, resourceLoaderOptions), cached);
}

/**
 * Non-fatal issues collected while creating services or sessions.
 *
 * Runtime creation returns diagnostics to the caller instead of printing or
 * exiting. The app layer decides whether warnings should be shown and whether
 * errors should abort startup.
 */
export interface AgentSessionRuntimeDiagnostic {
	type: "info" | "warning" | "error";
	message: string;
}

/**
 * Inputs for creating cwd-bound runtime services.
 *
 * These services are recreated whenever the effective session cwd changes.
 * CLI-provided resource paths should be resolved to absolute paths before they
 * reach this function, so later cwd switches do not reinterpret them.
 */
export interface CreateAgentSessionServicesOptions {
	cwd: string;
	agentDir?: string;
	/** Reuse an existing auth storage for this agent dir instead of creating one. */
	authStorage?: AuthStorage;
	/** When true, skip the cwd-bound service cache and always build fresh services. */
	disableCache?: boolean;
	settingsManager?: SettingsManager;
	modelRegistry?: ModelRegistry;
	extensionFlagValues?: Map<string, boolean | string>;
	resourceLoaderOptions?: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">;
	resourceLoaderReloadOptions?: ResourceLoaderReloadOptions;
}

/**
 * Inputs for creating an AgentSession from already-created services.
 *
 * Use this after services exist and any cwd-bound model/tool/session options
 * have been resolved against those services.
 */
export interface CreateAgentSessionFromServicesOptions {
	services: AgentSessionServices;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	tools?: string[];
	excludeTools?: CreateAgentSessionOptions["excludeTools"];
	noTools?: CreateAgentSessionOptions["noTools"];
	customTools?: ToolDefinition[];
}

/**
 * Coherent cwd-bound runtime services for one effective session cwd.
 *
 * This is infrastructure only. The AgentSession itself is created separately so
 * session options can be resolved against these services first.
 */
export interface AgentSessionServices {
	cwd: string;
	agentDir: string;
	authStorage: AuthStorage;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	resourceLoader: ResourceLoader;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

function applyExtensionFlagValues(
	resourceLoader: ResourceLoader,
	extensionFlagValues: Map<string, boolean | string> | undefined,
): AgentSessionRuntimeDiagnostic[] {
	if (!extensionFlagValues) {
		return [];
	}

	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	const extensionsResult = resourceLoader.getExtensions();
	const registeredFlags = new Map<string, { type: "boolean" | "string" }>();
	for (const extension of extensionsResult.extensions) {
		for (const [name, flag] of extension.flags) {
			registeredFlags.set(name, { type: flag.type });
		}
	}

	const unknownFlags: string[] = [];
	for (const [name, value] of extensionFlagValues) {
		const flag = registeredFlags.get(name);
		if (!flag) {
			unknownFlags.push(name);
			continue;
		}
		if (flag.type === "boolean") {
			extensionsResult.runtime.flagValues.set(name, true);
			continue;
		}
		if (typeof value === "string") {
			extensionsResult.runtime.flagValues.set(name, value);
			continue;
		}
		diagnostics.push({
			type: "error",
			message: `Extension flag "--${name}" requires a value`,
		});
	}

	if (unknownFlags.length > 0) {
		diagnostics.push({
			type: "error",
			message: `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
		});
	}

	return diagnostics;
}

/**
 * Create cwd-bound runtime services.
 *
 * Returns services plus diagnostics. It does not create an AgentSession.
 */
export async function createAgentSessionServices(
	options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
	const start = performance.now();
	const cwd = resolvePath(options.cwd);
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getAgentDir();
	const resourceLoaderOptions = options.resourceLoaderOptions ?? {};

	const cached = !options.disableCache ? getCachedServices(cwd, agentDir, resourceLoaderOptions) : undefined;

	if (cached) {
		// Reload settings from disk so mid-session edits are visible. This is
		// cheap: it just re-reads the two JSON files and rebuilds the merged
		// settings object without re-running extension/skill/theme discovery.
		await cached.services.settingsManager.reload();
		// Refresh dynamic model lists so newly added keys / models are available.
		// This is a no-op when recently refreshed and caches are warm.
		void cached.services.modelRegistry.refreshDynamicModels().catch(() => {});
		return cached.services;
	}

	const authStorage = options.authStorage ?? AuthStorage.create(join(agentDir, "auth.json"));
	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, join(agentDir, "models.json"));
	const resourceLoader = new DefaultResourceLoader({
		...resourceLoaderOptions,
		cwd,
		agentDir,
		settingsManager,
	});
	await resourceLoader.reload(options.resourceLoaderReloadOptions);

	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	const extensionsResult = resourceLoader.getExtensions();
	for (const { name, config, extensionPath } of extensionsResult.runtime.pendingProviderRegistrations) {
		try {
			modelRegistry.registerProvider(name, config);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			diagnostics.push({
				type: "error",
				message: `Extension "${extensionPath}" error: ${message}`,
			});
		}
	}
	extensionsResult.runtime.pendingProviderRegistrations = [];
	diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));

	// When reusing a cached authStorage, ensure any runtime API key overrides or
	// persisted auth-file changes are reflected before the new session starts.
	authStorage.reload();

	const services: AgentSessionServices = {
		cwd,
		agentDir,
		authStorage,
		settingsManager,
		modelRegistry,
		resourceLoader,
		diagnostics,
	};

	if (process.env.A_CODER_CLI_TIMING === "1") {
		console.error(`[createAgentSessionServices] uncached: ${Math.round(performance.now() - start)}ms`);
	}

	// Only cache when we created the infrastructure ourselves. Callers that pass
	// pre-constructed authStorage/settingsManager/modelRegistry are usually tests
	// and may mutate or tear down those objects; caching them is unsafe.
	if (!options.authStorage && !options.settingsManager && !options.modelRegistry && !options.disableCache) {
		setCachedServices(cwd, agentDir, resourceLoaderOptions, { services, projectTrusted: undefined });
	}

	return services;
}

/**
 * Create an AgentSession from previously created services.
 *
 * This keeps session creation separate from service creation so callers can
 * resolve model, thinking, tools, and other session inputs against the target
 * cwd before constructing the session.
 */
export async function createAgentSessionFromServices(
	options: CreateAgentSessionFromServicesOptions,
): Promise<CreateAgentSessionResult> {
	return createAgentSession({
		cwd: options.services.cwd,
		agentDir: options.services.agentDir,
		authStorage: options.services.authStorage,
		settingsManager: options.services.settingsManager,
		modelRegistry: options.services.modelRegistry,
		resourceLoader: options.services.resourceLoader,
		sessionManager: options.sessionManager,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		scopedModels: options.scopedModels,
		tools: options.tools,
		excludeTools: options.excludeTools,
		noTools: options.noTools,
		customTools: options.customTools,
		sessionStartEvent: options.sessionStartEvent,
	});
}
