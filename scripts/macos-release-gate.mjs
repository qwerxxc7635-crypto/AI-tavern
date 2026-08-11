import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

const appFlag = process.argv.indexOf('--app');
const outputFlag = process.argv.indexOf('--output');
if (appFlag < 0 || outputFlag < 0 || !process.argv[appFlag + 1] || !process.argv[outputFlag + 1]) {
  throw new Error('Usage: node scripts/macos-release-gate.mjs --app <bundle> --output <file>');
}

const appBundle = resolve(process.argv[appFlag + 1]);
const evidenceOutput = resolve(process.argv[outputFlag + 1]);
const identifier = 'com.embertavern.windows';
const productName = 'Ember Tavern';
const expectedVersion = '0.2.0';
const startedAt = new Date().toISOString();
const userHome = homedir();
const platformPaths = {
  data: join(userHome, 'Library', 'Application Support', identifier),
  cache: join(userHome, 'Library', 'Caches', identifier),
  log: join(userHome, 'Library', 'Logs', identifier),
  temp: realpathSync(tmpdir()),
};
const webKitData = join(userHome, 'Library', 'WebKit', identifier);
const guardedPaths = [platformPaths.data, platformPaths.cache, platformPaths.log, webKitData];
const evidence = {
  schemaVersion: 1,
  startedAt,
  endedAt: null,
  success: false,
  environment: {
    ci: process.env.CI ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
    platform: process.platform,
    architecture: process.arch,
  },
  keychain: null,
  appBundle: null,
  wkWebView: null,
  platformPaths: null,
  launch: null,
  cleanup: null,
  error: null,
};

let appProcess;
let cleanupAuthorized = false;
const appStdout = [];
const appStderr = [];

