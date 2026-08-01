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

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const tauriDirectory = resolve(sourceDirectory, '../src-tauri');

describe('Windows release configuration', () => {
  it('produces a current-user NSIS installer from bundled frontend assets', () => {
    const config = JSON.parse(
      readFileSync(resolve(tauriDirectory, 'tauri.conf.json'), 'utf8'),
    ) as TauriConfig;

    expect(config.productName).toBe('Ember Tavern');
    expect(config.version).toBe('0.1.0');
    expect(config.identifier).toBe('com.embertavern.windows');
    expect(config.build.devUrl).toBe('http://127.0.0.1:1420');
    expect(config.build.frontendDist).toBe('../dist');

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

    for (const icon of [
      ...config.bundle.icon,
      config.bundle.windows.nsis.installerIcon,
      config.bundle.windows.nsis.uninstallerIcon,
    ]) {
      expect(icon).toMatch(/\.ico$/u);
      expect(existsSync(resolve(tauriDirectory, icon))).toBe(true);
    }
  });
});
