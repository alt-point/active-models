import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EXPORT_MAP, PACKAGE, collectFiles, maskCode, migratePaths, migrateSource, migrateVue } from '../bin/migrate.mjs'

const root = resolve(__dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const migrate = (code: string, options?: { api?: boolean }) => migrateSource(code, options)

const ROOT_EXPORTS_4_0_0 = [
  'ActiveModel', 'InvariantCheck', 'CallableModel', 'ActiveCollection', 'CollectionInput', 'ActiveMap', 'ActiveSet', 'isCollection',
  'ValidationError', 'ValidationIssue', 'ValidationResult', 'ValidationCode', 'FieldRules', 'Transform', 'Transitions', 'CoerceTo',
  'ValueType', 'GetterMethod', 'InvariantMethod', 'SetterMethod', 'isHidden', 'isFillable', 'isProtected', 'ActiveFactory',
  'ActiveField', 'Enum', 'ModelProperties', 'RecursivePartialActiveModel', 'Decimal', 'DecimalInput', 'RoundingMode', 'Money',
  'minorUnits', 'LocalDate', 'Coercible', 'Bound', 'markImmutable', 'EventType', 'ActiveFieldDescriptor', 'ActiveModelHookListener',
  'ActiveModelSource', 'AnyClassInstance', 'AttributeValue', 'CollectionEventPayload', 'CollectionOptions', 'ConstructorType',
  'DeleteEventPayload', 'EnumItemType', 'EventListener', 'EventPayloads', 'FactoryBase', 'FactoryConfig', 'FactoryOptions', 'Getter',
  'HandlerMapTo', 'InstanceEventPayload', 'KeyOf', 'MapOptions', 'MapSource', 'MapTarget', 'MapToMapper', 'PropEvent',
  'SetEventPayload', 'SetOptions', 'Setter', 'Validator',
]

const exportedNames = (subpath: string): Set<string> => {
  const source = readFileSync(resolve(root, `src/${subpath}.ts`), 'utf8')
  const names = new Set<string>()
  for (const match of source.matchAll(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|enum|type|interface)\s+(\w+)/gm)) names.add(match[1])
  for (const match of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/gm)) {
    for (const part of match[1].split(',')) if (part.trim()) names.add(part.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, ''))
  }
  return names
}

describe('migrate: the export map', () => {
  it('points every name at a subpath that really exports it', () => {
    const wrong = Object.entries(EXPORT_MAP).filter(([name, subpath]) => !manifest.exports[`./${subpath}`] || !exportedNames(subpath).has(name))
    expect(wrong).toEqual([])
  })

  it('covers everything the 4.0.0 root entry exported', () => {
    expect(ROOT_EXPORTS_4_0_0.filter((name) => !(name in EXPORT_MAP))).toEqual([])
  })
})

describe('maskCode', () => {
  it('blanks comments, strings, templates and regexps but keeps positions, quotes and newlines', () => {
    const code = "const a = 'x.collection('; // y.collection(\nconst b = `z.collection(`; const c = /['\"]q/g; /* w.collection( */ d.collection(\n"
    const masked = maskCode(code)
    expect(masked.length).toBe(code.length)
    expect(masked.includes('x.collection')).toBe(false)
    expect(masked.includes('y.collection')).toBe(false)
    expect(masked.includes('z.collection')).toBe(false)
    expect(masked.includes('w.collection')).toBe(false)
    expect(masked.includes('d.collection(')).toBe(true)
    expect(masked.split('\n').length).toBe(code.split('\n').length)
  })

  it('does not mistake division or JSX apostrophes for the start of a literal', () => {
    expect(maskCode('const r = a / b; const s = c / d; Task.collection()')).toContain('Task.collection()')
    expect(maskCode("const el = <p>it's</p>\nTask.collection()")).toContain('Task.collection()')
  })
})

