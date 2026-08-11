export function getPiUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `a-coder-cli/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
