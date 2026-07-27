import { defineConfig, type Plugin } from 'vitest/config'
import * as esbuild from 'esbuild'

/**
 * Vite 8 defaults its TS transform to oxc, which (as of this writing) does
 * not support the legacy `experimentalDecorators` syntax this package uses,
 * and Vite's own `esbuild`/`oxc` toggle no longer reliably falls back to
 * esbuild for it either. Transform `.ts` files with esbuild directly instead
 * - the same tool `tsup` uses to build `dist/`, so tests exercise the exact
 * compilation semantics the published package ships with (legacy-decorator
 * transpilers are not interchangeable here: class-field/Proxy timing differs
 * subtly between esbuild and e.g. SWC).
 */
function esbuildDecorators (): Plugin {
  return {
    name: 'esbuild-legacy-decorators',
    enforce: 'pre',
    async transform (code, id) {
      if (!id.endsWith('.ts')) return null
      const result = await esbuild.transform(code, {
        loader: 'ts',
        target: 'es2018',
        sourcemap: true,
        sourcefile: id,
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
            target: 'ES2018',
          },
        },
      })
      return { code: result.code, map: result.map }
    },
  }
}

export default defineConfig({
  plugins: [esbuildDecorators()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