describe('migrate: imports', () => {
  it('splits a root import into subpath imports, keeping aliases, type modifiers, quotes and the semicolon', () => {
    const { code } = migrate(`import { ActiveModel, ActiveField as Field, type FactoryOptions, EventType } from "${PACKAGE}";\n`)
    expect(code).toBe([
      `import { ActiveModel } from "${PACKAGE}/ActiveModel";`,
      `import { ActiveField as Field } from "${PACKAGE}/decorators";`,
      `import { type FactoryOptions, EventType } from "${PACKAGE}/types";`,
      '',
    ].join('\n'))
  })

  it('handles multi-line imports, `import type` and `export ... from`', () => {
    const { code } = migrate(`import {\n  ActiveModel,\n  Money,\n} from '${PACKAGE}'\nimport type { ValidationError, Decimal } from '${PACKAGE}'\nexport { ActiveCollection } from '${PACKAGE}'\n`)
    expect(code).toBe([
      `import { ActiveModel } from '${PACKAGE}/ActiveModel'`,
      `import { Money } from '${PACKAGE}/scalars/Money'`,
      `import type { ValidationError } from '${PACKAGE}/pipeline'`,
      `import type { Decimal } from '${PACKAGE}/scalars/Decimal'`,
      `export { ActiveCollection } from '${PACKAGE}/ActiveCollection'`,
      '',
    ].join('\n'))
  })

  it('keeps indentation and CRLF line endings', () => {
    const { code } = migrate(`  import { ActiveModel, EventType } from '${PACKAGE}'\r\n`)
    expect(code).toBe(`  import { ActiveModel } from '${PACKAGE}/ActiveModel'\r\n  import { EventType } from '${PACKAGE}/types'\r\n`)
  })

  it('rewrites destructured require() calls', () => {
    const { code } = migrate(`const { ActiveModel, ActiveField } = require('${PACKAGE}');\n`)
    expect(code).toBe(`const { ActiveModel } = require('${PACKAGE}/ActiveModel');\nconst { ActiveField } = require('${PACKAGE}/decorators');\n`)
  })

  it('leaves files that do not use the package, and imports that are already subpaths, alone', () => {
    const plain = "import { x } from 'other'\n"
    expect(migrate(plain).code).toBe(plain)
    const done = `import { ActiveModel } from '${PACKAGE}/ActiveModel'\n`
    expect(migrate(done)).toEqual({ code: done, changes: [], warnings: [] })
  })

  it('does not touch the package name inside comments and strings', () => {
    const code = `// import { ActiveModel } from '${PACKAGE}'\nconst s = "import { ActiveModel } from '${PACKAGE}'"\n`
    expect(migrate(code).code).toBe(code)
  })

  it('warns about forms it cannot rewrite, with the line', () => {
    const { code, warnings } = migrate(`import * as AM from '${PACKAGE}'\nconst lazy = () => import('${PACKAGE}')\njest.mock('${PACKAGE}')\n`)
    expect(code).toContain(`import * as AM from '${PACKAGE}'`)
    expect(warnings.map((warning) => warning.line)).toEqual([1, 2, 3])
    expect(warnings[0].message).toContain('by hand')
  })

  it('keeps an unknown name on the root import and warns', () => {
    const { code, warnings } = migrate(`import { ActiveModel, Gone } from '${PACKAGE}'\n`)
    expect(code).toBe(`import { ActiveModel } from '${PACKAGE}/ActiveModel'\nimport { Gone } from '${PACKAGE}'\n`)
    expect(warnings[0].message).toContain('Gone')
  })

  it('--imports-only leaves the collection API alone', () => {
    const source = `import { ActiveModel } from '${PACKAGE}'\nconst a = Task.collection([])\n`
    const { code } = migrate(source, { api: false })
    expect(code).toBe(`import { ActiveModel } from '${PACKAGE}/ActiveModel'\nconst a = Task.collection([])\n`)
  })
})

