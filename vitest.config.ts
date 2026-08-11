import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Full-suite Windows runners can spend over 30 seconds in the heaviest real-SQLite
    // integration cases under contention. Assertions stay unchanged and still fail closed.
    testTimeout: process.platform === 'win32' ? 60_000 : 5_000,
    hookTimeout: process.platform === 'win32' ? 30_000 : 10_000,
    include: [
      'windows-app/**/*.{test,spec}.{ts,tsx}',
      'ios-app/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
    ],
  },
});
