/* global window, setTimeout */

(() => {
  const timestamp = '2026-08-29T04:30:00.000Z';
  const campaign = {
    id: 'rc-browser-campaign-0001',
    state: 'CREATING_WORLD',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const calls = [];
  const counters = Object.create(null);
  let generationAttempt = 0;

  window.__EMBER_RC_BROWSER_AUDIT__ = { calls, counters, campaign };
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args = {}) => {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
      counters[command] = (counters[command] ?? 0) + 1;
      switch (command) {
        case 'campaign_list':
          return [];
        case 'campaign_create':
          await new Promise((resolve) => setTimeout(resolve, 250));
          return campaign;
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
          generationAttempt += 1;
          await new Promise((resolve) => setTimeout(resolve, generationAttempt === 1 ? 250 : 900));
          throw JSON.stringify({ code: 'TIMEOUT', message: 'controlled browser audit timeout' });
        default:
          throw new Error(`Unexpected browser-audit command: ${command}`);
      }
    },
  };
  return { installed: true };
})()