describe('migrate: the collection API', () => {
  const head = `import { ActiveModel, ActiveField } from '${PACKAGE}'\n`

  it('turns collection / map / set options into container and imports the class', () => {
    const { code, warnings } = migrate(`${head}class B extends ActiveModel {
  @ActiveField({ collection: [Task, { sortBy: 'id' }] }) a!: unknown
  @ActiveField({ collection: Task }) b!: unknown
  @ActiveField({ map: [User, { key: 'id' }], hidden: true }) c!: unknown
  @ActiveField({ set: [Tag, { unique: 'name' }] }) d!: unknown
  @ActiveField({ 'set': Tag }) e!: unknown
  @ActiveField({ collection: [
    Task,
    { sortBy: 'id' },
  ] }) f!: unknown
}
`)
    expect(warnings).toEqual([])
    expect(code).toContain(`@ActiveField({ container: ActiveCollection.field(Task, { sortBy: 'id' }) }) a`)
    expect(code).toContain('@ActiveField({ container: ActiveCollection.field(Task) }) b')
    expect(code).toContain(`@ActiveField({ container: ActiveMap.field(User, { key: 'id' }), hidden: true }) c`)
    expect(code).toContain(`@ActiveField({ container: ActiveSet.field(Tag, { unique: 'name' }) }) d`)
    expect(code).toContain('@ActiveField({ container: ActiveSet.field(Tag) }) e')
    expect(code).toMatch(/container: ActiveCollection\.field\(Task,\s+\{ sortBy: 'id' \}\)/)
    expect(code).toContain(`import { ActiveCollection } from '${PACKAGE}/ActiveCollection'`)
    expect(code).toContain(`import { ActiveMap } from '${PACKAGE}/ActiveMap'`)
    expect(code).toContain(`import { ActiveSet } from '${PACKAGE}/ActiveSet'`)
  })

  it('only looks at the top-level keys of ActiveField options', () => {
    const source = `${head}class B extends ActiveModel {\n  @ActiveField({ on: { afterSetValue: () => { const set = 1; return { map: [A], collection: B } } } }) a!: unknown\n}\n`
    expect(migrate(source).code).toContain('return { map: [A], collection: B }')
  })

  it('survives regular expressions with quotes inside the options', () => {
    const { code } = migrate(`${head}class B extends ActiveModel {\n  @ActiveField({ pattern: /["']\\//g, collection: Task }) a!: unknown\n}\n`)
    expect(code).toContain('container: ActiveCollection.field(Task)')
  })

  it('rewrites Model.collection() and Model.createCollection()', () => {
    const { code } = migrate(`${head}const a = Task.collection([{ id: 1 }], { sortBy: 'id' })\nconst b = Task.collection()\nconst c = Task.createCollection(rows, { tracked: true })\nconst d = Task.collection( items )\n`)
    expect(code).toContain("const a = ActiveCollection.create(Task, [{ id: 1 }], { sortBy: 'id' })")
    expect(code).toContain('const b = ActiveCollection.create(Task)')
    expect(code).toContain('const c = ActiveCollection.createFromData(Task, rows, { tracked: true })')
    expect(code).toContain('const d = ActiveCollection.create(Task, items )')
    expect(code).toContain(`import { ActiveCollection } from '${PACKAGE}/ActiveCollection'`)
  })

  it('does not rewrite look-alikes: other receivers, strings, comments', () => {
    const body = "db.collection('users')\nthis.collection()\nconst s = 'Task.collection()' // Task.collection()\nns.thing.collection()\n"
    const { code } = migrate(head + body)
    expect(code.endsWith(body)).toBe(true)
  })

  it('does not import a class twice', () => {
    const { code } = migrate(`import { ActiveModel, ActiveCollection } from '${PACKAGE}'\nconst a = Task.collection()\n`)
    expect(code.match(/ActiveCollection } from/g)).toHaveLength(1)
  })

  it('warns about shorthand, computed values and qualified classes', () => {
    const { code, warnings } = migrate(`${head}class B extends ActiveModel {
  @ActiveField({ collection }) a!: unknown
  @ActiveField({ map: makeMap() }) b!: unknown
}
const q = models.Task.collection()
`)
    expect(warnings.map((warning) => warning.line)).toEqual([3, 4, 6])
    expect(code).toContain('@ActiveField({ collection }) a')
    expect(code).toContain('map: makeMap()')
    expect(code).toContain('models.Task.collection()')
  })

  it('is idempotent', () => {
    const once = migrate(`${head}const a = Task.collection([])\nclass B extends ActiveModel { @ActiveField({ set: Tag }) t!: unknown }\n`).code
    expect(migrate(once)).toEqual({ code: once, changes: [], warnings: [] })
  })

  it('reports each change with its line', () => {
    const { changes } = migrate(`${head}\nconst a = Task.collection()\n`)
    expect(changes.map((change) => change.line)).toEqual([1, 3])
    expect(changes[1]).toMatchObject({ before: 'Task.collection(', after: 'ActiveCollection.create(Task' })
  })
})

