import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const tsupConfig = readFileSync(resolve(root, 'tsup.config.ts'), 'utf8')

const exportsMap = manifest.exports as Record<string, { source: string, import: { types: string, default: string }, require: { types: string, default: string } }>
const subpaths = Object.keys(exportsMap)
const tsupEntries = [...tsupConfig.matchAll(/'src\/([\w/]+)\.ts'/g)].map((match) => match[1])

describe('package entry points', () => {
  it('has no barrel: every capability is imported from its own subpath', () => {
    expect(existsSync(resolve(root, 'src/index.ts'))).toBe(false)
    expect(subpaths).not.toContain('.')
    expect(manifest.main).toBeUndefined()
    expect(manifest.module).toBeUndefined()
    expect(manifest.types).toBeUndefined()
  })

  it('exports one subpath per tsup entry, and nothing else', () => {
    expect(subpaths.map((subpath) => subpath.replace(/^\.\//, '')).sort()).toEqual([...tsupEntries].sort())
  })

  it('points every subpath at its source file and at ESM, CJS and type outputs of the same name', () => {
    for (const [subpath, target] of Object.entries(exportsMap)) {
      const name = subpath.replace(/^\.\//, '')
      expect(existsSync(resolve(root, target.source)), `${subpath} source`).toBe(true)
      expect(target.source).toBe(`./src/${name}.ts`)
      expect(target.import).toEqual({ types: `./dist/${name}.d.mts`, default: `./dist/${name}.mjs` })
      expect(target.require).toEqual({ types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` })
    }
  })

  it('maps the same subpaths for TypeScript with the legacy "node" module resolution', () => {
    const versions = manifest.typesVersions['*'] as Record<string, string[]>
    expect(Object.keys(versions).sort()).toEqual([...tsupEntries].sort())
    for (const [name, [file]] of Object.entries(versions)) {
      expect(file).toBe(`dist/${name}.d.ts`)
    }
  })

  it('ships the sources and has nothing but pure modules (tree-shakable)', () => {
    expect(manifest.sideEffects).toBe(false)
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', 'src']))
    expect(manifest.dependencies ?? {}).toEqual({})
  })

  it('keeps internals private: modules that are not entries are not exported', () => {
    for (const internal of ['meta', 'emitter', 'history', 'equal', 'clone', 'collectionCore', 'mapper']) {
      expect(subpaths, internal).not.toContain(`./${internal}`)
    }
  })

  it('ships the migration CLI as a bin', () => {
    expect(manifest.bin).toEqual({ 'active-models': './bin/active-models.mjs' })
    expect(existsSync(resolve(root, 'bin/active-models.mjs'))).toBe(true)
    expect(manifest.files).toContain('bin')
  })
})
