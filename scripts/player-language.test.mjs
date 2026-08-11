import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectPlainText,
  inspectResource,
  inspectSource,
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
