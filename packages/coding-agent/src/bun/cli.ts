#!/usr/bin/env node
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";

import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;

// Register statically bundled OAuth flows so compiled Bun binaries never hit
// the runtime dynamic-import fallback in auth/oauth/load.ts (unresolvable
// from inside the standalone executable, "/$bunfs/root/<bin>").
registerBunOAuthFlows();

import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();

await import("./register-bedrock.ts");
await import("../cli.ts");
