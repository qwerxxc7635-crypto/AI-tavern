import { runPnpm, runProcess } from './process-runner.mjs';

for (const script of ['format:check', 'lint', 'typecheck', 'test']) {
  runPnpm([script]);
}

runProcess('cargo', ['fmt', '--all', '--', '--check']);
runProcess('cargo', [
  'clippy',
  '--workspace',
  '--all-targets',
  '--all-features',
  '--',
  '-D',
  'warnings',
]);
runProcess('cargo', ['test', '--workspace']);
