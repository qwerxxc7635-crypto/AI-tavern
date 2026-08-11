import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePaths = [
  'package.json',
  'ios-app/package.json',
  'windows-app/package.json',
  'packages/ai-core/package.json',
  'packages/application/package.json',
  'packages/contracts/package.json',
  'packages/domain/package.json',
  'packages/persistence/package.json',
  'packages/prompts/package.json',
  'packages/test-fixtures/package.json',
  'packages/ui-kit/package.json',
];
const cargoMemberPaths = [
  'crates/native-bridge/Cargo.toml',
  'crates/platform-services/Cargo.toml',
  'crates/provider-openai-compatible/Cargo.toml',
  'crates/secure-http/Cargo.toml',
  'crates/secure-secrets/Cargo.toml',
  'windows-app/src-tauri/Cargo.toml',
];
const cargoMemberNames = [
  'ember-native-bridge',
  'ember-platform-services',
  'ember-provider-openai-compatible',
  'ember-secure-http',
  'ember-secure-secrets',
  'ember-tavern-windows',
];

export function expectedReleaseInfo(version, highlights = []) {
  requireVersion(version);
  return {
    schemaVersion: 1,
    version,
    channel: 'development',
    status: 'unreleased',
    changelogPath: 'CHANGELOG.md',
    changelogHeading: `[${version}] - 未发布`,
    highlights,
  };
}

export function releaseStateErrors(state) {
  const errors = [];
  const version = state.sourceVersion;
  try {
    requireVersion(version);
  } catch (error) {
    return [error instanceof Error ? error.message : 'Root version is invalid'];
  }
  for (const [path, actual] of Object.entries(state.packageVersions)) {
    if (actual !== version) errors.push(`${path} version ${actual} differs from ${version}`);
  }
  if (state.tauriVersion !== version) errors.push(`Tauri version differs from ${version}`);
  if (state.cargoWorkspaceVersion !== version)
    errors.push(`Cargo workspace version differs from ${version}`);
  for (const [path, inherits] of Object.entries(state.cargoMembersInherit)) {
    if (!inherits) errors.push(`${path} must use version.workspace = true`);
  }
  for (const [name, actual] of Object.entries(state.cargoLockVersions)) {
    if (actual !== version)
      errors.push(`Cargo.lock ${name} version ${actual} differs from ${version}`);
  }
  const expected = expectedReleaseInfo(version, currentReleaseHighlights(state.changelog, version));
  if (JSON.stringify(state.releaseInfo) !== JSON.stringify(expected)) {
    errors.push('release-info.json is not synchronized');
  }
  if (state.generatedReleaseInfo !== renderGeneratedReleaseInfo(expected)) {
    errors.push('generated release info is not synchronized');
  }
  if (!state.changelog.includes(`## [${version}] - 未发布`)) {
    errors.push(`CHANGELOG.md has no current ${version} 未发布 heading`);
  }
  return errors;
}

export async function checkReleaseVersion() {
  const state = await readReleaseState();
  const errors = releaseStateErrors(state);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return state.sourceVersion;
}

export async function syncReleaseVersion() {
  const source = await readJson('package.json');
  const version = source.version;
  requireVersion(version);
  for (const path of packagePaths.slice(1)) {
    const value = await readJson(path);
    await writeJson(path, { ...value, version });
  }
  const tauri = await readJson('windows-app/src-tauri/tauri.conf.json');
  await writeJson('windows-app/src-tauri/tauri.conf.json', { ...tauri, version });

  const cargoRoot = await readText('Cargo.toml');
  await writeText(
    'Cargo.toml',
    cargoRoot.replace(/(\[workspace\.package\]\s*\nversion\s*=\s*")[^"]+("\s*)/u, `$1${version}$2`),
  );
  for (const path of cargoMemberPaths) {
    const manifest = await readText(path);
    const synchronized = manifest.replace(
      /^version(?:\.workspace)?\s*=.*$/mu,
      'version.workspace = true',
    );
    await writeText(path, synchronized);
  }

  const changelog = await readText('CHANGELOG.md');
  const synchronizedChangelog = changelog.replace(
    /(<!-- current-release:start -->\s*\n)## \[[^\]]+\] - 未发布/u,
    `$1## [${version}] - 未发布`,
  );
  if (synchronizedChangelog === changelog && !changelog.includes(`## [${version}] - 未发布`)) {
    throw new Error('CHANGELOG.md current release marker is missing');
  }
  await writeText('CHANGELOG.md', synchronizedChangelog);
  const releaseInfo = expectedReleaseInfo(
    version,
    currentReleaseHighlights(synchronizedChangelog, version),
  );
  await writeJson('release-info.json', releaseInfo);
  await writeText(
    'windows-app/src/generated-release-info.ts',
    renderGeneratedReleaseInfo(releaseInfo),
  );
  execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: root,
    stdio: 'ignore',
  });
  await checkReleaseVersion();
  return version;
}

