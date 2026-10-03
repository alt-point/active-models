// Codemod for the 4.x -> 5.0 migration: rewrites imports of the removed root entry into subpath imports and the
// removed collection API into the new one. Plain ESM, no dependencies; the CLI lives in ./active-models.mjs.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

export const PACKAGE = '@alt-point/active-models'

const SUBPATH_EXPORTS = {
  ActiveModel: ['ActiveModel', 'InvariantCheck'],
  decorators: ['ActiveField', 'ActiveFactory', 'GetterMethod', 'SetterMethod', 'InvariantMethod', 'isHidden', 'isFillable', 'isProtected'],
  types: [
    'ActiveFieldDescriptor', 'ActiveModelHookListener', 'ActiveModelSource', 'AnyClassInstance', 'AttributeValue',
    'CollectionEventPayload', 'CollectionOptions', 'ConstructorType', 'ContainerSpec', 'DeleteEventPayload', 'EnumItemType',
    'EventListener', 'EventPayloads', 'EventType', 'FactoryBase', 'FactoryConfig', 'FactoryOptions', 'Getter', 'HandlerMapTo',
    'InstanceEventPayload', 'KeyOf', 'MapOptions', 'MapSource', 'MapTarget', 'MapToMapper', 'PropEvent', 'SetEventPayload',
    'SetOptions', 'Setter', 'StaticContainers', 'Validator',
  ],
  ActiveCollection: ['ActiveCollection', 'CollectionInput'],
  ActiveMap: ['ActiveMap'],
  ActiveSet: ['ActiveSet'],
  collectionRegistry: ['isCollection'],
  pipeline: [
    'ValidationError', 'ValidationIssue', 'ValidationResult', 'ValidationCode', 'FieldRules', 'Transform', 'Transitions',
    'CoerceTo', 'ValueType', 'Coercible', 'Bound',
  ],
  CallableModel: ['CallableModel'],
  Enum: ['Enum'],
  utils: ['ModelProperties', 'RecursivePartialActiveModel'],
  'scalars/Decimal': ['Decimal', 'DecimalInput', 'RoundingMode'],
  'scalars/Money': ['Money', 'minorUnits'],
  'scalars/LocalDate': ['LocalDate'],
  'scalars/immutable': ['markImmutable'],
}

/** Every name the 4.x root entry exported, mapped to the subpath that exports it now */
export const EXPORT_MAP = Object.fromEntries(
  Object.entries(SUBPATH_EXPORTS).flatMap(([subpath, names]) => names.map((name) => [name, subpath]))
)

const SUBPATH_ORDER = Object.keys(SUBPATH_EXPORTS)

const CONTAINER_CLASS = { collection: 'ActiveCollection', map: 'ActiveMap', set: 'ActiveSet' }

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'])

/**
 * The code with the insides of comments, strings, template literals and regular expressions replaced by spaces
 * (quotes and newlines stay), so positions are the same but a search can never match text that is not code.
 */
export function maskCode (source) {
  const out = source.split('')
  const length = source.length
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
    }
  }
  let i = 0
  let prev = ''
  let prevWord = ''
  while (i < length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      let end = source.indexOf('\n', i)
      if (end < 0) end = length
      blank(i, end)
      i = end
      continue
    }
    if (c === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2)
      end = end < 0 ? length : end + 2
      blank(i, end)
      i = end
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < length && source[j] !== c && source[j] !== '\n') {
        if (source[j] === '\\') j++
        j++
      }
      blank(i + 1, Math.min(j, length))
      i = source[j] === '\n' ? j : Math.min(j + 1, length)
      prev = c
      prevWord = ''
      continue
    }
    if (c === '`') {
      let j = i + 1
      while (j < length && source[j] !== '`') {
        if (source[j] === '\\') j++
        j++
      }
      blank(i + 1, Math.min(j, length))
      i = Math.min(j + 1, length)
      prev = '`'
      prevWord = ''
      continue
    }
    if (c === '/' && (prev === '' || REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.has(prevWord))) {
      let j = i + 1
      let inClass = false
      while (j < length && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue }
        if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break
        j++
      }
      if (source[j] === '/') {
        blank(i + 1, j)
        i = j + 1
        while (i < length && /[a-z]/.test(source[i])) i++
        prev = ')'
        prevWord = ''
        continue
      }
    }
    if (/[\w$]/.test(c)) {
      let j = i
      while (j < length && /[\w$]/.test(source[j])) j++
      prevWord = source.slice(i, j)
      prev = source[j - 1]
      i = j
      continue
    }
    if (!/\s/.test(c)) {
      prev = c
      prevWord = ''
    }
    i++
  }
  return out.join('')
}

