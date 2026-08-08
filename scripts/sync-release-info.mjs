import { syncReleaseVersion } from './release-version.mjs';

const version = await syncReleaseVersion();
process.stdout.write(`Synchronized Ember Tavern release metadata to ${version}.\n`);
