import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_PACKAGE_ID = 'Ember_Tavern_v0.4.1_Combat_Runtime_Assets_FINAL.zip';
export const RUNTIME_ASSET_COUNT = 119;

export const SOURCE_TO_RUNTIME_THEME = Object.freeze({
  common: 'common',
  cultivation: 'cultivation-default',
  fantasy: 'fantasy-default',
  scifi: 'scifi-default',
  urban: 'urban-default',
});

const DEFAULT_ROOT = resolve(process.cwd(), 'windows-app/public/assets/combat-themes');
const CANONICAL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)?$/u;

export function auditCombatRuntimeAssets(root = DEFAULT_ROOT) {
  const failures = [];
  const fail = (message) => failures.push(message);
  const descriptor = readJson(resolve(root, 'runtime-package.json'));
  const aggregate = readJson(resolve(root, 'asset-manifest.json'));
  const commonManifest = readJson(resolve(root, 'common/manifest.json'));
  const checksumEntries = parseChecksums(readText(resolve(root, 'sha256sums.txt')));
  const slotRows = parseSlotMap(readText(resolve(root, 'asset-slot-map.csv')));

  if (descriptor.packageId !== RUNTIME_PACKAGE_ID) fail('runtime package id is not v0.4.1 FINAL');
  if (descriptor.assetCount !== RUNTIME_ASSET_COUNT) fail('runtime package assetCount is not 119');
  if (descriptor.sourcePackage !== aggregate.package)
    fail('runtime package source identity drifted');
  if (descriptor.sourceOfTruth !== aggregate.sourceOfTruth)
    fail('source-of-truth identity drifted');
  if (aggregate.status !== 'FINAL') fail('aggregate manifest is not FINAL');
  if (aggregate.counts?.total !== RUNTIME_ASSET_COUNT) fail('aggregate total is not 119');
  if (checksumEntries.size !== 127) fail('FINAL checksum receipt does not contain 127 entries');
  for (const [runtimePath, sourcePath] of [
    ['readme.md', 'README.md'],
    ['asset-manifest.json', 'asset-manifest.json'],
    ['asset-slot-map.csv', 'asset-slot-map.csv'],
    ['common/manifest.json', 'common/manifest.json'],
  ]) {
    const content = readFileSync(resolve(root, runtimePath));
    if (sha256(content) !== checksumEntries.get(sourcePath)) {
      fail(`FINAL provenance receipt mismatch: ${runtimePath}`);
    }
  }
  if (!Array.isArray(aggregate.assets) || aggregate.assets.length !== RUNTIME_ASSET_COUNT) {
    fail('aggregate manifest does not contain 119 assets');
  }

  const aggregateAssets = Array.isArray(aggregate.assets) ? aggregate.assets : [];
  const runtimePaths = new Set();
  const sourceKeys = new Set();
  const expectedPngPaths = new Set();
  const assetsBySourceTheme = new Map();
  const memoryBySourceTheme = new Map();
  let sourceBytes = 0;
  let decodedRgbaBytes = 0;

  for (const asset of aggregateAssets) {
    const sourceTheme = stringField(asset, 'theme', fail);
    const slot = stringField(asset, 'slot', fail);
    const sourcePath = stringField(asset, 'file', fail);
    const digest = stringField(asset, 'sha256', fail);
    const runtimeTheme = SOURCE_TO_RUNTIME_THEME[sourceTheme];
    if (runtimeTheme === undefined) {
      fail(`unknown source theme: ${sourceTheme}`);
      continue;
    }
    const sourcePrefix = `${sourceTheme}/`;
    if (!sourcePath.startsWith(sourcePrefix)) {
      fail(`asset path is outside its source theme: ${sourcePath}`);
      continue;
    }
    const runtimePath = `${runtimeTheme}/${sourcePath.slice(sourcePrefix.length)}`;
    const sourceKey = `${sourceTheme}:${slot}`;
    if (sourceKeys.has(sourceKey)) fail(`duplicate slot in source theme: ${sourceKey}`);
    if (runtimePaths.has(runtimePath)) fail(`duplicate runtime path: ${runtimePath}`);
    sourceKeys.add(sourceKey);
    runtimePaths.add(runtimePath);
    expectedPngPaths.add(runtimePath);
    validateAssetPath(runtimePath, fail);

    const absolutePath = resolveInside(root, runtimePath, fail);
    if (absolutePath === null) continue;
    let content;
    try {
      content = readFileSync(absolutePath);
    } catch {
      fail(`missing runtime asset: ${runtimePath}`);
      continue;
    }
    const actualDigest = sha256(content);
    if (actualDigest !== digest) fail(`digest mismatch: ${runtimePath}`);
    if (checksumEntries.get(sourcePath) !== digest)
      fail(`checksum receipt mismatch: ${sourcePath}`);

    const metadata = pngMetadata(content);
    const dimensions = Array.isArray(asset.dimensions) ? asset.dimensions : [];
    if (metadata.width !== dimensions[0] || metadata.height !== dimensions[1]) {
      fail(`dimension mismatch: ${runtimePath}`);
    }
    if (metadata.colorType !== 6 || asset.mode !== 'RGBA' || asset.hasTransparency !== true) {
      fail(`asset is not transparent RGBA: ${runtimePath}`);
    }
    sourceBytes += content.byteLength;
    decodedRgbaBytes += metadata.width * metadata.height * 4;
    const memory = memoryBySourceTheme.get(sourceTheme) ?? {
      sourceBytes: 0,
      decodedRgbaBytes: 0,
    };
    memory.sourceBytes += content.byteLength;
    memory.decodedRgbaBytes += metadata.width * metadata.height * 4;
    memoryBySourceTheme.set(sourceTheme, memory);
    const grouped = assetsBySourceTheme.get(sourceTheme) ?? [];
    grouped.push({ slot, runtimePath, relativePath: sourcePath.slice(sourcePrefix.length) });
    assetsBySourceTheme.set(sourceTheme, grouped);
  }

  const packagePaths = walkFiles(root).map((path) => toPosix(relative(root, path)));
  for (const path of packagePaths) validateAssetPath(path, fail);
  const actualPngPaths = new Set(packagePaths.filter((path) => extname(path) === '.png'));
  for (const path of expectedPngPaths) {
    if (!actualPngPaths.has(path)) fail(`manifest asset is absent: ${path}`);
  }
  for (const path of actualPngPaths) {
    if (!expectedPngPaths.has(path)) fail(`undeclared runtime PNG: ${path}`);
  }
  if (actualPngPaths.size !== RUNTIME_ASSET_COUNT) {
    fail(`runtime PNG count is ${actualPngPaths.size}, expected 119`);
  }

  for (const [sourceTheme, runtimeTheme] of Object.entries(SOURCE_TO_RUNTIME_THEME)) {
    const expected = assetsBySourceTheme.get(sourceTheme) ?? [];
    const manifest =
      sourceTheme === 'common'
        ? commonManifest
        : readJson(resolve(root, runtimeTheme, 'manifest.json'));
    if (manifest.themeId !== runtimeTheme) fail(`theme identity mismatch: ${runtimeTheme}`);
    const declaredCount =
      sourceTheme === 'common' ? manifest.assetCount : Object.keys(manifest.assets ?? {}).length;
    if (declaredCount !== expected.length) fail(`assetCount mismatch: ${runtimeTheme}`);
    const expectedAssets = Object.fromEntries(
      expected.map(({ slot, relativePath }) => [slot, relativePath]),
    );
    if (!sameRecord(manifest.assets, expectedAssets))
      fail(`slot mapping mismatch: ${runtimeTheme}`);
  }

  if (slotRows.length !== RUNTIME_ASSET_COUNT) fail('slot map does not contain 119 data rows');
  const slotReceiptKeys = new Set(slotRows.map((row) => `${row.theme}:${row.asset_slot_id}`));
  if (slotReceiptKeys.size !== slotRows.length) fail('slot map contains duplicate theme/slot rows');
  for (const key of sourceKeys) {
    if (!slotReceiptKeys.has(key)) fail(`slot map is missing ${key}`);
  }

  const expectedCounts = aggregate.counts ?? {};
  for (const sourceTheme of Object.keys(SOURCE_TO_RUNTIME_THEME)) {
    const actualCount = assetsBySourceTheme.get(sourceTheme)?.length ?? 0;
    if (expectedCounts[sourceTheme] !== actualCount)
      fail(`aggregate count mismatch: ${sourceTheme}`);
  }

  if (failures.length > 0) {
    throw new Error(`Combat runtime asset audit failed:\n- ${failures.join('\n- ')}`);
  }
  return Object.freeze({
    packageId: descriptor.packageId,
    sourceOfTruth: descriptor.sourceOfTruth,
    assetCount: actualPngPaths.size,
    sourceBytes,
    decodedRgbaBytes,
    memoryByTheme: Object.freeze(
      Object.fromEntries(
        Object.keys(SOURCE_TO_RUNTIME_THEME).map((theme) => [
          theme,
          Object.freeze(memoryBySourceTheme.get(theme) ?? { sourceBytes: 0, decodedRgbaBytes: 0 }),
        ]),
      ),
    ),
    counts: Object.freeze(
      Object.fromEntries(
        Object.keys(SOURCE_TO_RUNTIME_THEME).map((theme) => [
          theme,
          assetsBySourceTheme.get(theme)?.length ?? 0,
        ]),
      ),
    ),
  });
}