const CLOSERS = { '{': '}', '[': ']', '(': ')' }

/** Index of the bracket that closes the one at `open` (in masked code), or -1 */
function matchClose (masked, open) {
  const opener = masked[open]
  const closer = CLOSERS[opener]
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === opener) depth++
    else if (masked[i] === closer && --depth === 0) return i
  }
  return -1
}

/** Offsets [start, end) of the top-level, comma-separated members between the brackets at (open, close) */
function topLevelSegments (masked, open, close) {
  const segments = []
  let depth = 0
  let start = open + 1
  for (let i = open + 1; i < close; i++) {
    const c = masked[i]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      segments.push([start, i])
      start = i + 1
    }
  }
  segments.push([start, close])
  return segments
}

const lineOf = (source, offset) => source.slice(0, offset).split('\n').length

const BARE = /^[A-Za-z_$][\w$.]*$/

/**
 * Convert the `collection` / `map` / `set` options of `ActiveField({ ... })` calls to `container: X.field(...)`.
 */
function containerEdits (source, masked, edits, warnings, needed) {
  const call = /\bActiveField\s*\(\s*\{/g
  let m
  while ((m = call.exec(masked))) {
    const open = m.index + m[0].length - 1
    const close = matchClose(masked, open)
    if (close < 0) continue
    for (const [from, to] of topLevelSegments(masked, open, close)) {
      const text = source.slice(from, to)
      const key = /^(\s*)(?:(collection|map|set)|'(collection|map|set)'|"(collection|map|set)")(\s*):(\s*)/.exec(text)
      if (!key) {
        const shorthand = /^\s*(collection|map|set)\s*$/.exec(text)
        if (shorthand) {
          warnings.push({ line: lineOf(source, from), message: `shorthand "${shorthand[1]}" option: write container: ${CONTAINER_CLASS[shorthand[1]]}.field(...) by hand` })
        }
        continue
      }
      const kind = key[2] ?? key[3] ?? key[4]
      const valueStart = from + key[0].length
      let valueEnd = to
      while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1])) valueEnd--
      const value = source.slice(valueStart, valueEnd)
      const maskedValue = masked.slice(valueStart, valueEnd)
      let args
      if (maskedValue.startsWith('[') && matchClose(maskedValue, 0) === maskedValue.length - 1) {
        args = value.slice(1, -1).trim().replace(/,\s*$/, '')
      } else if (BARE.test(value)) {
        args = value
      } else {
        warnings.push({ line: lineOf(source, from), message: `"${kind}" option with a computed value: write container: ${CONTAINER_CLASS[kind]}.field(...) by hand` })
        continue
      }
      needed.add(CONTAINER_CLASS[kind])
      edits.push({ start: from + key[1].length, end: valueEnd, text: `container: ${CONTAINER_CLASS[kind]}.field(${args})` })
    }
  }
}

