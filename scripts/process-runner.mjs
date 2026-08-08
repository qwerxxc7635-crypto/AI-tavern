import { spawnSync } from 'node:child_process';

export function runProcess(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function runPnpm(args) {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (!pnpmEntrypoint) {
    throw new Error('Run this script through pnpm so npm_execpath is available.');
  }
  runProcess(process.execPath, [pnpmEntrypoint, ...args]);
}
