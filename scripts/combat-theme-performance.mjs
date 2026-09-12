import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { RUNTIME_PACKAGE_ID, auditCombatRuntimeAssets } from './combat-runtime-assets.mjs';

const THEMES = ['cultivation-default', 'fantasy-default', 'scifi-default', 'urban-default'];
async function main() {
  const outputPath = resolve(readOutputPath(process.argv.slice(2)));
  if (existsSync(outputPath))
    throw new Error(`Refusing to overwrite performance report: ${outputPath}`);

  const audit = auditCombatRuntimeAssets();
  const chromePath = findChrome();
  const vitePort = await availablePort();
  const cdpPort = await availablePort();
  const profileDirectory = mkdtempSync(resolve(tmpdir(), 'ember-combat-theme-chrome-'));
  const vite = spawn(
    'pnpm',
    [
      '--dir',
      'windows-app',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(vitePort),
      '--strictPort',
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDirectory}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const diagnostics = [];
  vite.stderr.on('data', (chunk) => diagnostics.push(`vite: ${String(chunk)}`));
  chrome.stderr.on('data', (chunk) => diagnostics.push(`chrome: ${String(chunk)}`));

  let client;
  try {
    await waitForHttp(`http://127.0.0.1:${vitePort}/combat-theme-benchmark.html`, 30_000);
    const page = await waitForPage(cdpPort, 30_000);
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    const measurements = {};
    for (const themeId of THEMES) {
      const loaded = client.waitForEvent('Page.loadEventFired', 30_000);
      await client.send('Page.navigate', {
        url: `http://127.0.0.1:${vitePort}/combat-theme-benchmark.html?theme=${themeId}`,
      });
      await loaded;
      const evaluated = await client.send('Runtime.evaluate', {
        expression: `new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const poll = () => {
          if (window.__EMBER_COMBAT_THEME_BENCHMARK__) {
            resolve(window.__EMBER_COMBAT_THEME_BENCHMARK__);
          } else if (window.__EMBER_COMBAT_THEME_BENCHMARK_ERROR__) {
            reject(new Error(window.__EMBER_COMBAT_THEME_BENCHMARK_ERROR__));
          } else if (performance.now() - startedAt > 120000) {
            reject(new Error('Browser benchmark timed out'));
          } else {
            setTimeout(poll, 100);
          }
        };
        poll();
      })`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluated.exceptionDetails !== undefined) {
        throw new Error(`Browser benchmark failed for ${themeId}`);
      }
      measurements[themeId] = evaluated.result.value;
      process.stdout.write(
        `${themeId}: load=${evaluated.result.value.themeLoadMs}ms, ` +
          `frame-p95=${evaluated.result.value.renderFrame.p95Ms}ms\n`,
      );
    }

    const report = {
      schemaVersion: 1,
      packageId: RUNTIME_PACKAGE_ID,
      generatedAt: new Date().toISOString(),
      evidenceKind: 'REAL_BROWSER',
      gatePolicy: 'SOT_SHOULD_RECORD_NO_ABSOLUTE_THRESHOLD',
      method: {
        themeLoadTime:
          'Browser fetch and createImageBitmap decode for one theme plus all common VFX, cold page profile per run.',
        assetMemory:
          'Actual fetched Blob bytes plus decoded RGBA byte count from FINAL manifest dimensions.',
        renderFrameTime:
          'Thirty representative CombatScreen React updates measured from root.render to the next requestAnimationFrame.',
        viewport: '1440x900',
      },
      package: {
        assetCount: audit.assetCount,
        sourceBytes: audit.sourceBytes,
        decodedRgbaBytes: audit.decodedRgbaBytes,
      },
      themes: measurements,
    };
    validateMeasurements(report);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Performance report written to ${outputPath}\n`);
  } catch (error) {
    if (diagnostics.length > 0) process.stderr.write(diagnostics.slice(-10).join(''));
    throw error;
  } finally {
    client?.close();
    await stopProcess(chrome);
    await stopProcess(vite);
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function validateMeasurements(report) {
  for (const [themeId, measurement] of Object.entries(report.themes)) {
    const expectedThemeCount = themeId === 'scifi-default' ? 28 : 27;
    if (measurement.themeId !== themeId)
      throw new Error(`Theme measurement identity drifted: ${themeId}`);
    if (measurement.themeAssetCount !== expectedThemeCount || measurement.commonAssetCount !== 10) {
      throw new Error(`Theme measurement asset count drifted: ${themeId}`);
    }
    if (measurement.loadedAssetCount !== expectedThemeCount + 10) {
      throw new Error(`Theme measurement did not load all assets: ${themeId}`);
    }
    for (const value of [
      measurement.sourceBytes,
      measurement.decodedRgbaBytes,
      measurement.themeLoadMs,
      measurement.renderFrame.medianMs,
      measurement.renderFrame.p95Ms,
      measurement.renderFrame.maximumMs,
    ]) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid measurement: ${themeId}`);
    }
    if (measurement.renderFrame.iterations !== 30) {
      throw new Error(`Unexpected frame sample count: ${themeId}`);
    }
  }
}

function readOutputPath(args) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new Error('Use --output <new-json-path>');
  }
  return args[1];
}

function findChrome() {
  const candidates = [
    process.env.EMBER_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const match = candidates.find((candidate) => existsSync(candidate));
  if (match === undefined)
    throw new Error('Chrome or Chromium is required for the real browser gate');
  return match;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Could not allocate a port');
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((candidate) => candidate.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // Browser is still starting.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for Chrome DevTools');
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, milliseconds));
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

class CdpClient {
  static async connect(url) {
    const socket = new globalThis.WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener('open', resolvePromise, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    socket.addEventListener('message', (event) => this.onMessage(JSON.parse(String(event.data))));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs) {
    return new Promise((resolvePromise, reject) => {
      const timeout = globalThis.setTimeout(
        () => reject(new Error(`Timed out waiting for ${method}`)),
        timeoutMs,
      );
      const waiters = this.eventWaiters.get(method) ?? [];
      waiters.push((params) => {
        globalThis.clearTimeout(timeout);
        resolvePromise(params);
      });
      this.eventWaiters.set(method, waiters);
    });
  }

  onMessage(message) {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    const waiters = this.eventWaiters.get(message.method) ?? [];
    this.eventWaiters.delete(message.method);
    for (const waiter of waiters) waiter(message.params);
  }

  close() {
    this.socket.close();
  }
}

await main();
