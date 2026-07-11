import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],      // оба формата
  dts: true,                    // генерация .d.ts
  splitting: true,              // code splitting для ESM
  sourcemap: true,
  clean: true,
  treeshake: true,
})
