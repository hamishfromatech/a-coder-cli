/**
 * Detached daemon entry point. The CLI spawns this module in a detached
 * child process when the cloud daemon is not running yet.
 */
import { serve } from "./serve.ts";

void serve().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
