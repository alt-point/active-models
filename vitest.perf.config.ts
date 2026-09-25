import { defineConfig } from 'vitest/config'
import { esbuildDecorators } from './vitest.shared'

// Performance budgets and benchmarks. Kept out of the default `test` run:
// timings are noisy and the memory checks need `--expose-gc`.
export default defineConfig({
  plugins: [esbuildDecorators()],
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    benchmark: { include: ['tests/perf/**/*.bench.ts'] },
    environment: 'node',
    execArgv: ['--expose-gc'],
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
