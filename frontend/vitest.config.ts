import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Tests for the pure logic under `src/lib` — the parts worth trusting that
 * don't need a React Native renderer. Everything device-shaped
 * (AsyncStorage) is stubbed per test file.
 *
 * Screens and components are covered by the Playwright e2e suite in `e2e/`,
 * which drives the real web build against a real API rather than a mock tree.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // React Native's entrypoint is Flow-typed and unparseable by Node. The
      // pure modules under test only use Platform; see the stub's comment.
      'react-native': path.resolve(__dirname, 'src/test/react-native-stub.ts'),
    },
  },
});
