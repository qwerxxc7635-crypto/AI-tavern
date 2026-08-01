import {
  isoTimestamp,
  modelProfileId,
  type IsoTimestamp,
  type ModelProfileId,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireBoolean,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { SqliteDatabase } from './sqlite-port.js';

export type RegisteredModelCostStatus = 'FREE' | 'PAID' | 'UNKNOWN';

export interface RegisteredModelCapabilities {
  readonly text: boolean;
  readonly streaming: boolean;
  readonly systemMessages: boolean;
  readonly jsonMode: boolean;
  readonly jsonSchema: boolean;
  readonly toolCalling: boolean;
  readonly reasoning: boolean;
  readonly contextWindowTokens: number | null;
  readonly costStatus: RegisteredModelCostStatus;
  readonly checkedAt: IsoTimestamp;
}

export interface RegisteredModelProfile {
  readonly id: ModelProfileId;
  readonly providerConfigId: string;
  readonly providerPresetKey: string;
  readonly providerType: string;
  readonly modelName: string;
  readonly displayName: string;
  readonly capabilities: RegisteredModelCapabilities;
}

export class ModelProfileRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public listEnabled(providerConfigId: string): readonly RegisteredModelProfile[] {
    if (providerConfigId.trim().length === 0) {
      throw new PersistenceDataError('Provider config ID must not be empty');
    }
    return Object.freeze(
      this.database
        .prepare(
          `SELECT m.id, m.provider_config_id, m.model_name, m.display_name,
                  p.preset_key, p.provider_type,
                  m.capabilities_json, m.capabilities_checked_at
           FROM model_profiles m
           JOIN provider_configs p ON p.id = m.provider_config_id
           WHERE m.provider_config_id = ? AND m.enabled = 1 AND p.enabled = 1
           ORDER BY m.display_name, m.id`,
        )
        .all(providerConfigId)
        .map(mapProfile)
        .filter((profile): profile is RegisteredModelProfile => profile !== null),
    );
  }

  public getEnabled(id: ModelProfileId): RegisteredModelProfile | null {
    return this.getById(id, true);
  }

  public get(id: ModelProfileId): RegisteredModelProfile | null {
    return this.getById(id, false);
  }

  public getConfiguredFallback(): RegisteredModelProfile | null {
    const row = this.database
      .prepare("SELECT value_json FROM app_settings WHERE key = 'fallback_model_profile_id'")
      .get();
    if (row === undefined) return null;
    const value = requireRecord(row, 'Fallback model setting row')['value_json'];
    const id = modelProfileId(requireString(parseJson(value, 'value_json'), 'fallback model ID'));
    return this.getEnabled(id);
  }

  private getById(id: ModelProfileId, requireEnabled: boolean): RegisteredModelProfile | null {
    const row = this.database
      .prepare(
        `SELECT m.id, m.provider_config_id, m.model_name, m.display_name,
                p.preset_key, p.provider_type,
                m.capabilities_json, m.capabilities_checked_at
         FROM model_profiles m
         JOIN provider_configs p ON p.id = m.provider_config_id
         WHERE m.id = ?${requireEnabled ? ' AND m.enabled = 1 AND p.enabled = 1' : ''}`,
      )
      .get(id);
    return row === undefined ? null : mapProfile(row);
  }
}

function mapProfile(value: unknown): RegisteredModelProfile | null {
  try {
    const row = requireRecord(value, 'ModelProfile row');
    const capabilitiesText = requireString(row['capabilities_json'], 'capabilities_json');
    const checkedAtColumn = row['capabilities_checked_at'];
    if (capabilitiesText === '{}') {
      if (checkedAtColumn !== null) {
        throw new PersistenceDataError(
          'Unregistered model capabilities cannot have a checked timestamp',
        );
      }
      return null;
    }
    const capabilities = parseCapabilities(parseJson(capabilitiesText, 'capabilities_json'));
    const rawCheckedAt = requireString(checkedAtColumn, 'capabilities_checked_at');
    const stored = requireRecord(parseJson(capabilitiesText, 'capabilities_json'), 'capabilities');
    if (rawCheckedAt !== requireString(stored['checkedAt'], 'capabilities.checkedAt')) {
      throw new PersistenceDataError('Model capabilities and checked timestamp are inconsistent');
    }
    return Object.freeze({
      id: modelProfileId(requireString(row['id'], 'id')),
      providerConfigId: requireString(row['provider_config_id'], 'provider_config_id'),
      providerPresetKey: requireString(row['preset_key'], 'preset_key'),
      providerType: requireString(row['provider_type'], 'provider_type'),
      modelName: requireString(row['model_name'], 'model_name'),
      displayName: requireString(row['display_name'], 'display_name'),
      capabilities,
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted ModelProfile row is invalid', { cause: error });
  }
}

function parseCapabilities(value: unknown): RegisteredModelCapabilities {
  const record = requireRecord(value, 'capabilities');
  const context = record['contextWindowTokens'];
  if (
    context !== null &&
    (typeof context !== 'number' || !Number.isSafeInteger(context) || context <= 0)
  ) {
    throw new PersistenceDataError('Model context window must be a positive safe integer or null');
  }
  const costStatus = requireString(record['costStatus'], 'capabilities.costStatus');
  if (costStatus !== 'FREE' && costStatus !== 'PAID' && costStatus !== 'UNKNOWN') {
    throw new PersistenceDataError('Model cost status is invalid');
  }
  return Object.freeze({
    text: requireBoolean(record['text'], 'capabilities.text'),
    streaming: requireBoolean(record['streaming'], 'capabilities.streaming'),
    systemMessages: requireBoolean(record['systemMessages'], 'capabilities.systemMessages'),
    jsonMode: requireBoolean(record['jsonMode'], 'capabilities.jsonMode'),
    jsonSchema: requireBoolean(record['jsonSchema'], 'capabilities.jsonSchema'),
    toolCalling: requireBoolean(record['toolCalling'], 'capabilities.toolCalling'),
    reasoning: requireBoolean(record['reasoning'], 'capabilities.reasoning'),
    contextWindowTokens: context as number | null,
    costStatus,
    checkedAt: parseRfc3339(requireString(record['checkedAt'], 'capabilities.checkedAt')),
  });
}

function parseRfc3339(value: string): IsoTimestamp {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PersistenceDataError('Model capability timestamp must be RFC3339');
  }
  return isoTimestamp(new Date(value).toISOString());
}
