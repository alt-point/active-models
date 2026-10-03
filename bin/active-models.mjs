#!/usr/bin/env node
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE, PACKAGE, migratePaths } from './migrate.mjs'

const HELP = `Usage: active-models migrate [paths...] [options]

Rewrites code that uses ${PACKAGE} 4.x to the 5.0 API, in every .ts .tsx .mts .cts .js .jsx .mjs .cjs and .vue
file below the given paths (default: the current directory):

  - imports of the removed root entry become subpath imports
    (import { ActiveModel, ActiveField } from '${PACKAGE}'
     -> import { ActiveModel } from '${PACKAGE}/ActiveModel' ...)
  - @ActiveField({ collection | map | set }) options become container: ActiveCollection.field(...) and friends
  - Model.collection(...) / Model.createCollection(...) become ActiveCollection.create(Model, ...) / createFromData(Model, ...)

Nothing is written unless you pass --write. Without it the tool prints what it would change.

Options:
  --write            apply the changes
  --check            exit with code 1 when anything would change or needs manual work (for CI)
  --imports-only     rewrite imports only, leave collection / map / set options and Model.collection() calls alone
  --ext <list>       comma-separated extensions to scan (default: ${DEFAULT_EXTENSIONS.join(',')})
  --ignore <list>    comma-separated directory names to skip (default: ${DEFAULT_IGNORE.join(',')})
  -h, --help         show this help
`

const fail = (message) => {
  console.error(`active-models: ${message}\n\n${HELP}`)
  process.exit(2)
}

const args = process.argv.slice(2)
const command = args.shift()
if (!command || command === '-h' || command === '--help') {
  console.log(HELP)
  process.exit(command ? 0 : 2)
}
if (command !== 'migrate') fail(`unknown command "${command}"`)

const options = { write: false, check: false, api: true, extensions: DEFAULT_EXTENSIONS, ignore: DEFAULT_IGNORE }
const paths = []
while (args.length) {
  const arg = args.shift()
  const value = () => args.shift() ?? fail(`${arg} needs a value`)
  if (arg === '--write') options.write = true
  else if (arg === '--check') options.check = true
  else if (arg === '--imports-only') options.api = false
  else if (arg === '--ext') options.extensions = value().split(',').map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
  else if (arg === '--ignore') options.ignore = value().split(',')
  else if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0) }
  else if (arg.startsWith('-')) fail(`unknown option ${arg}`)
  else paths.push(arg)
}

const { files, scanned } = migratePaths(paths.length ? paths : ['.'], options)

let changedFiles = 0
let warnings = 0
for (const { file, changes, warnings: fileWarnings, changed } of files) {
  if (changed) changedFiles++
  console.log(`${changed ? (options.write ? 'updated' : 'would update') : 'needs attention'}  ${file}`)
  for (const change of changes) {
    const pad = ' '.repeat(String(change.line).length)
    console.log(`  ${change.line}: - ${change.before}`)
    for (const line of change.after.split('\n')) console.log(`  ${pad}  + ${line}`)
  }
  for (const warning of fileWarnings) {
    warnings++
    console.log(`  ${warning.line}: MANUAL  ${warning.message}`)
  }
}

console.log(`\nScanned ${scanned} files: ${changedFiles} ${options.write ? 'updated' : 'to update'}, ${warnings} place${warnings === 1 ? '' : 's'} to fix by hand.`)
if (changedFiles > 0 && !options.write) console.log('Run again with --write to apply the changes.')
if (options.check && (changedFiles > 0 || warnings > 0)) process.exit(1)
