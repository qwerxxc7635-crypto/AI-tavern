import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPlayerLanguage } from './player-language.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const findings = await inspectPlayerLanguage(root);
if (findings.length > 0) {
  for (const finding of findings) {
    process.stderr.write(
      `${finding.path}:${finding.line}: unexpected player-facing English [${finding.words.join(', ')}] in ${JSON.stringify(finding.text)}\n`,
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Player-facing English regression gate passed for zh-CN.\n');
}
