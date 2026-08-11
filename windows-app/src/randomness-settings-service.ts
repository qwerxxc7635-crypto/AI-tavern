import { invoke } from '@tauri-apps/api/core';

export const RANDOMNESS_PROFILES = ['CONSERVATIVE', 'BALANCED', 'HIGH', 'CUSTOM'] as const;
export type RandomnessProfile = (typeof RANDOMNESS_PROFILES)[number];

export interface RandomnessSettingsSnapshot {
  readonly profile: RandomnessProfile;
  readonly customTemperature: number | null;
  readonly temperature: number;
}

export interface RandomnessSettingsUpdate {
  readonly profile: RandomnessProfile;
  readonly customTemperature: number | null;
}

export interface RandomnessSettingsGateway {
  load(): Promise<RandomnessSettingsSnapshot>;
  save(update: RandomnessSettingsUpdate): Promise<RandomnessSettingsSnapshot>;
}

export interface RandomnessTemperatureSource {
  resolveTemperature(): Promise<number>;
}

export const BALANCED_RANDOMNESS_SETTINGS = Object.freeze({
  profile: 'BALANCED' as const,
  customTemperature: null,
  temperature: 0.7,
});

export const balancedRandomnessTemperatureSource: RandomnessTemperatureSource = Object.freeze({
  async resolveTemperature() {
    return BALANCED_RANDOMNESS_SETTINGS.temperature;
  },
});

export const tauriRandomnessSettingsGateway: RandomnessSettingsGateway = Object.freeze({
  async load() {
    return parseRandomnessSettings(await invoke<unknown>('randomness_settings_get'));
  },
  async save(update: RandomnessSettingsUpdate) {
    return parseRandomnessSettings(
      await invoke<unknown>('randomness_settings_save', { command: update }),
    );
  },
});

export const tauriRandomnessTemperatureSource: RandomnessTemperatureSource = Object.freeze({
  async resolveTemperature() {
    return (await tauriRandomnessSettingsGateway.load()).temperature;
  },
});

export function parseRandomnessSettings(value: unknown): RandomnessSettingsSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Randomness settings must be an object');
  }
  const record = value as Record<string, unknown>;
  const profile = record['profile'];
  if (typeof profile !== 'string' || !RANDOMNESS_PROFILES.includes(profile as RandomnessProfile)) {
    throw new TypeError('Randomness profile is invalid');
  }
  const parsedProfile = profile as RandomnessProfile;
  const customTemperature = optionalTemperature(record['customTemperature']);
  const temperature = requireTemperature(record['temperature']);
  if ((parsedProfile === 'CUSTOM') !== (customTemperature !== null)) {
    throw new TypeError('Custom temperature does not match the randomness profile');
  }
  if (parsedProfile === 'CUSTOM' && customTemperature !== temperature) {
    throw new TypeError('Resolved custom temperature is inconsistent');
  }
  const expected = presetTemperature(parsedProfile);
  if (expected !== undefined && temperature !== expected) {
    throw new TypeError('Preset randomness temperature is inconsistent');
  }
  return Object.freeze({ profile: parsedProfile, customTemperature, temperature });
}

function presetTemperature(profile: RandomnessProfile): number | undefined {
  switch (profile) {
    case 'CONSERVATIVE':
      return 0.2;
    case 'BALANCED':
      return 0.7;
    case 'HIGH':
      return 1.1;
    case 'CUSTOM':
      return undefined;
  }
}

function optionalTemperature(value: unknown): number | null {
  if (value === null) return null;
  return requireTemperature(value);
}

function requireTemperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new TypeError('Randomness temperature must be between 0 and 2');
  }
  return value;
}
