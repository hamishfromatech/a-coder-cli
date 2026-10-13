import { systemoneDecisionsApi } from "../../api/systemone.lazy.ts";
import { registerDecisionsApiProvider } from "../../decisions-api-registry.ts";

/** Registers the System One decision API (lazily loaded) under its `api` id. */
registerDecisionsApiProvider({
	api: "systemone",
	postDecisions: systemoneDecisionsApi(),
});
