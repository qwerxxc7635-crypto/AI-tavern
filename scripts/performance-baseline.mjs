import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { runPnpm } from './process-runner.mjs';

const options = parseArguments(process.argv.slice(2));
const outputPath = resolve(options.output);
if (existsSync(outputPath)) {
  throw new Error(`Refusing to overwrite an existing baseline: ${outputPath}`);
}
mkdirSync(dirname(outputPath), { recursive: true });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();

runPnpm(
  [
    'exec',
    'vitest',
    'run',
    'packages/ai-core/src/performance-baseline-runner.test.ts',
    '--maxWorkers=1',
  ],
  {
    EMBER_PERFORMANCE_BASELINE_OUTPUT: outputPath,
    EMBER_PERFORMANCE_BASELINE_ITERATIONS: String(options.iterations),
    EMBER_PERFORMANCE_BASELINE_COMMIT: sourceCommit,
  },
);

const report = JSON.parse(readFileSync(outputPath, 'utf8'));
if (
  report?.evidenceKind !== 'FAKE' ||
  report?.realProviderStatus !== 'NOT_RUN' ||
  report?.sourceCommit !== sourceCommit
) {
  throw new Error('Generated performance baseline identity is inconsistent');
}
process.stdout.write(`Fake Provider performance baseline written to ${outputPath}\n`);

function parseArguments(args) {
  let output;
  let iterations = 10;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--output') output = value;
    else if (flag === '--iterations') iterations = Number(value);
    else throw new Error(`Unknown performance baseline option: ${flag}`);
  }
  if (typeof output !== 'string' || output.length === 0) {
    throw new Error('Use --output <new-json-path> for the baseline report');
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new Error('Performance baseline iterations must be an integer from 1 to 20');
  }
  return { output, iterations };
}
