#!/usr/bin/env node

/**
 * Syncs all workspace package dependency versions to match their current versions.
 * This ensures lockstep versioning across the monorepo.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const packagesDir = join(process.cwd(), 'packages');

// Preserve the indentation a file already uses so a version bump does not
// produce a whole-file whitespace diff.
function serializeJson(data, previousContent) {
	const indent = previousContent.startsWith('{\n\t')
		? '\t'
		: (previousContent.match(/^\{\n( +)"/)?.[1] ?? '\t');
	return JSON.stringify(data, null, indent) + '\n';
}

const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
	.filter(dirent => dirent.isDirectory())
	.map(dirent => dirent.name);

// Read all package.json files and build version map
const packages = {};
const versionMap = {};

for (const dir of packageDirs) {
	const pkgPath = join(packagesDir, dir, 'package.json');
	try {
		const raw = readFileSync(pkgPath, 'utf8');
		const pkg = JSON.parse(raw);
		packages[dir] = { path: pkgPath, data: pkg, raw };
		versionMap[pkg.name] = pkg.version;
	} catch (e) {
		console.error(`Failed to read ${pkgPath}:`, e.message);
	}
}

console.log('Current versions:');
for (const [name, version] of Object.entries(versionMap).sort()) {
	console.log(`  ${name}: ${version}`);
}

// Verify all versions are the same (lockstep)
const versions = new Set(Object.values(versionMap));
if (versions.size > 1) {
	console.error('\n❌ ERROR: Not all packages have the same version!');
	console.error('Expected lockstep versioning. Run one of:');
	console.error('  npm run version:patch');
	console.error('  npm run version:minor');
	console.error('  npm run version:major');
	process.exit(1);
}

console.log('\n✅ All packages at same version (lockstep)');

// Update all inter-package dependencies
let totalUpdates = 0;
for (const [dir, pkg] of Object.entries(packages)) {
	let updated = false;
	
	// Check dependencies
	if (pkg.data.dependencies) {
		for (const [depName, currentVersion] of Object.entries(pkg.data.dependencies)) {
			if (versionMap[depName]) {
				const newVersion = versionMap[depName];
				if (currentVersion !== newVersion) {
					console.log(`\n${pkg.data.name}:`);
					console.log(`  ${depName}: ${currentVersion} → ${newVersion}`);
					pkg.data.dependencies[depName] = newVersion;
					updated = true;
					totalUpdates++;
				}
			}
		}
	}
	
	// Check devDependencies
	if (pkg.data.devDependencies) {
		for (const [depName, currentVersion] of Object.entries(pkg.data.devDependencies)) {
			if (versionMap[depName]) {
				const newVersion = versionMap[depName];
				if (currentVersion !== newVersion) {
					console.log(`\n${pkg.data.name}:`);
					console.log(`  ${depName}: ${currentVersion} → ${newVersion} (devDependencies)`);
					pkg.data.devDependencies[depName] = newVersion;
					updated = true;
					totalUpdates++;
				}
			}
		}
	}
	
	// Write if updated
	if (updated) {
		writeFileSync(pkg.path, serializeJson(pkg.data, pkg.raw));
	}
}

if (totalUpdates === 0) {
	console.log('\nAll inter-package dependencies already in sync.');
} else {
	console.log(`\n✅ Updated ${totalUpdates} dependency version(s)`);
}

// Sync workspace versions: root, desktop app, and its Tauri/Cargo manifests.
const lockstepVersion = Object.values(versionMap)[0];
let workspaceUpdates = 0;

// The root is a private, unpublished workspace, but keeping its version in
// lockstep stops it drifting (it was pinned at 0.80.122 while every package
// had moved on).
const rootPkgPath = join(process.cwd(), 'package.json');
const rootPkgRaw = readFileSync(rootPkgPath, 'utf8');
const rootPkg = JSON.parse(rootPkgRaw);
if (rootPkg.version !== lockstepVersion) {
	console.log(`\npackage.json:`);
	console.log(`  version: ${rootPkg.version} → ${lockstepVersion}`);
	rootPkg.version = lockstepVersion;
	writeFileSync(rootPkgPath, serializeJson(rootPkg, rootPkgRaw));
	workspaceUpdates++;
}

const desktopPkgPath = join(process.cwd(), 'desktop-app', 'package.json');
try {
	const desktopPkgRaw = readFileSync(desktopPkgPath, 'utf8');
	const desktopPkg = JSON.parse(desktopPkgRaw);
	if (desktopPkg.version !== lockstepVersion) {
		console.log(`\ndesktop-app/package.json:`);
		console.log(`  version: ${desktopPkg.version} → ${lockstepVersion}`);
		desktopPkg.version = lockstepVersion;
		writeFileSync(desktopPkgPath, serializeJson(desktopPkg, desktopPkgRaw));
		workspaceUpdates++;
	}
} catch {}

const tauriConfPath = join(process.cwd(), 'desktop-app', 'src-tauri', 'tauri.conf.json');
try {
	const tauriConfRaw = readFileSync(tauriConfPath, 'utf8');
	const tauriConf = JSON.parse(tauriConfRaw);
	if (tauriConf.version !== lockstepVersion) {
		console.log(`\ndesktop-app/src-tauri/tauri.conf.json:`);
		console.log(`  version: ${tauriConf.version} → ${lockstepVersion}`);
		tauriConf.version = lockstepVersion;
		writeFileSync(tauriConfPath, serializeJson(tauriConf, tauriConfRaw));
		workspaceUpdates++;
	}
} catch {}

const cargoTomlPath = join(process.cwd(), 'desktop-app', 'src-tauri', 'Cargo.toml');
try {
	const cargoContent = readFileSync(cargoTomlPath, 'utf8');
	// Match the [package] section (up to the next table header) so `version` is
	// found regardless of field ordering (e.g. `name` before `version`).
	const packageSection = cargoContent.match(/\[package\][^\[]*/)?.[0];
	if (!packageSection || !/^version\s*=/m.test(packageSection)) {
		console.error('\n❌ ERROR: Could not find a `version` field in the [package] section of desktop-app/src-tauri/Cargo.toml');
		process.exit(1);
	}
	const updatedSection = packageSection.replace(
		/(^version\s*=\s*)"[^"]*"/m,
		`$1"${lockstepVersion}"`
	);
	if (updatedSection !== packageSection) {
		const oldVersion = packageSection.match(/^version\s*=\s*"([^"]*)"/m)?.[1];
		console.log(`\ndesktop-app/src-tauri/Cargo.toml:`);
		console.log(`  version: ${oldVersion} → ${lockstepVersion}`);
		writeFileSync(cargoTomlPath, cargoContent.replace(packageSection, updatedSection));
		workspaceUpdates++;
	}
} catch {}

if (workspaceUpdates === 0) {
	console.log('\nWorkspace versions already in sync.');
} else {
	console.log(`\n✅ Updated ${workspaceUpdates} workspace file(s)`);
}