try {
  assertEphemeralMacOsRunner();
  for (const path of guardedPaths) {
    if (existsSync(path))
      throw new Error(`Refusing to touch pre-existing application path: ${path}`);
  }
  cleanupAuthorized = true;

  const infoPlist = join(appBundle, 'Contents', 'Info.plist');
  const bundleIdentifier = plistValue(infoPlist, 'CFBundleIdentifier');
  const bundleVersion = plistValue(infoPlist, 'CFBundleShortVersionString');
  const executableName = plistValue(infoPlist, 'CFBundleExecutable');
  const displayName = plistValue(infoPlist, 'CFBundleDisplayName');
  if (bundleIdentifier !== identifier)
    throw new Error(`Unexpected bundle identifier: ${bundleIdentifier}`);
  if (bundleVersion !== expectedVersion)
    throw new Error(`Unexpected bundle version: ${bundleVersion}`);
  if (displayName !== productName)
    throw new Error(`Unexpected bundle display name: ${displayName}`);

  const executable = join(appBundle, 'Contents', 'MacOS', executableName);
  if (!existsSync(executable) || !statSync(executable).isFile()) {
    throw new Error('The app bundle executable is missing.');
  }
  const linkedFrameworks = runText('otool', ['-L', executable]);
  const webKitFramework = linkedFrameworks
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('/System/Library/Frameworks/WebKit.framework/'));
  if (!webKitFramework)
    throw new Error('The app executable is not linked to the system WebKit framework.');
  evidence.appBundle = {
    path: appBundle,
    identifier: bundleIdentifier,
    displayName,
    version: bundleVersion,
    executable,
    bytes: statSync(executable).size,
    sha256: sha256(readFileSync(executable)),
  };

  runInherited('cargo', [
    'test',
    '-p',
    'ember-secure-secrets',
    'tests::operating_system_store_round_trip_and_idempotent_delete',
    '--',
    '--exact',
  ]);
  evidence.keychain = {
    command:
      'cargo test -p ember-secure-secrets tests::operating_system_store_round_trip_and_idempotent_delete -- --exact',
    exitCode: 0,
    secretPersistedAfterTest: false,
  };

  const webKitBefore = webKitProcessIds();
  const launchStartedAt = Date.now();
  appProcess = spawn(executable, [], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  appProcess.stdout.on('data', (chunk) => {
    appStdout.push(chunk);
    process.stdout.write(chunk);
  });
  appProcess.stderr.on('data', (chunk) => {
    appStderr.push(chunk);
    process.stderr.write(chunk);
  });
  const database = join(platformPaths.data, 'ember-tavern.sqlite');
  const observed = await waitUntil(() => {
    const newWebKitProcesses = webKitProcessIds().filter((pid) => !webKitBefore.includes(pid));
    return existsSync(database) && newWebKitProcesses.length > 0
      ? { newWebKitProcesses }
      : undefined;
  }, 30_000);
  await delay(10_000);
  if (appProcess.exitCode !== null) {
    throw new Error(`The app exited during the launch soak with code ${appProcess.exitCode}.`);
  }
  if (!observed) throw new Error('The app did not create its database and a WKWebView process.');

  evidence.wkWebView = {
    framework: webKitFramework.split(' (compatibility version')[0],
    newProcessIds: observed.newWebKitProcesses,
  };
  evidence.platformPaths = {
    ...platformPaths,
    allAbsolute: Object.values(platformPaths).every(isAbsolute),
    database,
    databaseObserved: true,
    adapterContractCommand:
      'cargo test -p ember-platform-services tests::macos_adapter_obeys_platform_paths_contract -- --exact',
  };
  runInherited('cargo', [
    'test',
    '-p',
    'ember-platform-services',
    'tests::macos_adapter_obeys_platform_paths_contract',
    '--',
    '--exact',
  ]);
  evidence.launch = {
    processId: appProcess.pid,
    observedAliveSeconds: Math.floor((Date.now() - launchStartedAt) / 1000),
    stdoutBytes: Buffer.concat(appStdout).length,
    stderrBytes: Buffer.concat(appStderr).length,
  };

  appProcess.kill('SIGTERM');
  await waitForExit(appProcess, 10_000);
  evidence.success = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  if (appProcess?.exitCode === null) {
    appProcess.kill('SIGKILL');
    await waitForExit(appProcess, 5_000).catch(() => {});
  }
  const removed = [];
  if (cleanupAuthorized) {
    for (const path of guardedPaths) {
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      }
    }
  }
  evidence.cleanup = { removed, authorized: cleanupAuthorized };
  evidence.endedAt = new Date().toISOString();
  mkdirSync(dirname(evidenceOutput), { recursive: true });
  writeFileSync(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

if (!evidence.success) {
  process.stderr.write(`${evidence.error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`macOS release gate passed; evidence: ${evidenceOutput}\n`);
}

function assertEphemeralMacOsRunner() {
  if (
    process.env.CI !== 'true' ||
    process.env.RUNNER_OS !== 'macOS' ||
    process.platform !== 'darwin'
  ) {
    throw new Error('macOS release gate is restricted to an ephemeral CI macOS runner.');
  }
  if (!appBundle.endsWith('.app') || basename(appBundle) !== `${productName}.app`) {
    throw new Error('The release gate requires the Ember Tavern app bundle.');
  }
}

function plistValue(plist, key) {
  if (!existsSync(plist)) throw new Error('The app bundle Info.plist is missing.');
  return runText('plutil', ['-extract', key, 'raw', '-o', '-', plist]).trim();
}

function runInherited(command, args) {
  const result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with exit code ${result.status ?? 1}.`);
}

function runText(command, args) {
  const result = spawnSync(command, args, { env: process.env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function webKitProcessIds() {
  return runText('ps', ['-axo', 'pid=,command='])
    .split('\n')
    .filter((line) => /WebKit\.framework|com\.apple\.WebKit/u.test(line))
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter(Number.isSafeInteger);
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = condition();
    if (value) return value;
    await delay(500);
  } while (Date.now() < deadline);
  return undefined;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(
      () => rejectExit(new Error('Timed out waiting for app exit.')),
      timeoutMs,
    );
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
