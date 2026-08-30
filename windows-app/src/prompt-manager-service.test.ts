import { describe, expect, it } from 'vitest';

import type { PromptManagerSnapshot } from '@ember-tavern/prompts';
import {
  PromptManagerError,
  PromptManagerService,
  type PromptManagerGateway,
} from './prompt-manager-service.js';

describe('PromptManagerService', () => {
  it('resolves enabled blocks in saved order for the requested task', async () => {
    const service = new PromptManagerService(gateway(snapshot()));
    await expect(service.resolve('NPC_REPLY')).resolves.toMatchObject({
      managerRevision: 4,
      presetId: 'preset-one',
      presetVersion: 2,
      blocks: [{ id: 'tone' }, { id: 'dialogue' }],
    });
    await expect(service.resolve('GENERATE_WORLD')).resolves.toMatchObject({
      blocks: [{ id: 'tone' }],
    });
  });

  it('preserves the native load failure as the error cause', async () => {
    const cause = new Error('database unavailable');
    const failing = gateway(snapshot());
    failing.load = async () => {
      throw cause;
    };
    const service = new PromptManagerService(failing);
    const error = await service.resolve('NPC_REPLY').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(PromptManagerError);
    expect(error).toMatchObject({ code: 'PROMPT_MANAGER_LOAD_FAILED', cause });
  });
});

function gateway(current: PromptManagerSnapshot): PromptManagerGateway {
  return {
    async load() {
      return current;
    },
    async save(): Promise<never> {
      throw new Error('not used');
    },
    async activate(): Promise<never> {
      throw new Error('not used');
    },
    async import(): Promise<never> {
      throw new Error('not used');
    },
    async export(): Promise<never> {
      throw new Error('not used');
    },
    async recover(): Promise<never> {
      throw new Error('not used');
    },
  };
}

function snapshot(): PromptManagerSnapshot {
  return {
    schemaVersion: 1,
    revision: 4,
    activePresetId: 'preset-one',
    presets: [
      {
        id: 'preset-one',
        name: 'Candlelit',
        version: 2,
        blocks: [
          { id: 'tone', name: 'Tone', content: 'Restrained prose.', enabled: true, tasks: [] },
          {
            id: 'dialogue',
            name: 'Dialogue',
            content: 'Brief speech.',
            enabled: true,
            tasks: ['NPC_REPLY'],
          },
          { id: 'off', name: 'Off', content: 'Ignored.', enabled: false, tasks: [] },
        ],
      },
    ],
  };
}
