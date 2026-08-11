import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = requiredArgument('--root');
const output = requiredArgument('--output');
const files = collectFiles(root).map((path) => ({
  path: relative(process.cwd(), path).split(sep).join('/'),
  bytes: lstatSync(path).size,
  sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
}));
if (files.length === 0) throw new Error(`No release artifacts found below ${root}`);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      root: relative(process.cwd(), root).split(sep).join('/'),
      files,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release evidence rejects symlink: ${path}`);
      if (entry.isDirectory()) return collectFiles(path);
      return entry.isFile() ? [path] : [];
    });
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}`);
  return resolve(process.argv[index + 1]);
}
