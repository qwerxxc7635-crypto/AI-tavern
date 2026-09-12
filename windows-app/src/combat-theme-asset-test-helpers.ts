import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseCombatThemeManifest } from '@ember-tavern/contracts';
import type { CombatThemeManifest } from '@ember-tavern/contracts';

export function readPublicThemeManifest(themeId: string): CombatThemeManifest {
  return parseCombatThemeManifest(
    JSON.parse(readFileSync(resolve(themeRoot(themeId), 'manifest.json'), 'utf8')) as unknown,
  );
}

export function readPublicThemeAsset(themeId: string, relativePath: string): Buffer {
  return readFileSync(resolve(themeRoot(themeId), relativePath));
}

export function pngMetadata(png: Buffer): {
  readonly signature: string;
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
} {
  return {
    signature: png.subarray(0, 8).toString('hex'),
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png.readUInt8(25),
  };
}

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function themeRoot(themeId: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(themeId)) {
    throw new TypeError('Invalid theme fixture id');
  }
  return resolve(process.cwd(), 'windows-app/public/assets/combat-themes', themeId);
}
