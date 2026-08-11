import { runPnpm } from './process-runner.mjs';

runPnpm(['--filter', '@ember-tavern/windows-app', 'build']);
