import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * A consumer imports one capability and bundles for production (minified, tree-shaken). What ends up in the bundle
 * is what that import costs. Every capability is a separate entry (`src/<entry>.ts`), and none of them may drag in
 * code it does not need: a marker string stands for a module, and the table says which modules must be absent.
 */
const root = resolve(__dirname, '..') + '/'

const MARKERS = {
  model: 'the model is frozen (makeFreeze)',
  collection: 'ActiveCollection cannot have holes',
  map: 'ActiveMap.create() needs a class',
  set: 'ActiveSet.create() needs a class',
  decimal: 'Cannot make a Decimal from',
  money: 'Not a money value',
  date: 'Not an ISO date',
  lodash: '__lodash_hash_undefined__',
} as const

type Marker = keyof typeof MARKERS
const everything = Object.keys(MARKERS) as Marker[]
const without = (...keep: Marker[]) => everything.filter((marker) => !keep.includes(marker))

const bundle = async (name: string, entry: string) => {
  const result = await build({
    stdin: { contents: `import { ${name} } from '${root}src/${entry}'; console.log(${name})`, resolveDir: root, loader: 'ts' },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    platform: 'browser',
    target: 'es2018',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  })
  const code = result.outputFiles[0].text
  return { code, bytes: code.length, gzip: gzipSync(code).length }
}

/** [exported name, entry, markers that may be present, max minified bytes] */
const CASES: Array<[string, string, Marker[], number]> = [
  ['EventType', 'types', [], 600],
  ['ValidationError', 'pipeline', [], 800],
  ['isCollection', 'collectionRegistry', [], 300],
  ['CallableModel', 'CallableModel', [], 600],
  ['Decimal', 'scalars/Decimal', ['decimal'], 4500],
  ['Money', 'scalars/Money', ['decimal', 'money'], 8000],
  ['LocalDate', 'scalars/LocalDate', ['date'], 3500],
  ['markImmutable', 'scalars/immutable', [], 500],
  ['ActiveModel', 'ActiveModel', ['model'], 32_000],
  ['ActiveField', 'decorators', ['model'], 36_000],
  ['ActiveCollection', 'ActiveCollection', ['model', 'collection'], 43_000],
  ['ActiveMap', 'ActiveMap', ['model', 'map'], 37_000],
  ['ActiveSet', 'ActiveSet', ['model', 'set'], 36_000],
]

describe('tree-shaking: an import costs only what it needs', () => {
  for (const [name, entry, allowed, budget] of CASES) {
    it(`${name} from "${entry}"`, async () => {
      const { code, bytes } = await bundle(name, entry)
      for (const marker of without(...allowed)) {
        expect(code.includes(MARKERS[marker]), `${name} must not bundle the "${marker}" module`).toBe(false)
      }
      for (const marker of allowed) {
        expect(code.includes(MARKERS[marker]), `${name} should bundle the "${marker}" module (marker stale?)`).toBe(true)
      }
      expect(bytes, `${name}: ${bytes} bytes minified`).toBeLessThan(budget)
    })
  }

  it('the model does not need a deep-clone library (and the marker would notice one)', async () => {
    const { code } = await bundle('ActiveModel', 'ActiveModel')
    expect(code.includes(MARKERS.lodash)).toBe(false)
    const lodash = await build({
      stdin: { contents: "import c from 'lodash-es/cloneDeep'; console.log(c)", resolveDir: root, loader: 'ts' },
      bundle: true, minify: true, write: false, format: 'esm', platform: 'browser',
    })
    expect(lodash.outputFiles[0].text.includes(MARKERS.lodash)).toBe(true)
  })

  it('the package has no runtime dependencies', async () => {
    const manifest = JSON.parse(await readFile(`${root}package.json`, 'utf8'))
    expect(manifest.dependencies ?? {}).toEqual({})
    expect(manifest.sideEffects).toBe(false)
  })

  it('a bundle that imports Money alone does not contain the model', async () => {
    const { gzip } = await bundle('Money', 'scalars/Money')
    expect(gzip).toBeLessThan(3000)
  })
})