async function readReleaseState() {
  const packages = await Promise.all(
    packagePaths.map(async (path) => [path, await readJson(path)]),
  );
  const rootPackage = packages[0]?.[1];
  const packageVersions = Object.fromEntries(
    packages.map(([path, value]) => [path, typeof value.version === 'string' ? value.version : '']),
  );
  const cargoRoot = await readText('Cargo.toml');
  const workspaceMatch = cargoRoot.match(/\[workspace\.package\]\s*\nversion\s*=\s*"([^"]+)"/u);
  const cargoMembers = await Promise.all(
    cargoMemberPaths.map(async (path) => [path, await readText(path)]),
  );
  const cargoLock = await readText('Cargo.lock');
  return {
    sourceVersion: typeof rootPackage?.version === 'string' ? rootPackage.version : '',
    packageVersions,
    tauriVersion: (await readJson('windows-app/src-tauri/tauri.conf.json')).version,
    cargoWorkspaceVersion: workspaceMatch?.[1] ?? '',
    cargoMembersInherit: Object.fromEntries(
      cargoMembers.map(([path, text]) => [path, /^version\.workspace\s*=\s*true$/mu.test(text)]),
    ),
    cargoLockVersions: Object.fromEntries(
      cargoMemberNames.map((name) => [name, cargoLockVersion(cargoLock, name)]),
    ),
    releaseInfo: await readJson('release-info.json'),
    generatedReleaseInfo: await readText('windows-app/src/generated-release-info.ts'),
    changelog: await readText('CHANGELOG.md'),
  };
}

export function currentReleaseHighlights(changelog, version) {
  requireVersion(version);
  const heading = `## [${version}] - 未发布`;
  const start = changelog.indexOf(heading);
  if (start < 0) return [];
  const afterHeading = changelog.slice(start + heading.length);
  const nextRelease = afterHeading.search(/^## /mu);
  const section = nextRelease < 0 ? afterHeading : afterHeading.slice(0, nextRelease);
  return [...section.matchAll(/^- (.+)$/gmu)].map((match) => match[1]);
}

export function renderGeneratedReleaseInfo(info) {
  const quote = (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return `// Generated by scripts/sync-release-info.mjs. Do not edit by hand.\nexport const RELEASE_INFO = Object.freeze({\n  schemaVersion: ${info.schemaVersion},\n  version: ${quote(info.version)},\n  channel: ${quote(info.channel)},\n  status: ${quote(info.status)},\n  changelogPath: ${quote(info.changelogPath)},\n  changelogHeading: ${quote(info.changelogHeading)},\n  highlights: Object.freeze([\n${info.highlights.map((item) => `    ${quote(item)},`).join('\n')}\n  ]),\n});\n`;
}

function cargoLockVersion(lock, name) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return lock.match(new RegExp(`name = "${escaped}"\\nversion = "([^"]+)"`, 'u'))?.[1] ?? '';
}

function requireVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error('Root package version must be a semantic version');
  }
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

async function writeJson(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const filepath = resolve(root, path);
  const config = (await resolveConfig(filepath)) ?? {};
  await writeText(path, await format(serialized, { ...config, filepath, parser: 'json' }));
}

async function readText(path) {
  return readFile(resolve(root, path), 'utf8');
}

async function writeText(path, value) {
  await writeFile(resolve(root, path), value, 'utf8');
}