function validateAssetPath(path, fail) {
  if (/\s/u.test(path)) fail(`asset path contains whitespace: ${path}`);
  if ([...path].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
    fail(`asset path contains non-ASCII text: ${path}`);
  }
  for (const segment of path.split('/')) {
    if (!CANONICAL_SEGMENT.test(segment)) fail(`asset path is not lowercase kebab-case: ${path}`);
  }
}

function resolveInside(root, relativePath, fail) {
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    fail(`asset path escapes runtime root: ${relativePath}`);
    return null;
  }
  return absolute;
}

function parseChecksums(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (match === null) throw new Error(`Malformed checksum receipt line: ${line}`);
    if (entries.has(match[2])) throw new Error(`Duplicate checksum receipt path: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

function parseSlotMap(text) {
  const lines = text
    .replace(/^\uFEFF/u, '')
    .trimEnd()
    .split(/\r?\n/u);
  const headers = lines.shift()?.split(',') ?? [];
  if (headers.join(',') !== 'theme,asset_slot_id,category,final_path,source_file') {
    throw new Error('Unexpected asset slot map headers');
  }
  return lines.map((line) => {
    const values = line.split(',');
    if (values.length !== headers.length) throw new Error(`Malformed slot map row: ${line}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function stringField(value, field, fail) {
  const candidate = value?.[field];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    fail(`manifest field ${field} must be a non-empty string`);
    return '';
  }
  return candidate;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function pngMetadata(content) {
  if (content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Runtime asset is not a PNG');
  }
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
    colorType: content.readUInt8(25),
  };
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : statSync(path).isFile() ? [path] : [];
  });
}

function sameRecord(actual, expected) {
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditCombatRuntimeAssets();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