describe('migrate: Vue single-file components', () => {
  it('rewrites the script blocks and leaves the template alone, with line numbers of the file', () => {
    const sfc = `<template>\n  <div>{{ Task.collection() }}</div>\n</template>\n\n<script setup lang="ts">\nimport { ActiveModel } from '${PACKAGE}'\nconst a = Task.collection()\n</script>\n`
    const { code, changes } = migrateVue(sfc)
    expect(code).toContain('<div>{{ Task.collection() }}</div>')
    expect(code).toContain(`import { ActiveModel } from '${PACKAGE}/ActiveModel'`)
    expect(code).toContain(`import { ActiveCollection } from '${PACKAGE}/ActiveCollection'`)
    expect(code).toContain('const a = ActiveCollection.create(Task)')
    expect(changes.map((change) => change.line)).toEqual([6, 7])
  })
})

describe('migrate: walking a directory', () => {
  const makeProject = () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-migrate-'))
    mkdirSync(join(dir, 'src/nested'), { recursive: true })
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true })
    mkdirSync(join(dir, 'dist'), { recursive: true })
    const old = `import { ActiveModel } from '${PACKAGE}'\nexport class A extends ActiveModel {}\n`
    writeFileSync(join(dir, 'src/a.ts'), old)
    writeFileSync(join(dir, 'src/nested/b.vue'), `<script>\n${old}</script>\n`)
    writeFileSync(join(dir, 'src/c.js'), old)
    writeFileSync(join(dir, 'src/readme.md'), old)
    writeFileSync(join(dir, 'src/manual.ts'), `import * as AM from '${PACKAGE}'\n`)
    writeFileSync(join(dir, 'node_modules/pkg/index.ts'), old)
    writeFileSync(join(dir, 'dist/out.js'), old)
    return { dir, old }
  }

  it('finds source files recursively and skips node_modules, dist and other extensions', () => {
    const { dir } = makeProject()
    const files = collectFiles([dir]).map((file) => file.slice(dir.length + 1)).sort()
    rmSync(dir, { recursive: true })
    expect(files).toEqual(['src/a.ts', 'src/c.js', 'src/manual.ts', 'src/nested/b.vue'])
  })

  it('does a dry run by default and writes only with write: true', () => {
    const { dir, old } = makeProject()
    const dry = migratePaths([dir], { cwd: dir })
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(old)
    expect(dry.files.filter((file) => file.changed).map((file) => file.file).sort()).toEqual(['src/a.ts', 'src/c.js', 'src/nested/b.vue'])
    expect(dry.files.find((file) => file.file === 'src/manual.ts')).toMatchObject({ changed: false, warnings: [{ line: 1 }] })

    const real = migratePaths([dir], { write: true, cwd: dir })
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toContain(`from '${PACKAGE}/ActiveModel'`)
    expect(readFileSync(join(dir, 'src/nested/b.vue'), 'utf8')).toContain(`from '${PACKAGE}/ActiveModel'`)
    expect(readFileSync(join(dir, 'node_modules/pkg/index.ts'), 'utf8')).toBe(old)
    expect(readFileSync(join(dir, 'src/readme.md'), 'utf8')).toBe(old)
    expect(real.scanned).toBe(4)
    expect(migratePaths([dir], { cwd: dir }).files.filter((file) => file.changed)).toEqual([])
    rmSync(dir, { recursive: true })
  })
})

