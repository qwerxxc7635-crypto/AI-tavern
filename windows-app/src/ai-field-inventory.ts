import { UNIVERSAL_CHARACTER_AI_FIELDS } from './universal-character-ai.js';

export const NATURAL_LANGUAGE_FIELDS = [
  ['world-options-concept', 'world-creation-page.tsx', 'WORLD_DRAFT'],
  ['world-options-excluded-content', 'world-creation-page.tsx', 'WORLD_DRAFT'],
  ['world-name', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-current-region', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-summary', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-core-conflict', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-technology-level', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-power-rules', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-narrative-style', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-forbidden-elements', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-tavern-reason', 'world-creation-page.tsx', 'WORLD_LOCKABLE'],
  ['world-revision', 'world-creation-page.tsx', 'WORLD_REVISION'],
  ...UNIVERSAL_CHARACTER_AI_FIELDS.map(
    ({ path }) =>
      [`character:${path}`, 'universal-character-creation-page.tsx', 'CHARACTER_DRAFT'] as const,
  ),
  ['npc-dialogue-free-input', 'npc-dialogue-page.tsx', 'ACTION_COMPOSER'],
  ['adventure-free-input', 'adventure-page.tsx', 'ACTION_COMPOSER'],
] as const;

export type NaturalLanguageFieldId = (typeof NATURAL_LANGUAGE_FIELDS)[number][0];
