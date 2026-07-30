import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'windows-app/**/*.{test,spec}.{ts,tsx}',
      'ios-app/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
    ],
  },
});
