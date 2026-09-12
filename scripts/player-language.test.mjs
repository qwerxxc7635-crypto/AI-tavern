import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectPlainText,
  inspectResource,
  inspectSource,
  unsafePlayerLeakageTokens,
  unexpectedEnglishWords,
} from './player-language.mjs';

test('rejects English in rendered copy, accessibility labels and status messages', () => {
  const findings = inspectSource(`
    function Example() {
      setStatus('Connection failed');
      return <button aria-label="Save archive">Save changes</button>;
    }
  `);
  assert.deepEqual([...new Set(findings.flatMap(({ words }) => words))].sort(), [
    'Connection',
    'Save',
    'archive',
    'changes',
    'failed',
  ]);
});

test('allows documented provider, model, API, URL and player terminology', () => {
  assert.deepEqual(
    unexpectedEnglishWords(
      'DeepSeek Provider · deepseek-v4-flash · API Key · Base URL https://api.deepseek.com · NPC · D20 · SQLite · Ember Tavern',
    ),
    [],
  );
});

test('scans resource values and changelog text without treating machine cases as copy', () => {
  assert.equal(
    inspectResource(`
      const copy = { title: 'Open archive', safe: '打开存档' };
      function label(value) {
        switch (value) { case 'editing': return '编辑中'; default: return 'Unknown state'; }
      }
    `).length,
    2,
  );
  assert.equal(inspectPlainText('# 更新日志\n\n- Added settings').length, 1);
});

test('rejects combat outcome tokens, raw enums, error codes and stack traces in player copy', () => {
  const findings = inspectSource(
    `
    function UnsafeResult() {
      return <section aria-label="COMBAT_RESULT_ERROR">MISS CRITICAL HIT Health Mana{` +
      '`TypeError: failed\n    at render (combat.tsx:4:2)`' +
      `}</section>;
    }
  `,
  );
  const words = new Set(findings.flatMap(({ words: leaked }) => leaked));
  for (const token of [
    'MISS',
    'CRITICAL',
    'HIT',
    'Health',
    'Mana',
    'COMBAT_RESULT_ERROR',
    '错误堆栈',
    '调用堆栈',
  ]) {
    assert.equal(words.has(token), true, `${token} should be rejected`);
  }
});

test('does not mistake Chinese combat copy or machine-only values for player leakage', () => {
  assert.deepEqual(unsafePlayerLeakageTokens('胜利 · 生命 · 法力 · 未命中 · 暴击'), []);
  assert.equal(
    inspectSource(`const kind = 'SCRIPTED_VICTORY'; const code = 'COMBAT_RESULT_ERROR';`).length,
    0,
  );
});
