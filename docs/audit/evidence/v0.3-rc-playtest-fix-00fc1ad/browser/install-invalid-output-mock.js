/* global window, setTimeout */

(() => {
  const timestamp = '2026-08-29T11:50:00.000Z';
  const campaign = {
    id: 'rc-browser-invalid-output',
    state: 'CREATING_WORLD',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const counters = Object.create(null);
  const audit = { counters, mode: 'INVALID_JSON' };
  window.__EMBER_RC_INVALID_OUTPUT_AUDIT__ = audit;
  window.__TAURI_INTERNALS__ = {
    invoke: async (command) => {
      counters[command] = (counters[command] ?? 0) + 1;
      switch (command) {
        case 'campaign_list':
          return [campaign];
        case 'world_creation_get':
          return { campaignState: 'CREATING_WORLD', world: null, constitution: null };
        case 'plugin:event|listen':
          return 1;
        case 'plugin:event|unlisten':
        case 'ai_stream_cancel':
          return null;
        case 'randomness_settings_get':
          return { profile: 'BALANCED', customTemperature: null, temperature: 0.7 };
        case 'prompt_manager_get':
          return { schemaVersion: 1, revision: 0, activePresetId: null, presets: [] };
        case 'model_settings_get':
          return {
            profiles: [
              {
                id: 'rc-model-profile',
                providerId: 'rc-provider',
                presetKey: 'custom',
                providerDisplayName: 'RC Provider',
                baseUrl: 'https://example.invalid/v1/',
                endpointFingerprint: null,
                hasCredential: true,
                modelName: 'rc-model',
                modelDisplayName: 'RC Model',
                capabilities: {
                  text: true,
                  streaming: false,
                  systemMessages: true,
                  jsonMode: true,
                  jsonSchema: true,
                  toolCalling: false,
                  reasoning: false,
                  contextWindowTokens: 64000,
                  costStatus: 'UNKNOWN',
                  checkedAt: timestamp,
                },
                capabilitySource: 'PROVIDER_RESPONSE',
                probeFingerprint: null,
              },
            ],
            defaultModelProfileId: 'rc-model-profile',
            fallbackModelProfileId: null,
            pendingCredentialCleanupCount: 0,
          };
        case 'ai_generate':
          await new Promise((resolve) => setTimeout(resolve, 300));
          throw JSON.stringify({ code: audit.mode, message: 'controlled browser validation' });
        default:
          throw new Error(`Unexpected invalid-output browser command: ${command}`);
      }
    },
  };
  return { installed: true };
})()
