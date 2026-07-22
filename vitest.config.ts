import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
