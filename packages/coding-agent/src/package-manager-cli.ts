import { createHash } from "node:crypto";
import {
	closeSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";
import lockfile from "proper-lockfile";
import { selectConfig } from "./cli/config-selector.ts";
import { createProjectTrustContext } from "./cli/project-trust.ts";
import {
	APP_NAME,
	CONFIG_DIR_NAME,
	detectInstallMethod,
	getAgentDir,
	getPackageDir,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	PACKAGE_NAME,
	type SelfUpdateCommand,
	type SelfUpdatePackageTarget,
	VERSION,
} from "./config.ts";
import type { ExtensionFactory } from "./core/extensions/types.ts";
import { DefaultPackageManager } from "./core/package-manager.ts";
import { type AppMode, resolveProjectTrusted } from "./core/project-trust.ts";
import { DefaultResourceLoader } from "./core/resource-loader.ts";
import { type PackageSource, SettingsManager } from "./core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "./core/trust-manager.ts";
import { spawnProcess, spawnProcessSync } from "./utils/child-process.ts";
import { runInstallerSelfUpdate } from "./utils/cli-self-update.ts";
import { canonicalizePath, getCwdRelativePath } from "./utils/paths.ts";
import { getPiUserAgent } from "./utils/pi-user-agent.ts";
import { getGitHubReleaseDownloadUrl, getLatestPiRelease, isNewerPackageVersion } from "./utils/version-check.ts";
import {
	cleanupWindowsSelfUpdateQuarantine,
	quarantineWindowsNativeDependencies,
} from "./utils/windows-self-update.ts";

export type PackageCommand = "install" | "remove" | "update" | "list";

type UpdateTarget = { type: "all" } | { type: "self" } | { type: "extensions"; source?: string };

// ============================================================================
// Managed installations (install-a-coder.sh layout)
//
// Installer-managed installations live in <root>/lib/a-coder-cli with a
// <root>/VERSION marker written by the installer. `update --self` stages the
// GitHub release archive for the current platform, verifies its SHA256 against
// the release's SHA256SUMS, smoke-tests the staged binary, and only then swaps
// it into place, leaving the current release intact if any step fails.
// ============================================================================

const MANAGED_RELEASE_DIR_NAME = "a-coder-cli";
const MANAGED_VERSION_MARKER = "VERSION";
const MANAGED_STAGING_DIR = "staging";
const MANAGED_UPDATE_LOCK_DIR = "update";
const MANAGED_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MANAGED_DOWNLOAD_TIMEOUT_MS = 600_000;
const MANAGED_PROCESS_TIMEOUT_MS = 30_000;
// `update` keeps refreshing the lock mtime so a long download is never stolen;
// an abandoned lock becomes stealable only after it stops being refreshed.
const MANAGED_UPDATE_LOCK_OPTIONS = { realpath: false, stale: 120_000, update: 10_000 };

interface ManagedInstallRoot {
	root: string;
	releaseDir: string;
}

function getActiveManagedInstallRoot(): ManagedInstallRoot | undefined {
	const packageDir = canonicalizePath(getPackageDir());
	const configuredRoot = process.env.A_CODER_MANAGED_INSTALL_ROOT?.trim();
	let root: string;
	if (configuredRoot) {
		root = canonicalizePath(resolve(configuredRoot));
		// The launcher environment is inherited by child processes. Do not classify a
		// source checkout or another installation launched from managed installs as managed.
		if (getCwdRelativePath(packageDir, join(root, "lib", MANAGED_RELEASE_DIR_NAME)) === undefined) return undefined;
	} else {
		if (basename(packageDir) !== MANAGED_RELEASE_DIR_NAME || basename(dirname(packageDir)) !== "lib") {
			return undefined;
		}
		root = dirname(dirname(packageDir));
	}

	if (!existsSync(join(root, MANAGED_VERSION_MARKER)) || !existsSync(join(root, "lib", MANAGED_RELEASE_DIR_NAME))) {
		if (configuredRoot) {
			throw new Error(`Managed install marker is missing or invalid: ${join(root, MANAGED_VERSION_MARKER)}`);
		}
		return undefined;
	}
	return { root, releaseDir: join(root, "lib", MANAGED_RELEASE_DIR_NAME) };
}

function readManagedVersionTag(managedRoot: string): string | undefined {
	try {
		return readFileSync(join(managedRoot, MANAGED_VERSION_MARKER), "utf8").trim();
	} catch {
		return undefined;
	}
}

function toReleaseTag(version: string): string {
	return version.startsWith("v") ? version : `v${version}`;
}

function getManagedReleaseAssetName(): string {
	const platform = process.platform === "win32" ? "windows" : process.platform;
	const extension = process.platform === "win32" ? "zip" : "tar.gz";
	return `pi-${platform}-${process.arch}.${extension}`;
}

async function downloadManagedReleaseAsset(url: string, destinationPath: string, label: string): Promise<void> {
	const response = await fetch(url, {
		headers: { "User-Agent": getPiUserAgent(VERSION) },
		signal: AbortSignal.timeout(MANAGED_DOWNLOAD_TIMEOUT_MS),
	});
	if (!response.ok || !response.body) {
		throw new Error(`Could not download managed ${label} from ${url}: HTTP ${response.status}`);
	}
	await pipeline(
		Readable.fromWeb(response.body as unknown as NodeWebReadableStream),
		createWriteStream(destinationPath),
	);
}

function sha256File(filePath: string): string {
	const hash = createHash("sha256");
	const descriptor = openSync(filePath, "r");
	try {
		const buffer = Buffer.alloc(1024 * 1024);
		for (;;) {
			const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
		}
	} finally {
		closeSync(descriptor);
	}
	return hash.digest("hex");
}

function extractManagedArchiveChecksum(checksums: string, assetName: string): string | undefined {
	for (const line of checksums.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const [hash, ...rest] = trimmed.split(/\s+/);
		if (hash && rest.join(" ") === assetName) return hash.toLowerCase();
	}
	return undefined;
}

function verifyManagedArchiveChecksum(archivePath: string, checksums: string, assetName: string): void {
	const expected = extractManagedArchiveChecksum(checksums, assetName);
	if (!expected) {
		throw new Error(`Managed release SHA256SUMS does not list ${assetName}.`);
	}
	if (sha256File(archivePath) !== expected) {
		throw new Error(`Managed release archive ${assetName} failed SHA256 verification.`);
	}
}

function extractManagedReleaseArchive(archivePath: string, destinationDir: string): void {
	const result = spawnProcessSync("tar", ["-xzf", archivePath, "-C", destinationDir, "--strip-components=1"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: MANAGED_PROCESS_TIMEOUT_MS,
	});
	if (result.error || result.status !== 0) {
		const reason = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
		throw new Error(`Could not extract managed ${APP_NAME} release archive: ${reason}`);
	}
}

function verifyManagedRelease(releaseDir: string, expectedVersion: string): void {
	const binPath = join(releaseDir, process.platform === "win32" ? "pi.exe" : "pi");
	const result = spawnProcessSync(binPath, ["--version"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: MANAGED_PROCESS_TIMEOUT_MS,
	});
	if (result.error || result.status !== 0) {
		const reason = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
		throw new Error(`Could not verify managed ${APP_NAME} ${expectedVersion}: ${reason}`);
	}
	const installedVersion = result.stdout.trim();
	if (installedVersion !== expectedVersion) {
		throw new Error(
			`Managed ${APP_NAME} smoke test returned version ${installedVersion}; expected ${expectedVersion}.`,
		);
	}
}

function replaceManagedReleaseDirectory(managedInstall: ManagedInstallRoot, stagedDir: string): void {
	if (!existsSync(managedInstall.releaseDir)) {
		renameSync(stagedDir, managedInstall.releaseDir);
		return;
	}
	const backupDir = join(managedInstall.root, "lib", `${MANAGED_RELEASE_DIR_NAME}.old-${process.pid}-${Date.now()}`);
	renameSync(managedInstall.releaseDir, backupDir);
	try {
		renameSync(stagedDir, managedInstall.releaseDir);
	} catch (error: unknown) {
		try {
			renameSync(backupDir, managedInstall.releaseDir);
		} catch {
			// Startup cleanup restores the backup on the next run.
		}
		throw error;
	}
	try {
		rmSync(backupDir, { force: true, recursive: true });
	} catch {
		// A concurrent process may still hold the old tree open; startup cleanup retries.
	}
}

function activateManagedRelease(managedInstall: ManagedInstallRoot, tag: string): void {
	const versionPath = join(managedInstall.root, MANAGED_VERSION_MARKER);
	const temporaryPath = `${versionPath}.tmp.${process.pid}-${Date.now()}`;
	try {
		writeFileSync(temporaryPath, `${tag}\n`);
		renameSync(temporaryPath, versionPath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function cleanupManagedStaging(managedRoot: string): void {
	const stagingRoot = join(managedRoot, MANAGED_STAGING_DIR);
	try {
		for (const entry of readdirSync(stagingRoot)) {
			if (entry.startsWith("update-")) {
				rmSync(join(stagingRoot, entry), { force: true, recursive: true });
			}
		}
	} catch {
		// The staging directory does not exist yet or is not writable.
	}
}

function restoreInterruptedManagedRelease(managedRoot: string): void {
	const libRoot = join(managedRoot, "lib");
	const releaseDir = join(libRoot, MANAGED_RELEASE_DIR_NAME);
	if (existsSync(releaseDir)) return;
	try {
		for (const entry of readdirSync(libRoot)) {
			if (entry.startsWith(`${MANAGED_RELEASE_DIR_NAME}.old-`)) {
				renameSync(join(libRoot, entry), releaseDir);
				return;
			}
		}
	} catch {
		// Nothing to restore or not writable; the next startup retries.
	}
}

export function cleanupManagedInstall(): void {
	let managedInstall: ManagedInstallRoot | undefined;
	try {
		managedInstall = getActiveManagedInstallRoot();
	} catch {
		return;
	}
	if (!managedInstall) return;

	try {
		const releaseLock = lockfile.lockSync(
			join(managedInstall.root, MANAGED_UPDATE_LOCK_DIR),
			MANAGED_UPDATE_LOCK_OPTIONS,
		);
		try {
			restoreInterruptedManagedRelease(managedInstall.root);
			cleanupManagedStaging(managedInstall.root);
		} finally {
			releaseLock();
		}
	} catch {
		// A live update owns the staging directory, or cleanup is unavailable.
	}
}

async function runManagedSelfUpdate(managedInstall: ManagedInstallRoot, version: string): Promise<void> {
	if (!MANAGED_RELEASE_VERSION_RE.test(version)) {
		throw new Error(`Invalid managed release version: ${version}`);
	}

	let releaseLock: () => Promise<void>;
	try {
		releaseLock = await lockfile.lock(
			join(managedInstall.root, MANAGED_UPDATE_LOCK_DIR),
			MANAGED_UPDATE_LOCK_OPTIONS,
		);
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
			throw new Error(`Another managed ${APP_NAME} update is already running.`);
		}
		throw error;
	}

	let stageDir: string | undefined;
	try {
		const tag = toReleaseTag(version);
		if (readManagedVersionTag(managedInstall.root) === tag) {
			verifyManagedRelease(managedInstall.releaseDir, version);
			return;
		}
		cleanupManagedStaging(managedInstall.root);
		const stagingRoot = join(managedInstall.root, MANAGED_STAGING_DIR);
		mkdirSync(stagingRoot, { recursive: true });
		stageDir = mkdtempSync(join(stagingRoot, "update-"));
		const extractDir = join(stageDir, "extracted");
		mkdirSync(extractDir, { recursive: true });
		const assetName = getManagedReleaseAssetName();
		const archivePath = join(stageDir, assetName);
		await Promise.all([
			downloadManagedReleaseAsset(getGitHubReleaseDownloadUrl(version, assetName), archivePath, "release archive"),
			downloadManagedReleaseAsset(
				getGitHubReleaseDownloadUrl(version, "SHA256SUMS"),
				join(stageDir, "SHA256SUMS"),
				"SHA256SUMS",
			),
		]);
		verifyManagedArchiveChecksum(archivePath, readFileSync(join(stageDir, "SHA256SUMS"), "utf8"), assetName);
		extractManagedReleaseArchive(archivePath, extractDir);
		verifyManagedRelease(extractDir, version);
		replaceManagedReleaseDirectory(managedInstall, extractDir);
		activateManagedRelease(managedInstall, tag);
	} finally {
		if (stageDir) rmSync(stageDir, { force: true, recursive: true });
		await releaseLock();
	}
}

const SELF_UPDATE_NOTE_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text) => chalk.bold(chalk.yellow(text)),
	link: (text) => chalk.cyan(text),
	linkUrl: (text) => chalk.dim(text),
	code: (text) => chalk.yellow(text),
	codeBlock: (text) => chalk.dim(text),
	codeBlockBorder: (text) => chalk.dim(text),
	quote: (text) => chalk.dim(text),
	quoteBorder: (text) => chalk.dim(text),
	hr: (text) => chalk.dim(text),
	listBullet: (text) => chalk.yellow(text),
	bold: (text) => chalk.bold(text),
	italic: (text) => chalk.italic(text),
	strikethrough: (text) => chalk.strikethrough(text),
	underline: (text) => chalk.underline(text),
};

interface PackageCommandOptions {
	command: PackageCommand;
	source?: string;
	updateTarget?: UpdateTarget;
	showExtensionsSkippedNote: boolean;
	local: boolean;
	force: boolean;
	projectTrustOverride?: boolean;
	help: boolean;
	invalidOption?: string;
	invalidArgument?: string;
	missingOptionValue?: string;
	conflictingOptions?: string;
}

function reportSettingsErrors(settingsManager: SettingsManager, context: string): void {
	const errors = settingsManager.drainErrors();
	for (const { scope, error } of errors) {
		console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
		if (error.stack) {
			console.error(chalk.dim(error.stack));
		}
	}
}

function getPackageCommandUsage(command: PackageCommand): string {
	switch (command) {
		case "install":
			return `${APP_NAME} install <source> [-l] [--approve|--no-approve]`;
		case "remove":
			return `${APP_NAME} remove <source> [-l] [--approve|--no-approve]`;
		case "update":
			return `${APP_NAME} update [source|self|${APP_NAME}] [--self|--extensions|--all] [--extension <source>] [--approve|--no-approve] [--force]`;
		case "list":
			return `${APP_NAME} list [--approve|--no-approve]`;
	}
}

function printPackageCommandHelp(command: PackageCommand): void {
	switch (command) {
		case "install":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local       Install project-locally (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
			return;

		case "remove":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.
Alias: ${APP_NAME} uninstall <source> [-l]

Options:
  -l, --local       Remove from project settings (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} remove npm:@foo/bar
  ${APP_NAME} uninstall npm:@foo/bar
`);
			return;

		case "update":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update ${APP_NAME} and installed packages.

Arguments:
  [source]                Package source, or "self"/"${APP_NAME}" for ${APP_NAME}

Options:
  --self                  Update ${APP_NAME} only (default when no target is given)
  --extensions            Update installed packages only
  --all                   Update ${APP_NAME} and installed packages
  --extension <source>    Update one package only
  -a, --approve           Trust project-local files for this command
  -na, --no-approve       Ignore project-local files for this command
  --force                 Reinstall ${APP_NAME} even if the current version is latest

Short forms:
  ${APP_NAME} update                Update ${APP_NAME} only
  ${APP_NAME} update --all          Update ${APP_NAME} and all extensions
  ${APP_NAME} update <source>       Update one package
  ${APP_NAME} update ${APP_NAME}             Update ${APP_NAME} only (self works as alias to ${APP_NAME})
`);
			return;

		case "list":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.

Options:
  -a, --approve      Trust project-local files for this command
  -na, --no-approve  Ignore project-local files for this command
`);
			return;
	}
}

function parsePackageCommand(args: string[]): PackageCommandOptions | undefined {
	const [rawCommand, ...rest] = args;
	let command: PackageCommand | undefined;
	if (rawCommand === "uninstall") {
		command = "remove";
	} else if (rawCommand === "install" || rawCommand === "remove" || rawCommand === "update" || rawCommand === "list") {
		command = rawCommand;
	}
	if (!command) {
		return undefined;
	}

	let local = false;
	let force = false;
	let projectTrustOverride: boolean | undefined;
	let help = false;
	let invalidOption: string | undefined;
	let invalidArgument: string | undefined;
	let missingOptionValue: string | undefined;
	let conflictingOptions: string | undefined;
	let source: string | undefined;
	let selfFlag = false;
	let extensionsFlag = false;
	let allFlag = false;
	let extensionFlagSource: string | undefined;

	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}

		if (arg === "-l" || arg === "--local") {
			if (command === "install" || command === "remove") {
				local = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--self") {
			if (command === "update") {
				selfFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--extensions") {
			if (command === "update") {
				extensionsFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--all") {
			if (command === "update") {
				allFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--approve" || arg === "-a") {
			projectTrustOverride = true;
			continue;
		}

		if (arg === "--no-approve" || arg === "-na") {
			projectTrustOverride = false;
			continue;
		}

		if (arg === "--force") {
			if (command === "update") {
				force = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--extension") {
			if (command !== "update") {
				invalidOption = invalidOption ?? arg;
				continue;
			}

			const value = rest[index + 1];
			if (!value || value.startsWith("-")) {
				missingOptionValue = missingOptionValue ?? arg;
			} else if (extensionFlagSource) {
				conflictingOptions = conflictingOptions ?? "--extension can only be provided once";
				index++;
			} else {
				extensionFlagSource = value;
				index++;
			}
			continue;
		}

		if (arg.startsWith("-")) {
			invalidOption = invalidOption ?? arg;
			continue;
		}

		if (!source) {
			source = arg;
		} else {
			invalidArgument = invalidArgument ?? arg;
		}
	}

	let updateTarget: UpdateTarget | undefined;
	let showExtensionsSkippedNote = false;
	if (command === "update") {
		if (allFlag && (selfFlag || extensionsFlag || extensionFlagSource)) {
			conflictingOptions =
				conflictingOptions ?? "--all cannot be combined with --self, --extensions, or --extension";
		}
		if (allFlag && source) {
			conflictingOptions = conflictingOptions ?? "--all cannot be combined with a positional source";
		}

		if (extensionFlagSource) {
			if (selfFlag || extensionsFlag || allFlag) {
				conflictingOptions =
					conflictingOptions ?? "--extension cannot be combined with --self, --extensions, or --all";
			}
			if (source) {
				conflictingOptions = conflictingOptions ?? "--extension cannot be combined with a positional source";
			}
			updateTarget = { type: "extensions", source: extensionFlagSource };
		} else if (source) {
			const sourceIsSelf = source === "self" || source === "pi" || source === "a-coder-cli";
			if (sourceIsSelf) {
				updateTarget = extensionsFlag ? { type: "all" } : { type: "self" };
			} else {
				if (extensionsFlag || selfFlag || allFlag) {
					conflictingOptions =
						conflictingOptions ??
						"positional update targets cannot be combined with --self, --extensions, or --all";
				}
				updateTarget = { type: "extensions", source };
			}
		} else if (allFlag) {
			updateTarget = { type: "all" };
		} else if (selfFlag && extensionsFlag) {
			updateTarget = { type: "all" };
		} else if (selfFlag) {
			updateTarget = { type: "self" };
		} else if (extensionsFlag) {
			updateTarget = { type: "extensions" };
		} else {
			updateTarget = { type: "self" };
			showExtensionsSkippedNote = true;
		}
	}

	return {
		command,
		source,
		updateTarget,
		showExtensionsSkippedNote,
		local,
		force,
		projectTrustOverride,
		help,
		invalidOption,
		invalidArgument,
		missingOptionValue,
		conflictingOptions,
	};
}

function updateTargetIncludesSelf(target: UpdateTarget): boolean {
	return target.type === "all" || target.type === "self";
}

function updateTargetIncludesExtensions(target: UpdateTarget): boolean {
	return target.type === "all" || target.type === "extensions";
}

function printSelfUpdateUnavailable(
	npmCommand?: string[],
	updatePackageTarget: SelfUpdatePackageTarget = PACKAGE_NAME,
): void {
	console.error(`error: ${APP_NAME} cannot self-update this installation.`);
	console.error(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageTarget));

	const entrypoint = process.argv[1];
	if (entrypoint) {
		console.error("");
		console.error(`Location of a-coder-cli executable: ${entrypoint}`);
	}
}

function printSelfUpdateFallback(command: SelfUpdateCommand): void {
	console.error(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}

function printSelfUpdateNote(note: string): void {
	const trimmedNote = note.trim();
	if (!trimmedNote) {
		return;
	}

	console.log();
	console.log(chalk.bold(chalk.yellow("Update note")));
	try {
		const width = Math.max(20, process.stdout.columns ?? 80);
		const renderedLines = new Markdown(trimmedNote, 0, 0, SELF_UPDATE_NOTE_MARKDOWN_THEME)
			.render(width)
			.map((line) => line.trimEnd());
		console.log(renderedLines.join("\n"));
	} catch {
		console.log(trimmedNote);
	}
	console.log();
}

interface SelfUpdatePlan {
	packageName: string;
	installSpec: string;
	version: string;
	shouldRun: boolean;
	note?: string;
}

async function getSelfUpdatePlan(force: boolean): Promise<SelfUpdatePlan> {
	let latestRelease: Awaited<ReturnType<typeof getLatestPiRelease>>;
	try {
		latestRelease = await getLatestPiRelease(VERSION);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not determine latest ${APP_NAME} version: ${message}`);
	}
	if (!latestRelease) {
		throw new Error(`Could not determine latest ${APP_NAME} version.`);
	}

	const packageName = latestRelease.packageName ?? PACKAGE_NAME;
	const installSpec = `${packageName}@${latestRelease.version}`;
	if (force || packageName !== PACKAGE_NAME || isNewerPackageVersion(latestRelease.version, VERSION)) {
		return {
			packageName,
			installSpec,
			version: latestRelease.version,
			...(latestRelease.note ? { note: latestRelease.note } : {}),
			shouldRun: true,
		};
	}

	console.log(chalk.green(`${APP_NAME} is already up to date (v${VERSION})`));
	return { packageName, installSpec, version: latestRelease.version, shouldRun: false };
}