describe('migrate: the CLI', () => {
  const cli = resolve(root, 'bin/active-models.mjs')
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

  it('prints help, rejects unknown commands and options', () => {
    expect(run('--help').stdout).toContain('Usage: active-models migrate')
    expect(run('nope').status).toBe(2)
    expect(run('migrate', '--bogus').status).toBe(2)
    expect(run('migrate', '--ext').status).toBe(2)
  })

  it('shows changes without writing, writes with --write, and --check fails when work is left', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-cli-'))
    const file = join(dir, 'a.ts')
    const old = `import { ActiveModel } from '${PACKAGE}'\n`
    writeFileSync(file, old)

    const check = run('migrate', dir, '--check')
    expect(check.status).toBe(1)
    expect(check.stdout).toContain('would update')
    expect(check.stdout).toContain('Run again with --write')
    expect(readFileSync(file, 'utf8')).toBe(old)

    const write = run('migrate', dir, '--write')
    expect(write.status).toBe(0)
    expect(write.stdout).toContain('updated')
    expect(readFileSync(file, 'utf8')).toBe(`import { ActiveModel } from '${PACKAGE}/ActiveModel'\n`)

    expect(run('migrate', dir, '--check').status).toBe(0)
    writeFileSync(file, `import * as AM from '${PACKAGE}'\n`)
    const manual = run('migrate', dir, '--check')
    expect(manual.status).toBe(1)
    expect(manual.stdout).toContain('MANUAL')
    rmSync(dir, { recursive: true })
  })
})

describe('migrate: the result compiles against the real 5.0 API', () => {
  it('migrates a 4.x-style project and type-checks it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-e2e-'))
    const tscBin = createRequire(resolve(root, 'package.json')).resolve('typescript/bin/tsc')
    writeFileSync(join(dir, 'models.ts'), `import {
  ActiveModel,
  ActiveField,
  ActiveCollection,
  ActiveMap,
  EventType,
  ValidationError,
  Money,
  type FactoryOptions,
} from '${PACKAGE}'

export class Task extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField({ coerce: Money }) price: Money = Money.of(1, 'USD')
}
export class User extends ActiveModel {
  @ActiveField() id: number = 0
}
export class Tag extends ActiveModel {
  @ActiveField() name: string = ''
}

export class Board extends ActiveModel {
  @ActiveField({ collection: [Task, { sortBy: 'id' }] }) tasks!: ActiveCollection<Task>
  @ActiveField({ map: [User, { key: 'id' }] }) users!: ActiveMap<User>
  @ActiveField({ set: [Tag, { unique: 'name' }] }) tags!: ActiveSet<Tag>
}

const options: FactoryOptions = { tracked: true }
export const sorted = Task.collection([{ id: 2 }, { id: 1 }], { sortBy: 'id' })
export const loaded = Task.createCollection([{ id: 3 }], { ...options, sortBy: 'id' })
export const board = Board.create({ tasks: [{ id: 1 }] }, options)
board.on(EventType.touched, () => undefined)
try { board.validate() } catch (error) { if (error instanceof ValidationError) console.log(error.issues) }
`)
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true,
        experimentalDecorators: true, types: [], lib: ['ES2022', 'DOM'],
        baseUrl: '.', paths: { [`${PACKAGE}/*`]: [`${root}/src/*`] },
      },
      files: ['models.ts'],
    }))

    const before = spawnSync(process.execPath, [tscBin, '-p', dir], { encoding: 'utf8' })
    expect(before.status, 'the 4.x code must NOT compile against 5.0').not.toBe(0)

    const result = migratePaths([dir], { write: true, cwd: dir })
    expect(result.files[0].warnings).toEqual([])
    const migrated = readFileSync(join(dir, 'models.ts'), 'utf8')
    expect(migrated).not.toContain(`from '${PACKAGE}'`)
    expect(migrated).toContain('container: ActiveSet.field(Tag')

    const after = spawnSync(process.execPath, [tscBin, '-p', dir], { encoding: 'utf8' })
    expect(after.stdout + after.stderr).toBe('')
    expect(after.status).toBe(0)
    expect(readdirSync(dir).sort()).toEqual(['models.ts', 'tsconfig.json'])
    rmSync(dir, { recursive: true })
  }, 120_000)
})
