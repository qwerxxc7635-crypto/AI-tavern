import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runPnpm } from './process-runner.mjs';

const outputDirectory = resolve(parseArguments(process.argv.slice(2)).outputDirectory);
const jsonPath = resolve(outputDirectory, 'performance-regression.json');
const markdownPath = resolve(outputDirectory, 'performance-regression.md');
for (const outputPath of [jsonPath, markdownPath]) {
  if (existsSync(outputPath)) {
    throw new Error(`Refusing to overwrite an existing performance report: ${outputPath}`);
  }
}
mkdirSync(outputDirectory, { recursive: true });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();

runPnpm(
  [
    'exec',
    'vitest',
    'run',
    'packages/persistence/src/performance-regression-runner.test.ts',
    '--maxWorkers=1',
  ],
  {
    EMBER_PERFORMANCE_GATE_JSON: jsonPath,
    EMBER_PERFORMANCE_GATE_MARKDOWN: markdownPath,
    EMBER_PERFORMANCE_GATE_COMMIT: sourceCommit,
  },
);

const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
if (
  report?.schemaVersion !== 1 ||
  report?.sourceCommit !== sourceCommit ||
  report?.baselineCommit !== '589ef756c4df3b552a1b8c7cbf5b8da34c8793f5' ||
  report?.passed !== true
) {
  throw new Error('Generated performance regression report failed its identity or threshold gate');
}
process.stdout.write(`Performance regression gate passed; reports written to ${outputDirectory}\n`);

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== '--output-dir' || args[1]?.length === 0) {
    throw new Error('Use --output-dir <new-or-empty-directory> for performance reports');
  }
  return { outputDirectory: args[1] };
}
