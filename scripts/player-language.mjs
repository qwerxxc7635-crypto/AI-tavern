import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const PLAYER_ATTRIBUTE_NAMES = new Set([
  'alt',
  'aria-label',
  'description',
  'detail',
  'eyebrow',
  'label',
  'note',
  'placeholder',
  'title',
]);
const PLAYER_MESSAGE_CALLS = new Set([
  'confirm',
  'setError',
  'setLoadError',
  'setStatus',
  'setTransferNotice',
]);
const ALLOWED_WORDS = new Set(
  [
    'AI',
    'API',
    'Base',
    'Candidate',
    'ContextBlock',
    'D20',
    'DeepSeek',
    'Ember',
    'Event',
    'Fake',
    'Flash',
    'HTTP',
    'HTTPS',
    'Key',
    'Ledger',
    'NPC',
    'Ollama',
    'OpenAI',
    'OpenRouter',
    'Prompt',
    'Provider',
    'Qwen',
    'SQLite',
    'Tavern',
    'URL',
    'V4',
    'Windows',
    'macOS',
    'model',
    'emtavern',
    'v',
    'zh',
    'CN',
  ].map((word) => word.toLowerCase()),
);

export async function inspectPlayerLanguage(root) {
  const findings = [];
  const sourceRoot = resolve(root, 'windows-app/src');
  for (const path of await sourceFiles(sourceRoot)) {
    if (!path.endsWith('.tsx') || path.includes('.test.')) continue;
    const source = await readFile(path, 'utf8');
    findings.push(...inspectSource(source, relative(root, path), ts.ScriptKind.TSX));
  }

  const resourcePath = resolve(sourceRoot, 'localization/zh-CN.ts');
  findings.push(
    ...inspectResource(
      await readFile(resourcePath, 'utf8'),
      relative(root, resourcePath),
      ts.ScriptKind.TS,
    ),
  );
  findings.push(
    ...inspectPlainText(await readFile(resolve(root, 'CHANGELOG.md'), 'utf8'), 'CHANGELOG.md'),
  );
  const releaseInfo = JSON.parse(await readFile(resolve(root, 'release-info.json'), 'utf8'));
  for (const [index, highlight] of (releaseInfo.highlights ?? []).entries()) {
    if (typeof highlight === 'string') {
      findings.push(...findingForText(highlight, 'release-info.json', index + 1));
    }
  }
  return findings;
}

export function inspectSource(source, path = 'source.tsx', scriptKind = ts.ScriptKind.TSX) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];
  walk(file, (node) => {
    if (ts.isJsxText(node)) addNodeText(node.getText(file), node);
    if (ts.isJsxAttribute(node) && PLAYER_ATTRIBUTE_NAMES.has(node.name.getText(file))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        addNodeText(node.initializer.text, node.initializer);
      } else if (node.initializer && ts.isJsxExpression(node.initializer)) {
        collectRenderedExpression(node.initializer.expression, addNodeText);
      }
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      collectRenderedExpression(node.expression, addNodeText);
    }
    if (ts.isCallExpression(node) && isPlayerMessageCall(node.expression)) {
      collectRenderedExpression(node.arguments[0], addNodeText);
    }
  });
  return findings;

  function addNodeText(text, node) {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push(...findingForText(text, path, line));
  }
}

export function inspectResource(source, path = 'zh-CN.ts', scriptKind = ts.ScriptKind.TS) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];
  walk(file, (node) => {
    if (ts.isPropertyAssignment(node)) addExpression(node.initializer);
    if (ts.isReturnStatement(node)) addExpression(node.expression);
  });
  return findings;

  function addExpression(expression) {
    if (!expression || !isTextExpression(expression)) return;
    const line = file.getLineAndCharacterOfPosition(expression.getStart(file)).line + 1;
    findings.push(...findingForText(textOf(expression), path, line));
  }
}

export function inspectPlainText(source, path = 'text.md') {
  return source.split(/\r?\n/u).flatMap((line, index) => findingForText(line, path, index + 1));
}

export function unexpectedEnglishWords(text) {
  const scrubbed = text
    .replaceAll(/https?:\/\/\S+/giu, '')
    .replaceAll(/(?:^|\s)[/#.]?[a-z0-9_-]+(?:[/.:-][a-z0-9_-]+)+(?:\s|$)/giu, ' ')
    .replaceAll(/\b[a-z][a-z0-9]*(?:[-_.:/][a-z0-9]+)+\b/giu, ' ');
  return [...scrubbed.matchAll(/[A-Za-z][A-Za-z0-9]*/gu)]
    .map(([word]) => word)
    .filter((word) => word.length > 1 && !ALLOWED_WORDS.has(word.toLowerCase()));
}

function findingForText(text, path, line) {
  const words = [...new Set(unexpectedEnglishWords(text))];
  return words.length === 0 ? [] : [{ path, line, text: text.trim(), words }];
}

function collectRenderedExpression(expression, add) {
  if (!expression) return;
  if (isTextExpression(expression)) {
    add(textOf(expression), expression);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    collectRenderedExpression(expression.whenTrue, add);
    collectRenderedExpression(expression.whenFalse, add);
  }
}

function isTextExpression(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

function textOf(node) {
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map(({ literal }) => literal.text)].join(' ');
  }
  return node.text;
}

function isPlayerMessageCall(expression) {
  const name = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : '';
  return PLAYER_MESSAGE_CALLS.has(name);
}

function walk(node, visitor) {
  visitor(node);
  node.forEachChild((child) => walk(child, visitor));
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files.sort();
}