/** `Model.collection(...)` -> `ActiveCollection.create(Model, ...)`, `Model.createCollection(...)` -> `createFromData` */
function staticEdits (source, masked, edits, warnings, needed) {
  const call = /(?<![\w$.])([A-Z][\w$]*)\s*\.\s*(collection|createCollection)\s*\(/g
  let m
  while ((m = call.exec(masked))) {
    const end = m.index + m[0].length
    const empty = /^\s*\)/.test(masked.slice(end))
    const method = m[2] === 'collection' ? 'create' : 'createFromData'
    const gap = empty || /\s/.test(source[end] ?? '') ? '' : ' '
    needed.add('ActiveCollection')
    edits.push({ start: m.index, end, text: `ActiveCollection.${method}(${m[1]}${empty ? '' : `,${gap}`}` })
  }
  const chained = /\.\s*[A-Z][\w$]*\s*\.\s*(collection|createCollection)\s*\(/g
  while ((m = chained.exec(masked))) {
    warnings.push({ line: lineOf(source, m.index), message: `"${m[1]}()" on a qualified class: use ActiveCollection.${m[1] === 'collection' ? 'create' : 'createFromData'}(Class, ...) by hand` })
  }
}

function splitNames (text) {
  return text.split(',').map((part) => part.trim()).filter(Boolean)
}

/** Parse `A`, `type A`, `A as B` (import / export) or `A: B` (require) */
function parseName (raw, requireStyle) {
  let part = raw.replace(/\s+/g, ' ')
  let isType = false
  if (/^type\s/.test(part)) {
    isType = true
    part = part.replace(/^type\s+/, '')
  }
  const base = (requireStyle ? part.split(':')[0] : part.split(/\s+as\s+/)[0]).trim()
  return { base, text: part, isType }
}

function buildLines (statement, additions) {
  const groups = new Map()
  const rest = []
  for (const item of statement.items) {
    const sub = EXPORT_MAP[item.base]
    if (!sub) {
      rest.push(item)
      continue
    }
    if (!groups.has(sub)) groups.set(sub, [])
    groups.get(sub).push(item)
  }
  for (const name of additions) {
    const sub = EXPORT_MAP[name]
    if (!groups.has(sub)) groups.set(sub, [])
    groups.get(sub).push({ base: name, text: name, isType: false })
  }
  const lines = []
  const q = statement.quote
  const end = statement.semi
  const make = (specifier, items) => {
    const names = items.map((item) => (statement.typeStatement || statement.requireStyle || !item.isType ? item.text : `type ${item.text}`)).join(', ')
    if (statement.requireStyle) {
      return `${statement.declaration} { ${names} } = require(${q}${specifier}${q})${end}`
    }
    return `${statement.keyword}${statement.typeStatement ? ' type' : ''} { ${names} } from ${q}${specifier}${q}${end}`
  }
  for (const sub of SUBPATH_ORDER) {
    if (groups.has(sub)) lines.push(make(`${PACKAGE}/${sub}`, groups.get(sub)))
  }
  if (rest.length) lines.push(make(PACKAGE, rest))
  return { lines, unknown: rest.map((item) => item.base) }
}

/**
 * Rewrite one JS / TS source. Only files that import the removed root entry are touched.
 * @returns {{ code: string, changes: Array<{ line: number, before: string, after: string }>, warnings: Array<{ line: number, message: string }> }}
 */
export function migrateSource (source, { api = true } = {}) {
  const warnings = []
  const changes = []
  if (!source.includes(PACKAGE)) {
    return { code: source, changes, warnings }
  }
  const masked = maskCode(source)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'

  const statements = []
  const handled = []   // [start, end) ranges whose specifier is dealt with
  const named = /\b(import|export)(\s+type)?\s*\{([^}]*)\}\s*from\s*(['"])( *)\4(\s*;)?/g
  let m
  while ((m = named.exec(masked))) {
    const specStart = m.index + m[0].indexOf(m[4]) + 1
    const specifier = source.slice(specStart, specStart + m[5].length)
    if (specifier !== PACKAGE) continue
    statements.push({
      start: m.index,
      end: m.index + m[0].length,
      keyword: m[1],
      typeStatement: Boolean(m[2]),
      requireStyle: false,
      quote: m[4],
      semi: m[6] ? m[6].trim() : '',
      items: splitNames(m[3]).map((raw) => parseName(raw, false)),
    })
    handled.push([specStart, specStart + m[5].length])
  }
  const required = /\b(const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])( *)\3\s*\)(\s*;)?/g
  while ((m = required.exec(masked))) {
    const specStart = m.index + m[0].indexOf(m[3]) + 1
    const specifier = source.slice(specStart, specStart + m[4].length)
    if (specifier !== PACKAGE) continue
    statements.push({
      start: m.index,
      end: m.index + m[0].length,
      declaration: m[1],
      requireStyle: true,
      quote: m[3],
      semi: m[5] ? m[5].trim() : '',
      items: splitNames(m[2]).map((raw) => parseName(raw, true)),
    })
    handled.push([specStart, specStart + m[4].length])
  }
  statements.sort((a, b) => a.start - b.start)

  // anything else that names the package cannot be rewritten safely
  const quoted = new RegExp(`(['"]) {${PACKAGE.length}}\\1`, 'g')
  while ((m = quoted.exec(masked))) {
    const inner = m.index + 1
    if (source.slice(inner, inner + PACKAGE.length) !== PACKAGE) continue
    if (handled.some(([from, to]) => from === inner && to === inner + PACKAGE.length)) continue
    warnings.push({ line: lineOf(source, m.index), message: `'${PACKAGE}' is imported in a form this tool does not rewrite (namespace/default import, dynamic import, require, mock): change it to the subpath imports by hand` })
  }

  const edits = []
  const needed = new Set()
  if (api) {
    containerEdits(source, masked, edits, warnings, needed)
    staticEdits(source, masked, edits, warnings, needed)
  }

  const imported = new Set(statements.flatMap((statement) => statement.items.map((item) => item.base)))
  const additions = [...needed].filter((name) => !imported.has(name))
  const target = statements.find((s) => !s.requireStyle && !s.typeStatement && s.keyword === 'import') ?? statements.find((s) => s.requireStyle)

  for (const statement of statements) {
    const lineStart = source.lastIndexOf('\n', statement.start - 1) + 1
    const indentText = source.slice(lineStart, statement.start)
    const indent = /^\s*$/.test(indentText) ? indentText : ''
    const extra = statement === target ? additions : []
    const { lines, unknown } = buildLines(statement, extra)
    if (unknown.length) {
      warnings.push({ line: lineOf(source, statement.start), message: `no subpath for ${unknown.join(', ')}: left on the root import, which no longer exists` })
    }
    const text = lines.join(newline + indent)
    const before = source.slice(statement.start, statement.end).replace(/\s+/g, ' ').trim()
    edits.push({ start: statement.start, end: statement.end, text })
    changes.push({ line: lineOf(source, statement.start), before, after: lines.join('\n') })
  }
  if (!target && additions.length) {
    warnings.push({ line: 1, message: `uses ${additions.join(', ')} but has no value import from the package to extend: add the import by hand` })
  }

  edits.sort((a, b) => b.start - a.start)
  let code = source
  for (const edit of edits) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
  }
  if (api) {
    for (const edit of edits) {
      if (edit.text.startsWith('container:') || edit.text.startsWith('ActiveCollection.')) {
        changes.push({ line: lineOf(source, edit.start), before: source.slice(edit.start, edit.end).replace(/\s+/g, ' '), after: edit.text })
      }
    }
  }
  changes.sort((a, b) => a.line - b.line)
  return { code, changes, warnings }
}

