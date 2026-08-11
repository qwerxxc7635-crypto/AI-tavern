import { checkReleaseVersion } from './release-version.mjs';

const version = await checkReleaseVersion();
process.stdout.write(`Release metadata is synchronized at ${version}.\n`);
