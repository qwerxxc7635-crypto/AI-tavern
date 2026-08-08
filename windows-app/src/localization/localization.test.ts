// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ACTIVE_LOCALE, installDocumentLocale, playerText } from './index.js';

describe('zh-CN player resource layer', () => {
  it('provides one explicit locale without a silent fallback', () => {
    expect(ACTIVE_LOCALE).toBe('zh-CN');
    expect(playerText.navigation.tavern).toBe('酒馆');
    expect(playerText.titlebar.campaign('12345678')).toBe('存档 12345678');
    expect(collectStaticMessages(playerText).every((message) => message.trim().length > 0)).toBe(
      true,
    );
  });

  it('installs the locale on the document root for assistive technology', () => {
    const documentValue = document.implementation.createHTMLDocument('Ember Tavern');
    documentValue.documentElement.lang = 'en';

    installDocumentLocale(documentValue);

    expect(documentValue.documentElement.lang).toBe('zh-CN');
  });
});

function collectStaticMessages(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStaticMessages);
}
