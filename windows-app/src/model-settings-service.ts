import { invoke } from '@tauri-apps/api/core';

export type PresetKey = 'deepseek' | 'qwen' | 'openrouter' | 'ollama' | 'custom';

export interface ConnectionProfileDefinition {
  readonly key: PresetKey;
  readonly name: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly endpointMode: 'FIXED' | 'CONFIGURABLE';
  readonly credentialMode: 'REQUIRED' | 'OPTIONAL' | 'NONE';
}

export const CONNECTION_PROFILES: readonly ConnectionProfileDefinition[] = Object.freeze([
  Object.freeze({
    key: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/',
    defaultModel: 'deepseek-v4-flash',
    endpointMode: 'FIXED',
    credentialMode: 'REQUIRED',
  }),
  Object.freeze({
    key: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    defaultModel: 'qwen3.7-plus',
    endpointMode: 'FIXED',
    credentialMode: 'REQUIRED',
  }),
  Object.freeze({
    key: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    defaultModel: '',
    endpointMode: 'FIXED',
    credentialMode: 'REQUIRED',
  }),
  Object.freeze({
    key: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1/',
    defaultModel: '',
    endpointMode: 'CONFIGURABLE',
    credentialMode: 'NONE',
  }),
  Object.freeze({
    key: 'custom',
    name: 'OpenAI-Compatible',
    baseUrl: '',
    defaultModel: '',
    endpointMode: 'CONFIGURABLE',
    credentialMode: 'OPTIONAL',
  }),
]);

export function getConnectionProfile(key: PresetKey): ConnectionProfileDefinition {
  const profile = CONNECTION_PROFILES.find((candidate) => candidate.key === key);
  if (profile === undefined) throw new TypeError('Connection profile is invalid');
  return profile;
}

export interface ModelProfile {
  readonly id: string;
  readonly providerId: string;
  readonly presetKey: PresetKey;
  readonly providerDisplayName: string;
  readonly baseUrl: string | null;
  readonly endpointFingerprint: string | null;
  readonly hasCredential: boolean;
  readonly modelName: string;
  readonly modelDisplayName: string;
  readonly capabilities: ModelCapabilities | null;
  readonly capabilitySource: CapabilitySource | null;
  readonly probeFingerprint: string | null;
}

export type CapabilitySource = 'PROVIDER_RESPONSE' | 'PRESET_METADATA' | 'UNKNOWN';

export interface ModelSettingsSnapshot {
  readonly profiles: readonly ModelProfile[];
  readonly defaultModelProfileId: string | null;
  readonly fallbackModelProfileId: string | null;
  readonly pendingCredentialCleanupCount: number;
}

export interface ModelSettingsUpdate {
  readonly presetKey: PresetKey;
  readonly providerDisplayName: string;
  readonly baseUrl: string | null;
  readonly endpointFingerprint: string;
  readonly credentialRef: string | null;
  readonly credentialAction: 'KEEP' | 'REPLACE' | 'CLEAR';
  readonly modelName: string;
  readonly modelDisplayName: string;
  readonly capabilities: ModelCapabilities;
  readonly capabilitySource: CapabilitySource;
  readonly probeFingerprint: string;
  readonly probeReceiptId: string;
  readonly useAsDefault: boolean;
  readonly useAsFallback: boolean;
}

export interface ProbeModel {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  readonly capabilitySource: CapabilitySource;
  readonly probeFingerprint: string;
}

export interface ProbeResult {
  readonly receiptId: string;
  readonly normalizedBaseUrl: string;
  readonly endpointFingerprint: string;
  readonly models: readonly ProbeModel[];
}

export interface ModelCapabilities {
  readonly text: boolean;
  readonly streaming: boolean;
  readonly systemMessages: boolean;
  readonly jsonMode: boolean;
  readonly jsonSchema: boolean;
  readonly toolCalling: boolean;
  readonly reasoning: boolean;
  readonly contextWindowTokens: number | null;
  readonly costStatus: 'FREE' | 'PAID' | 'UNKNOWN';
  readonly checkedAt: string;
}

export interface ModelSettingsGateway {
  load(): Promise<ModelSettingsSnapshot>;
  save(update: ModelSettingsUpdate): Promise<ModelSettingsSnapshot>;
  forgetCredential(profileId: string): Promise<ModelSettingsSnapshot>;
  saveSecret(secret: string): Promise<string>;
  deleteSecret(credentialRef: string): Promise<void>;
  probe(input: {
    readonly presetKey: PresetKey;
    readonly baseUrl: string | null;
    readonly credentialRef: string | null;
  }): Promise<ProbeResult>;
}

