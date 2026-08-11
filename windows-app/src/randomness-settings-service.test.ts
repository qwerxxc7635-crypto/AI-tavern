import { describe, expect, it } from 'vitest';

import {
  BALANCED_RANDOMNESS_SETTINGS,
  balancedRandomnessTemperatureSource,
  parseRandomnessSettings,
} from './randomness-settings-service.js';

describe('randomness settings service', () => {
  it('parses all presets and resolves the offline default', async () => {
    expect(parseRandomnessSettings(BALANCED_RANDOMNESS_SETTINGS)).toEqual(
      BALANCED_RANDOMNESS_SETTINGS,
    );
    expect(
      parseRandomnessSettings({
        profile: 'CONSERVATIVE',
        customTemperature: null,
        temperature: 0.2,
      }).temperature,
    ).toBe(0.2);
    expect(
      parseRandomnessSettings({ profile: 'HIGH', customTemperature: null, temperature: 1.1 })
        .temperature,
    ).toBe(1.1);
    expect(await balancedRandomnessTemperatureSource.resolveTemperature()).toBe(0.7);
  });

  it('accepts a bounded custom value and rejects contradictory or invalid snapshots', () => {
    expect(
      parseRandomnessSettings({ profile: 'CUSTOM', customTemperature: 1.4, temperature: 1.4 }),
    ).toEqual({ profile: 'CUSTOM', customTemperature: 1.4, temperature: 1.4 });
    for (const value of [
      { profile: 'CUSTOM', customTemperature: null, temperature: 0.7 },
      { profile: 'CUSTOM', customTemperature: 1.4, temperature: 1.3 },
      { profile: 'BALANCED', customTemperature: null, temperature: 0.8 },
      { profile: 'HIGH', customTemperature: null, temperature: Number.NaN },
      { profile: 'UNKNOWN', customTemperature: null, temperature: 0.7 },
    ]) {
      expect(() => parseRandomnessSettings(value)).toThrow(TypeError);
    }
  });
});
