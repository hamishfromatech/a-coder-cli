export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.A_CODER_CLI_EXPERIMENTAL === "1";
}
