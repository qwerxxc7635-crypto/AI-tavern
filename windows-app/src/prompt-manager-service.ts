import { invoke } from '@tauri-apps/api/core';

import type { AITask } from '@ember-tavern/ai-core';
import {
  parsePromptManagerSnapshot,
  parsePromptPresetBundle,
  resolvePromptPreset,
  type PromptManagerSnapshot,
  type PromptUserBlock,
  type ResolvedPromptPreset,
} from '@ember-tavern/prompts';

export interface PromptPresetDraft {
  readonly id: string;
  readonly name: string;
  readonly expectedVersion: number | null;
  readonly blocks: readonly PromptUserBlock[];
}

export interface PromptManagerGateway {
  load(): Promise<PromptManagerSnapshot>;
  save(revision: number, draft: PromptPresetDraft): Promise<PromptManagerSnapshot>;
  activate(revision: number, presetId: string | null): Promise<PromptManagerSnapshot>;
  import(
    revision: number,
    targetPresetId: string,
    bundleJson: string,
  ): Promise<PromptManagerSnapshot>;
  export(presetId: string): Promise<string>;
  recover(expectedRevision: number | null): Promise<PromptManagerSnapshot>;
}

export interface PromptProfileSource {
  resolve(task: AITask): Promise<ResolvedPromptPreset | null>;
}

export class PromptManagerService implements PromptProfileSource {
  private readonly gateway: PromptManagerGateway;

  public constructor(gateway: PromptManagerGateway) {
    this.gateway = gateway;
  }

  public async resolve(task: AITask): Promise<ResolvedPromptPreset | null> {
    try {
      return resolvePromptPreset(await this.gateway.load(), task);
    } catch (cause) {
      throw new PromptManagerError('PROMPT_MANAGER_LOAD_FAILED', cause);
    }
  }
}

export class PromptManagerError extends Error {
  public readonly code: string;

  public constructor(code: string, cause?: unknown) {
    super('Prompt Manager operation failed', { cause });
    this.name = 'PromptManagerError';
    this.code = code;
  }
}

export const tauriPromptManagerGateway: PromptManagerGateway = {
  async load() {
    return parsePromptManagerSnapshot(await invoke<unknown>('prompt_manager_get'));
  },
  async save(expectedManagerRevision, draft) {
    return parsePromptManagerSnapshot(
      await invoke<unknown>('prompt_preset_save', {
        command: {
          expectedManagerRevision,
          expectedPresetVersion: draft.expectedVersion,
          presetId: draft.id,
          name: draft.name,
          blocks: draft.blocks,
        },
      }),
    );
  },
  async activate(expectedManagerRevision, presetId) {
    return parsePromptManagerSnapshot(
      await invoke<unknown>('prompt_preset_activate', {
        command: { expectedManagerRevision, presetId },
      }),
    );
  },
  async import(expectedManagerRevision, targetPresetId, bundleJson) {
    parsePromptPresetBundle(JSON.parse(bundleJson) as unknown);
    return parsePromptManagerSnapshot(
      await invoke<unknown>('prompt_preset_import', {
        command: { expectedManagerRevision, targetPresetId, bundleJson },
      }),
    );
  },
  async export(presetId) {
    const value = await invoke<unknown>('prompt_preset_export', { presetId });
    if (typeof value !== 'string') throw new TypeError('Prompt preset export is invalid');
    parsePromptPresetBundle(JSON.parse(value) as unknown);
    return value;
  },
  async recover(expectedRevision) {
    return parsePromptManagerSnapshot(
      await invoke<unknown>('prompt_manager_reset', { expectedRevision }),
    );
  },
};

export const tauriPromptProfileSource = new PromptManagerService(tauriPromptManagerGateway);

export const defaultPromptProfileSource: PromptProfileSource = Object.freeze({
  async resolve() {
    return null;
  },
});
