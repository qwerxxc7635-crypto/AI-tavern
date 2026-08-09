import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: process.platform === 'win32' ? 30_000 : 5_000,
    hookTimeout: process.platform === 'win32' ? 30_000 : 10_000,
    include: [
      'windows-app/**/*.{test,spec}.{ts,tsx}',
      'ios-app/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
    ],
  },
});
