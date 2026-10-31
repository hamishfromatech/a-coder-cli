// Enforces exact-pinned external dependencies across every package.json in the
// repo, and verifies each exact pin resolves to that version in the owning
// package-lock.json so a stale refresh cannot drift resolution outside pins.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
const exactVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ignoredDirectories = new Set([".git", "dist", "node_modules", "target", "install-lock"]);
const internalWorkspacePrefixes = ["@earendil-works/pi-", "@earendil-works/chord"];
const packageJsonFiles = [];
const failures = [];

collectPackageJsonFiles(".");
resolvePinsAgainstLockfiles();

if (failures.length > 0) {
	console.error(`${failures.length} dependency pin failure(s):`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}

console.log(`checked ${packageJsonFiles.length} package.json files: pins exact and resolved as pinned`);

function collectPackageJsonFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name)) {
				collectPackageJsonFiles(join(directory, entry.name));
			}
			continue;
		}

		if (entry.isFile() && entry.name === "package.json") {
			packageJsonFiles.push(join(directory, entry.name));
		}
	}
}

function isInternalWorkspaceDependency(name) {
	return internalWorkspacePrefixes.some((prefix) => name.startsWith(prefix));
}

function isNonRegistrySpecifier(specifier) {
	return /^(?:workspace:|file:|link:|portal:|git\+|github:|git:|https?:|ssh:|git:\/\/)/.test(specifier);
}

function getVersionSpecifier(specifier) {
	if (!specifier.startsWith("npm:")) return specifier;
	const aliasTarget = specifier.slice("npm:".length);
	const versionSeparator = aliasTarget.lastIndexOf("@");
	if (versionSeparator <= 0) return specifier;
	return aliasTarget.slice(versionSeparator + 1);
}

function checkOverrides(file, overrides) {
	const pathPrefix = `${file}: overrides.`;
	checkOverrideEntries(pathPrefix, overrides);
}

function checkOverrideEntries(pathPrefix, entries) {
	for (const [name, value] of Object.entries(entries ?? {})) {
		if (typeof value === "object" && value !== null) {
			checkOverrideEntries(`${pathPrefix}${name}.`, value);
		} else if (!exactVersionPattern.test(value) && !isNonRegistrySpecifier(value)) {
			failures.push(`${pathPrefix}${name} must be an exact version or a non-registry specifier, found ${value}`);
		}
	}
}

// Which lockfile owns a package.json: nearest ancestor package-lock.json whose
// project root (its directory or declared workspaces) actually covers the
// package. Shipped examples with no surrounding npm project have no lockfile
// and are skipped, since users resolve them on their own machines.
function owningLockfile(directory) {
	let current = directory === "." ? "" : directory;
	while (true) {
		const lockfilePath = current ? join(current, "package-lock.json") : "package-lock.json";
		try {
			const lock = JSON.parse(readFileSync(lockfilePath, "utf8"));
			if (lockCoversDirectory(lock, current, directory)) {
				return { dir: current || ".", lock };
			}
		} catch {
			// No lockfile (or unreadable) at this level; keep climbing.
		}
		const parent = current ? current.split("/").slice(0, -1).join("/") : "";
		if (parent === current) return undefined;
		current = parent;
	}
}

function lockCoversDirectory(lock, lockDir, directory) {
	const relative = !lockDir ? directory : directory.startsWith(`${lockDir}/`) ? directory.slice(lockDir.length + 1) : undefined;
	if (relative === undefined) return false;
	if (relative === "") return true;
	const workspaces = workspaceRoots(lockDir);
	return workspaces.some((workspace) => relative === workspace || relative.startsWith(`${workspace}/`));
}

function workspaceRoots(lockDir) {
	const roots = [];
	for (const workspace of readWorkspaceGlobs(lockDir)) {
		if (workspace.endsWith("*")) {
			const base = workspace.slice(0, -2);
			try {
				for (const entry of readdirSync(lockDir ? join(lockDir, base) : base, { withFileTypes: true })) {
					if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) roots.push(`${base}${entry.name}`);
				}
			} catch {
				// Unreadable glob base; fall back to literal matching only.
			}
		} else {
			roots.push(workspace);
		}
	}
	return roots;
}

function readWorkspaceGlobs(lockDir) {
	try {
		const packageJson = JSON.parse(readFileSync(join(lockDir, "package.json"), "utf8"));
		return Array.isArray(packageJson.workspaces) ? packageJson.workspaces : (packageJson.workspaces?.packages ?? []);
	} catch {
		return [];
	}
}

// Mirrors npm's resolution: walk up from the requiring package's directory
// looking for node_modules/<name>, then fall back to the closest hoisted copy.
function resolveInLock(lock, packageName, fromDir) {
	const directories = [];
	let current = fromDir ? fromDir.split("/") : [];
	while (true) {
		directories.push(current.join("/"));
		if (current.length === 0) break;
		current = current.slice(0, -1);
	}

	const tried = new Set();
	for (const directory of directories) {
		const candidate = directory ? `${directory}/node_modules/${packageName}` : `node_modules/${packageName}`;
		if (tried.has(candidate)) continue;
		tried.add(candidate);
		const entry = lock.packages[candidate];
		if (entry && !entry.link) return entry;
	}

	const suffix = `node_modules/${packageName}`;
	const matches = Object.entries(lock.packages)
		.filter(([lockPath, entry]) => !entry.link && (lockPath === suffix || lockPath.endsWith(`/${suffix}`)))
		.map((([lockPath]) => lockPath));
	if (matches.length !== 1) return undefined;
	return lock.packages[matches[0]];
}

function resolvePinsAgainstLockfiles() {
	for (const file of packageJsonFiles.sort()) {
		const directory = file.slice(0, "package.json".length * -1 - 1) || ".";
		const owned = owningLockfile(directory);
		if (!owned) continue;

		const packageJson = JSON.parse(readFileSync(file, "utf8"));
		checkOverrides(file, packageJson.overrides);

		for (const section of dependencySections) {
			for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
				if (isInternalWorkspaceDependency(name) || isNonRegistrySpecifier(specifier)) continue;
				const pinned = getVersionSpecifier(specifier);
				if (!exactVersionPattern.test(pinned)) continue;

				const fromDir = directory === "." ? "" : directory.slice(owned.dir === "." ? 0 : owned.dir.length + 1);
				const entry = resolveInLock(owned.lock, name, fromDir);
				if (!entry) {
					failures.push(`${file}: ${section}.${name} pinned to ${pinned} has no ${owned.dir}/package-lock.json resolution`);
				} else if (entry.version !== pinned) {
					failures.push(`${file}: ${section}.${name} pinned to ${pinned} resolves to ${entry.version} in ${owned.dir}/package-lock.json`);
				}
			}
		}
	}
}