/** Rewrite the `<script>` blocks of a Vue single-file component */
export function migrateVue (source, options) {
  const changes = []
  const warnings = []
  const code = source.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (whole, open, body, close, offset) => {
    const result = migrateSource(body, options)
    const shift = lineOf(source, offset + open.length) - 1
    for (const change of result.changes) changes.push({ ...change, line: change.line + shift })
    for (const warning of result.warnings) warnings.push({ ...warning, line: warning.line + shift })
    return open + result.code + close
  })
  return { code, changes, warnings }
}

export const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue']
export const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', 'coverage', '.nuxt', '.output', '.next', '.svelte-kit', '.turbo', '.cache', '.vitepress']

/** All files below `paths` (files or directories) with a wanted extension, skipping ignored directories */
export function collectFiles (paths, { extensions = DEFAULT_EXTENSIONS, ignore = DEFAULT_IGNORE } = {}) {
  const files = []
  const visit = (path) => {
    const stats = statSync(path, { throwIfNoEntry: false })
    if (!stats) return
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && ignore.includes(entry.name)) continue
        visit(join(path, entry.name))
      }
    } else if (extensions.includes(extname(path))) {
      files.push(path)
    }
  }
  for (const path of paths) visit(resolve(path))
  return files.sort()
}

/**
 * Migrate every file below `paths`. Nothing is written unless `write` is true.
 * @returns {{ files: Array<{ file: string, changes: object[], warnings: object[], changed: boolean }>, scanned: number }}
 */
export function migratePaths (paths, { write = false, api = true, extensions, ignore, cwd = process.cwd() } = {}) {
  const files = collectFiles(paths, { extensions, ignore })
  const results = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes(PACKAGE)) continue
    const result = extname(file) === '.vue' ? migrateVue(source, { api }) : migrateSource(source, { api })
    const changed = result.code !== source
    if (changed && write) writeFileSync(file, result.code)
    if (changed || result.warnings.length) {
      results.push({ file: relative(cwd, file) || file, changes: result.changes, warnings: result.warnings, changed })
    }
  }
  return { files: results, scanned: files.length }
}