async function runSelfUpdate(command: SelfUpdateCommand): Promise<void> {
	console.log(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
	for (const step of command.steps ?? [command]) {
		await new Promise<void>((resolve, reject) => {
			const child = spawnProcess(step.command, step.args, {
				stdio: "inherit",
			});
			child.on("error", (error) => {
				reject(error);
			});
			child.on("close", (code, signal) => {
				if (code === 0) {
					resolve();
				} else if (signal) {
					reject(new Error(`${step.display} terminated by signal ${signal}`));
				} else {
					reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
				}
			});
		});
	}
}

function prepareWindowsNpmSelfUpdate(): void {
	if (process.platform !== "win32") {
		return;
	}

	const packageDir = getPackageDir();
	cleanupWindowsSelfUpdateQuarantine(packageDir);
	quarantineWindowsNativeDependencies(packageDir);
}

function parseProjectTrustOverride(args: readonly string[]): boolean | undefined {
	let trustOverride: boolean | undefined;
	for (const arg of args) {
		if (arg === "--approve" || arg === "-a") {
			trustOverride = true;
		} else if (arg === "--no-approve" || arg === "-na") {
			trustOverride = false;
		}
	}
	return trustOverride;
}

export interface PackageCommandRuntimeOptions {
	extensionFactories?: ExtensionFactory[];
}

interface CommandSettingsResult {
	settingsManager: SettingsManager;
	projectTrustWarnings: string[];
}

function getCommandAppMode(): AppMode {
	return process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "print";
}

function reportProjectTrustWarnings(warnings: readonly string[]): void {
	for (const warning of warnings) {
		console.error(chalk.yellow(`Warning: ${warning}`));
	}
}

export async function createCommandSettingsManager(options: {
	cwd: string;
	agentDir: string;
	projectTrustOverride?: boolean;
	useSavedProjectTrustOnly?: boolean;
	extensionFactories?: ExtensionFactory[];
}): Promise<CommandSettingsResult> {
	const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
	const projectTrustWarnings: string[] = [];
	const trustStore = new ProjectTrustStore(options.agentDir);
	if (options.useSavedProjectTrustOnly) {
		const savedProjectTrusted = trustStore.get(options.cwd) === true;
		settingsManager.setProjectTrusted(options.projectTrustOverride ?? savedProjectTrusted);
		return { settingsManager, projectTrustWarnings };
	}

	const appMode = getCommandAppMode();
	const extensionsResult =
		options.projectTrustOverride === undefined && hasTrustRequiringProjectResources(options.cwd)
			? await new DefaultResourceLoader({
					cwd: options.cwd,
					agentDir: options.agentDir,
					settingsManager,
					extensionFactories: options.extensionFactories,
				}).loadProjectTrustExtensions()
			: undefined;
	for (const error of extensionsResult?.errors ?? []) {
		projectTrustWarnings.push(`Failed to load extension "${error.path}": ${error.error}`);
	}

	const projectTrusted = await resolveProjectTrusted({
		cwd: options.cwd,
		trustStore,
		trustOverride: options.projectTrustOverride,
		defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
		extensionsResult,
		projectTrustContext: createProjectTrustContext({
			cwd: options.cwd,
			mode: appMode,
			settingsManager,
			hasUI: appMode === "interactive",
		}),
		onExtensionError: (message) => projectTrustWarnings.push(message),
	});
	settingsManager.setProjectTrusted(projectTrusted);
	return { settingsManager, projectTrustWarnings };
}

export async function handleConfigCommand(
	args: string[],
	runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
	if (args[0] !== "config") {
		return false;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
		cwd,
		agentDir,
		projectTrustOverride: parseProjectTrustOverride(args),
		extensionFactories: runtimeOptions.extensionFactories,
	});
	reportProjectTrustWarnings(projectTrustWarnings);
	reportSettingsErrors(settingsManager, "config command");
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
	const resolvedPaths = await packageManager.resolve();

	await selectConfig({
		resolvedPaths,
		settingsManager,
		cwd,
		agentDir,
	});

	process.exit(0);
}

