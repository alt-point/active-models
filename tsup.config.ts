import { defineConfig } from 'tsup'

// One entry per public subpath of package.json "exports" (there is no root entry): every capability is imported
// on its own, so a bundler only ever sees the modules it needs. tests/package-entries.test.ts keeps both lists equal.
export default defineConfig({
  entry: [
    'src/ActiveModel.ts',
    'src/decorators.ts',
    'src/types.ts',
    'src/ActiveCollection.ts',
    'src/ActiveMap.ts',
    'src/ActiveSet.ts',
    'src/collectionRegistry.ts',
    'src/pipeline.ts',
    'src/CallableModel.ts',
    'src/Enum.ts',
    'src/utils.ts',
    'src/scalars/Decimal.ts',
    'src/scalars/Money.ts',
    'src/scalars/LocalDate.ts',
    'src/scalars/immutable.ts'
  ],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
})