export const tauriModelSettingsGateway: ModelSettingsGateway = {
  async load() {
    return parseModelSettingsSnapshot(await invoke<unknown>('model_settings_get'));
  },
  async save(command) {
    return parseModelSettingsSnapshot(await invoke<unknown>('model_settings_save', { command }));
  },
  async forgetCredential(profileId) {
    return parseModelSettingsSnapshot(
      await invoke<unknown>('model_settings_forget_credential', { profileId }),
    );
  },
  async saveSecret(secret) {
    const value = await invoke<unknown>('secret_save', { secret });
    if (typeof value !== 'string' || !/^credential:v1:[0-9a-f-]{36}$/.test(value)) {
      throw new TypeError('Credential reference is invalid');
    }
    return value;
  },
  async deleteSecret(credentialRef) {
    await invoke('secret_delete', { credentialRef });
  },
  async probe(input) {
    const value = requireRecord(await invoke<unknown>('provider_probe', { input }));
    return Object.freeze({
      receiptId: requireId(value['receiptId']),
      normalizedBaseUrl: requireText(value['normalizedBaseUrl']),
      endpointFingerprint: requireFingerprint(value['endpointFingerprint']),
      models: Object.freeze(requireArray(value['models']).map(parseProbeModel)),
    });
  },
};

export function parseModelSettingsSnapshot(value: unknown): ModelSettingsSnapshot {
  const record = requireRecord(value);
  return Object.freeze({
    profiles: Object.freeze(requireArray(record['profiles']).map(parseProfile)),
    defaultModelProfileId: optionalId(record['defaultModelProfileId']),
    fallbackModelProfileId: optionalId(record['fallbackModelProfileId']),
    pendingCredentialCleanupCount: requireNonNegativeInteger(
      record['pendingCredentialCleanupCount'],
    ),
  });
}

function parseProfile(value: unknown): ModelProfile {
  const record = requireRecord(value);
  const presetKey = requireText(record['presetKey']) as PresetKey;
  if (!['deepseek', 'qwen', 'openrouter', 'ollama', 'custom'].includes(presetKey)) {
    throw new TypeError('Provider preset is invalid');
  }
  return Object.freeze({
    id: requireText(record['id']),
    providerId: requireText(record['providerId']),
    presetKey,
    providerDisplayName: requireText(record['providerDisplayName']),
    baseUrl: optionalText(record['baseUrl']),
    endpointFingerprint: optionalFingerprint(record['endpointFingerprint']),
    hasCredential: requireBoolean(record['hasCredential']),
    modelName: requireText(record['modelName']),
    modelDisplayName: requireText(record['modelDisplayName']),
    capabilities:
      record['capabilities'] === null ? null : parseCapabilities(record['capabilities']),
    capabilitySource:
      record['capabilitySource'] === null
        ? null
        : requireCapabilitySource(record['capabilitySource']),
    probeFingerprint: optionalFingerprint(record['probeFingerprint']),
  });
}

function parseProbeModel(value: unknown): ProbeModel {
  const record = requireRecord(value);
  return Object.freeze({
    name: requireText(record['name']),
    displayName: requireText(record['displayName']),
    capabilities: parseCapabilities(record['capabilities']),
    capabilitySource: requireCapabilitySource(record['capabilitySource']),
    probeFingerprint: requireFingerprint(record['probeFingerprint']),
  });
}

function parseCapabilities(value: unknown): ModelCapabilities {
  const record = requireRecord(value);
  const status = record['costStatus'];
  if (status !== 'FREE' && status !== 'PAID' && status !== 'UNKNOWN') {
    throw new TypeError('Model cost status is invalid');
  }
  const context = record['contextWindowTokens'];
  if (context !== null && (!Number.isSafeInteger(context) || (context as number) <= 0)) {
    throw new TypeError('Model context window is invalid');
  }
  return Object.freeze({
    text: requireBoolean(record['text']),
    streaming: requireBoolean(record['streaming']),
    systemMessages: requireBoolean(record['systemMessages']),
    jsonMode: requireBoolean(record['jsonMode']),
    jsonSchema: requireBoolean(record['jsonSchema']),
    toolCalling: requireBoolean(record['toolCalling']),
    reasoning: requireBoolean(record['reasoning']),
    costStatus: status,
    contextWindowTokens: context as number | null,
    checkedAt: requireTimestamp(record['checkedAt']),
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Model settings response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Model settings list must be an array');
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Model settings text is invalid');
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return value === null ? null : requireText(value);
}

function optionalId(value: unknown): string | null {
  return optionalText(value);
}

function requireId(value: unknown): string {
  const id = requireText(value);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new TypeError('Probe receipt is invalid');
  return id;
}

function requireFingerprint(value: unknown): string {
  const fingerprint = requireText(value);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new TypeError('Probe fingerprint is invalid');
  return fingerprint;
}

function optionalFingerprint(value: unknown): string | null {
  return value === null ? null : requireFingerprint(value);
}

function requireCapabilitySource(value: unknown): CapabilitySource {
  if (value !== 'PROVIDER_RESPONSE' && value !== 'PRESET_METADATA' && value !== 'UNKNOWN') {
    throw new TypeError('Capability source is invalid');
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Model settings flag is invalid');
  return value;
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('Model settings count is invalid');
  }
  return value as number;
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError('Model capability timestamp is invalid');
  }
  return value;
}