export async function handlePackageCommand(
	args: string[],
	runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
	const options = parsePackageCommand(args);
	if (!options) {
		return false;
	}

	if (options.help) {
		printPackageCommandHelp(options.command);
		return true;
	}

	if (options.invalidOption) {
		console.error(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
		console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`));
		process.exitCode = 1;
		return true;
	}

	if (options.missingOptionValue) {
		console.error(chalk.red(`Missing value for ${options.missingOptionValue}.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	if (options.invalidArgument) {
		console.error(chalk.red(`Unexpected argument ${options.invalidArgument}.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	if (options.conflictingOptions) {
		console.error(chalk.red(options.conflictingOptions));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	const source = options.source;
	if ((options.command === "install" || options.command === "remove") && !source) {
		console.error(chalk.red(`Missing ${options.command} source.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const writesProjectPackageConfig = (options.command === "install" || options.command === "remove") && options.local;
	const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
		cwd,
		agentDir,
		projectTrustOverride: options.projectTrustOverride,
		useSavedProjectTrustOnly: options.command === "update",
		extensionFactories: runtimeOptions.extensionFactories,
	});
	reportProjectTrustWarnings(projectTrustWarnings);
	if (!settingsManager.isProjectTrusted() && writesProjectPackageConfig) {
		console.error(chalk.red("Project is not trusted. Use --approve to modify local package config."));
		process.exitCode = 1;
		return true;
	}
	reportSettingsErrors(settingsManager, "package command");
	const selfUpdateNpmCommand = settingsManager.getGlobalSettings().npmCommand;

	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	packageManager.setProgressCallback((event) => {
		if (event.type === "start") {
			process.stdout.write(chalk.dim(`${event.message}\n`));
		}
	});

	try {
		switch (options.command) {
			case "install":
				await packageManager.installAndPersist(source!, { local: options.local });
				console.log(chalk.green(`Installed ${source}`));
				return true;

			case "remove": {
				const removed = await packageManager.removeAndPersist(source!, { local: options.local });
				if (!removed) {
					console.error(chalk.red(`No matching package found for ${source}`));
					process.exitCode = 1;
					return true;
				}
				console.log(chalk.green(`Removed ${source}`));
				return true;
			}

			case "list": {
				const configuredPackages = packageManager.listConfiguredPackages();
				const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
				const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");

				if (configuredPackages.length === 0) {
					console.log(chalk.dim("No packages installed."));
					return true;
				}

				const formatPackage = (pkg: (typeof configuredPackages)[number]) => {
					const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
					console.log(`  ${display}`);
					if (pkg.installedPath) {
						console.log(chalk.dim(`    ${pkg.installedPath}`));
					}
				};

				if (userPackages.length > 0) {
					console.log(chalk.bold("User packages:"));
					for (const pkg of userPackages) {
						formatPackage(pkg);
					}
				}

				if (projectPackages.length > 0) {
					if (userPackages.length > 0) console.log();
					console.log(chalk.bold("Project packages:"));
					for (const pkg of projectPackages) {
						formatPackage(pkg);
					}
				}

				return true;
			}

			case "update": {
				const target = options.updateTarget ?? { type: "self" };
				if (options.showExtensionsSkippedNote) {
					console.log(
						chalk.dim(`Extensions are skipped. Run ${APP_NAME} update --extensions to update extensions.`),
					);
				}
				if (updateTargetIncludesExtensions(target)) {
					const updateSource = target.type === "extensions" ? target.source : undefined;
					await packageManager.update(updateSource);
					if (updateSource) {
						console.log(chalk.green(`Updated ${updateSource}`));
					} else {
						console.log(chalk.green("Updated packages"));
					}
				}
				if (updateTargetIncludesSelf(target)) {
					const managedInstall = process.platform === "win32" ? undefined : getActiveManagedInstallRoot();
					if (managedInstall && options.force) {
						console.error(
							chalk.red(
								`Managed ${APP_NAME} installations do not support --force; rerun the installer to repair this installation.`,
							),
						);
						process.exitCode = 1;
						return true;
					}
					const selfUpdatePlan = await getSelfUpdatePlan(options.force);
					if (!selfUpdatePlan.shouldRun) {
						return true;
					}
					if (managedInstall) {
						if (selfUpdatePlan.note) {
							printSelfUpdateNote(selfUpdatePlan.note);
						}
						try {
							console.log(chalk.dim(`Updating managed ${APP_NAME} installation...`));
							await runManagedSelfUpdate(managedInstall, selfUpdatePlan.version);
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : "Unknown managed update error";
							console.error(chalk.red(`Error: ${message}`));
							process.exitCode = 1;
							return true;
						}
						console.log(chalk.green(`Updated ${APP_NAME} from ${VERSION} to ${selfUpdatePlan.version}`));
						console.log(chalk.dim(`Restart ${APP_NAME} to use the new version.`));
						return true;
					}
					const installMethod = detectInstallMethod();
					// The ~/.a-coder/cli install layout (bun-compiled binary) is not managed by an
					// npm/pnpm/yarn/bun global package manager, so the in-process self-update
					// cannot run `npm install -g`. Run the one-shot installer in place
					// instead (curl install scripts are the source of truth for CLI updates).
					if (installMethod === "bun-binary" || installMethod === "unknown") {
						const result = await runInstallerSelfUpdate(selfUpdatePlan.version);
						if (!result.ok) {
							console.error(chalk.red(`${APP_NAME} update failed${result.error ? `: ${result.error}` : ""}.`));
							process.exitCode = 1;
						} else {
							console.log(chalk.green(`Updated ${APP_NAME} from ${VERSION} to ${selfUpdatePlan.version}.`));
							console.log(chalk.dim(`Restart ${APP_NAME} to use the new version.`));
						}
						return true;
					}
					if (process.platform === "win32" && installMethod !== "npm" && installMethod !== "pnpm") {
						console.error(
							chalk.red(`${APP_NAME} self-update on Windows is only supported for npm and pnpm installs.`),
						);
						console.error(chalk.dim(`Detected install method: ${installMethod}. Update ${APP_NAME} manually.`));
						process.exitCode = 1;
						return true;
					}
					const selfUpdateTarget = {
						packageName: selfUpdatePlan.packageName,
						installSpec: selfUpdatePlan.installSpec,
					};
					const selfUpdateCommand = getSelfUpdateCommand(PACKAGE_NAME, selfUpdateNpmCommand, selfUpdateTarget);
					if (!selfUpdateCommand) {
						printSelfUpdateUnavailable(selfUpdateNpmCommand, selfUpdateTarget);
						process.exitCode = 1;
						return true;
					}
					if (selfUpdatePlan.note) {
						printSelfUpdateNote(selfUpdatePlan.note);
					}
					try {
						if (installMethod === "npm") {
							prepareWindowsNpmSelfUpdate();
						}
						await runSelfUpdate(selfUpdateCommand);
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : "Unknown package command error";
						console.error(chalk.red(`Error: ${message}`));
						printSelfUpdateFallback(selfUpdateCommand);
						process.exitCode = 1;
						return true;
					}
					console.log(chalk.green(`Updated ${APP_NAME} from ${VERSION} to ${selfUpdatePlan.version}`));
				}
				return true;
			}
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown package command error";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
}

// ============================================================================
// Machine-readable resources subcommand for the desktop settings UI.
// Outputs JSON on stdout; diagnostics go to stderr so stdout stays parseable.
// ============================================================================

export type ResourcesCommand = "resolve" | "install" | "remove" | "update" | "list" | "toggle";

type ResourcesResourceType = "extensions" | "skills" | "prompts" | "themes";

interface ResourcesCommandOptions {
	command: ResourcesCommand;
	cwd: string;
	json: boolean;
	local?: boolean;
	source?: string;
	resourceType?: ResourcesResourceType;
	path?: string;
	enabled?: boolean;
	scope?: "user" | "project";
	origin?: "top-level" | "package";
	baseDir?: string;
}

function parseResourcesCommand(args: string[]): ResourcesCommandOptions | undefined {
	if (args.length === 0 || args[0] !== "resources") {
		return undefined;
	}

	const rest = args.slice(1);
	let command: ResourcesCommand | undefined;
	let cwd = process.cwd();
	let json = false;
	let local = false;
	let source: string | undefined;
	let resourceType: ResourcesResourceType | undefined;
	let path: string | undefined;
	let enabled: boolean | undefined;
	let scope: "user" | "project" | undefined;
	let origin: "top-level" | "package" | undefined;
	let baseDir: string | undefined;

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		switch (arg) {
			case "resolve":
			case "install":
			case "remove":
			case "update":
			case "list":
			case "toggle":
				command = arg;
				break;
			case "--cwd":
				cwd = rest[++i] ?? cwd;
				break;
			case "--json":
				json = true;
				break;
			case "-l":
			case "--local":
				local = true;
				break;
			case "--source":
				source = rest[++i];
				break;
			case "--type":
				resourceType = rest[++i] as ResourcesResourceType;
				break;
			case "--path":
				path = rest[++i];
				break;
			case "--enabled": {
				const v = rest[++i];
				enabled = v === "true" || v === "1";
				break;
			}
			case "--scope": {
				const v = rest[++i];
				if (v === "user" || v === "project") scope = v;
				break;
			}
			case "--origin": {
				const v = rest[++i];
				if (v === "top-level" || v === "package") origin = v;
				break;
			}
			case "--baseDir":
				baseDir = rest[++i];
				break;
		}
	}

	if (!command) return undefined;
	return { command, cwd, json, local, source, resourceType, path, enabled, scope, origin, baseDir };
}

function resourcesJsonResponse(data: unknown): string {
	return JSON.stringify({ success: true, data }, null, 2);
}

function resourcesJsonError(message: string): string {
	return JSON.stringify({ success: false, error: message }, null, 2);
}

function getResourcesTopLevelBaseDir(scope: "user" | "project", cwd: string, agentDir: string): string {
	return scope === "project" ? join(cwd, CONFIG_DIR_NAME) : agentDir;
}

function toggleTopLevelResource(
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
	resourceType: ResourcesResourceType,
	path: string,
	enabled: boolean,
	scope: "user" | "project",
	baseDirHint?: string,
): void {
	const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
	const current = (settings[resourceType] ?? []) as string[];
	const baseDir = baseDirHint ?? getResourcesTopLevelBaseDir(scope, cwd, agentDir);
	const pattern = relative(baseDir, path);
	const updated = current.filter((p) => {
		const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
		return stripped !== pattern;
	});
	updated.push(enabled ? `+${pattern}` : `-${pattern}`);

	if (scope === "project") {
		if (resourceType === "extensions") settingsManager.setProjectExtensionPaths(updated);
		else if (resourceType === "skills") settingsManager.setProjectSkillPaths(updated);
		else if (resourceType === "prompts") settingsManager.setProjectPromptTemplatePaths(updated);
		else if (resourceType === "themes") settingsManager.setProjectThemePaths(updated);
	} else {
		if (resourceType === "extensions") settingsManager.setExtensionPaths(updated);
		else if (resourceType === "skills") settingsManager.setSkillPaths(updated);
		else if (resourceType === "prompts") settingsManager.setPromptTemplatePaths(updated);
		else if (resourceType === "themes") settingsManager.setThemePaths(updated);
	}
}

function togglePackageResource(
	settingsManager: SettingsManager,
	resourceType: ResourcesResourceType,
	path: string,
	enabled: boolean,
	packageSource: string,
	baseDirHint?: string,
): void {
	const globalPackages = settingsManager.getGlobalSettings().packages ?? [];
	const projectPackages = settingsManager.getProjectSettings().packages ?? [];
	let scope: "user" | "project" | null = null;
	let packages: PackageSource[] = [...globalPackages];
	if (projectPackages.some((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === packageSource)) {
		scope = "project";
		packages = [...projectPackages];
	} else if (globalPackages.some((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === packageSource)) {
		scope = "user";
	} else {
		throw new Error(`Package source not found in settings: ${packageSource}`);
	}

	const idx = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === packageSource);
	if (idx === -1) throw new Error(`Package source not found: ${packageSource}`);

	let pkg = packages[idx];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		packages[idx] = pkg;
	}
	const current = ((pkg as Record<string, unknown>)[resourceType] as string[] | undefined) ?? [];
	const baseDir = baseDirHint ?? dirname(path);
	const pattern = relative(baseDir, path);
	const updated = current.filter((p) => {
		const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
		return stripped !== pattern;
	});
	updated.push(enabled ? `+${pattern}` : `-${pattern}`);

	const hasFilters = (["extensions", "skills", "prompts", "themes"] as const).some(
		(k) => (pkg as Record<string, unknown>)[k] !== undefined,
	);
	if (!hasFilters) {
		packages[idx] = (pkg as { source: string }).source;
	} else {
		(pkg as Record<string, unknown>)[resourceType] = updated.length > 0 ? updated : undefined;
	}

	if (scope === "project") {
		settingsManager.setProjectPackages(packages);
	} else {
		settingsManager.setPackages(packages);
	}
}

export async function handleResourcesCommand(
	args: string[],
	runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
	const options = parseResourcesCommand(args);
	if (!options) return false;

	const trustOverride = parseProjectTrustOverride(args);
	const agentDir = getAgentDir();
	const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
		cwd: options.cwd,
		agentDir,
		projectTrustOverride: trustOverride,
		useSavedProjectTrustOnly: true,
		extensionFactories: runtimeOptions.extensionFactories,
	});
	reportProjectTrustWarnings(projectTrustWarnings);
	reportSettingsErrors(settingsManager, "resources command");

	const packageManager = new DefaultPackageManager({ cwd: options.cwd, agentDir, settingsManager });

	try {
		switch (options.command) {
			case "resolve": {
				const resolved = await packageManager.resolve();
				if (options.json) {
					console.log(resourcesJsonResponse(resolved));
				}
				return true;
			}
			case "list": {
				const packages = packageManager.listConfiguredPackages();
				if (options.json) {
					console.log(resourcesJsonResponse(packages));
				}
				return true;
			}
			case "install": {
				if (!options.source) {
					console.log(resourcesJsonError("Missing --source"));
					process.exitCode = 1;
					return true;
				}
				await packageManager.installAndPersist(options.source, { local: options.local });
				console.log(resourcesJsonResponse({ installed: options.source, local: options.local ?? false }));
				return true;
			}
			case "remove": {
				if (!options.source) {
					console.log(resourcesJsonError("Missing --source"));
					process.exitCode = 1;
					return true;
				}
				const removed = await packageManager.removeAndPersist(options.source, { local: options.local });
				console.log(
					resourcesJsonResponse({ removed: removed, source: options.source, local: options.local ?? false }),
				);
				return true;
			}
			case "update": {
				await packageManager.update(options.source);
				console.log(resourcesJsonResponse({ updated: options.source ?? "all" }));
				return true;
			}
			case "toggle": {
				if (
					!options.resourceType ||
					!options.path ||
					options.enabled === undefined ||
					!options.scope ||
					!options.origin
				) {
					console.log(resourcesJsonError("toggle requires --type, --path, --enabled, --scope, and --origin"));
					process.exitCode = 1;
					return true;
				}
				if (options.origin === "top-level") {
					toggleTopLevelResource(
						settingsManager,
						options.cwd,
						agentDir,
						options.resourceType,
						options.path,
						options.enabled,
						options.scope,
						options.baseDir,
					);
				} else {
					if (!options.source) {
						console.log(resourcesJsonError("toggle package resource requires --source"));
						process.exitCode = 1;
						return true;
					}
					togglePackageResource(
						settingsManager,
						options.resourceType,
						options.path,
						options.enabled,
						options.source,
						options.baseDir,
					);
				}
				await settingsManager.flush();
				console.log(resourcesJsonResponse({ toggled: true }));
				return true;
			}
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.log(resourcesJsonError(message));
		process.exitCode = 1;
		return true;
	}
}
