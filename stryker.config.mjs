// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: true },
  mutate: ['src/**/*.ts', '!src/types.ts', '!src/index.ts', '!src/Enum.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  thresholds: { high: 95, low: 90, break: 90 },
  ignoreStatic: true,
  ignorePatterns: ['graphify-out', '.claude', 'docs', 'reports', 'dist'],
  timeoutMS: 10000,
  concurrency: 4,
}
