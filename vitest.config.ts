import { defineConfig } from 'vitest/config'
import { esbuildDecorators } from './vitest.shared'

export default defineConfig({
  plugins: [esbuildDecorators()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 90, branches: 85, functions: 85, lines: 90 },
    },
  },
})
