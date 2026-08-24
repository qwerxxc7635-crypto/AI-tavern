import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const theme = source('theme.css');
const primitives = source('ui/primitives.css');
const gameComponents = source('ui/game-components.css');

describe('M10-T07 visual convergence matrix', () => {
  it.each([
    ['tavern-page.tsx', ['NpcCard', 'DialogueView', 'ActionComposer']],
    ['npc-dialogue-page.tsx', ['DialogueView', 'ActionComposer']],
    ['quest-board-page.tsx', ['QuestCard']],
    ['adventure-page.tsx', ['ActionComposer', 'D20Animation']],
    ['universal-character-ai-field.tsx', ['AIFieldAssist']],
    ['d20-animation.tsx', ['Button']],
  ])('reuses shared game and UI contracts in %s', (file, contracts) => {
    const page = source(file);
    for (const contract of contracts) expect(page, contract).toContain(`<${contract}`);
  });

  it.each([
    '.character-studio',
    '.dialogue-room',
    '.quest-board-page',
    '.adventure-page',
    '.tavern-room',
    '.model-settings',
    '.my-hub',
    '.archive-page',
  ])('keeps the %s feature boundary in the converged theme', (selector) => {
    expect(theme).toContain(selector);
  });

  it('covers loading, streaming, toast, empty, error and selected states', () => {
    for (const contract of [
      '.ui-spinner',
      '.ui-skeleton',
      '.ui-toast--error',
      '.ui-state',
      '.ui-state--error',
      "[aria-invalid='true']",
    ]) {
      expect(primitives, contract).toContain(contract);
    }
    for (const contract of [
      '.game-action-composer__stream',
      '.game-dialogue__message--system',
      '.game-npc-card.is-selected',
      "[aria-pressed='true']",
      "[data-state='ERROR']",
    ]) {
      expect(gameComponents, contract).toContain(contract);
    }
  });
});
