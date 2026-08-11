import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface TauriConfig {
  productName: string;
  version: string;
  identifier: string;
  build: {
    devUrl: string;
    frontendDist: string;
  };
  app: {
    security: { csp: string | null };
  };
  bundle: {
    active: boolean;
    targets: string[];
    publisher: string;
    category: string;
    shortDescription: string;
    icon: string[];
    useLocalToolsDir: boolean;
    windows: {
      allowDowngrades: boolean;
      webviewInstallMode: { type: string; silent: boolean };
      nsis: {
        installMode: string;
        installerIcon: string;
        uninstallerIcon: string;
        languages: string[];
      };
    };
  };
}

interface TauriCapability {
  identifier: string;
  windows: string[];
  permissions: string[];
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const tauriDirectory = resolve(sourceDirectory, '../src-tauri');

describe('Desktop release configuration', () => {
  it('keeps current-user NSIS settings and provides cross-platform desktop icons', () => {
    const config = JSON.parse(
      readFileSync(resolve(tauriDirectory, 'tauri.conf.json'), 'utf8'),
    ) as TauriConfig;

    expect(config.productName).toBe('Ember Tavern');
    expect(config.version).toBe('0.2.0');
    expect(config.identifier).toBe('com.embertavern.windows');
    expect(config.build.devUrl).toBe('http://127.0.0.1:1420');
    expect(config.build.frontendDist).toBe('../dist');
    expect(config.app.security.csp).toBe(
      "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    );

    expect(config.bundle.active).toBe(true);
    expect(config.bundle.targets).toEqual(['nsis']);
    expect(config.bundle.publisher).toBe('Ember Tavern');
    expect(config.bundle.category).toBe('RolePlayingGame');
    expect(config.bundle.shortDescription).toContain('SQLite');
    expect(config.bundle.useLocalToolsDir).toBe(true);
    expect(config.bundle.windows.allowDowngrades).toBe(false);
    expect(config.bundle.windows.webviewInstallMode).toEqual({
      type: 'downloadBootstrapper',
      silent: true,
    });
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(config.bundle.windows.nsis.languages).toEqual(['SimpChinese', 'English']);

    expect(config.bundle.icon.some((icon) => icon.endsWith('.ico'))).toBe(true);
    expect(config.bundle.icon.some((icon) => icon.endsWith('.icns'))).toBe(true);
    expect(config.bundle.icon.some((icon) => icon.endsWith('.png'))).toBe(true);

    for (const icon of config.bundle.icon) {
      expect(existsSync(resolve(tauriDirectory, icon))).toBe(true);
    }

    for (const icon of [
      config.bundle.windows.nsis.installerIcon,
      config.bundle.windows.nsis.uninstallerIcon,
    ]) {
      expect(icon).toMatch(/\.ico$/u);
      expect(existsSync(resolve(tauriDirectory, icon))).toBe(true);
    }
  });

  it('keeps production WebView capabilities at the required minimum', () => {
    const capability = JSON.parse(
      readFileSync(resolve(tauriDirectory, 'capabilities/default.json'), 'utf8'),
    ) as TauriCapability;

    expect(capability.identifier).toBe('default');
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual([
      'core:event:default',
      'dialog:allow-open',
      'dialog:allow-save',
    ]);
    expect(capability.permissions).not.toContain('core:default');
    expect(capability.permissions.join(' ')).not.toMatch(/(?:shell|fs|http|devtools)/u);
  });
});
