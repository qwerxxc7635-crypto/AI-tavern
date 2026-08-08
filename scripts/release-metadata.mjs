import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function buildReleaseMetadata({
  packageJson,
  tauriConfig,
  releaseInfo,
  gitCommit,
  platform,
  arch,
}) {
  if (packageJson.version !== tauriConfig.version || packageJson.version !== releaseInfo.version) {
    throw new Error('Root, desktop and release-info versions differ.');
  }

  return {
    productName: tauriConfig.productName,
    version: packageJson.version,
    channel: releaseInfo.channel,
    status: releaseInfo.status,
    gitCommit,
    platform,
    arch,
  };
}

async function main() {
  const [packageJson, tauriConfig, releaseInfo] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../windows-app/src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(
      JSON.parse,
    ),
    readFile(new URL('../release-info.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const metadata = buildReleaseMetadata({
    packageJson,
    tauriConfig,
    releaseInfo,
    gitCommit,
    platform: process.platform,
    arch: process.arch,
  });
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
