// Single source of truth for the dependency lifecycle scripts the shipped
// installer locks intentionally allow. Both the coding-agent shrinkwrap and
// install-lock generators import this map so the two artifacts cannot drift.
export const allowedInstallScriptPackages = new Map([
	["@google/genai@2.21.0", "preinstall is a no-op in the published package"],
	["protobufjs@7.6.6", "postinstall only warns about protobufjs version scheme mismatches"],
]);
