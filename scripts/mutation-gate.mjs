// Per-file mutation score gate, run after `stryker run` (which enforces the global `thresholds.break`).
// Reads the incremental report Stryker writes and fails when a file drops below its own minimum.
import { readFileSync } from 'node:fs'

const MIN = {
  'src/ActiveModel.ts': 75,
  'src/decorators.ts': 85,
  'src/emitter.ts': 85,
  'src/meta.ts': 75,
  'src/utils.ts': 75,
  'src/mapper.ts': 90,
  'src/CallableModel.ts': 90,
}

const report = JSON.parse(readFileSync('reports/stryker-incremental.json', 'utf8'))
const ignored = new Set(['Ignored', 'CompileError'])
const detected = new Set(['Killed', 'Timeout'])
let failed = false

for (const [file, min] of Object.entries(MIN)) {
  const mutants = (report.files[file]?.mutants ?? []).filter((m) => !ignored.has(m.status))
  if (mutants.length === 0) continue
  const score = (mutants.filter((m) => detected.has(m.status)).length / mutants.length) * 100
  const ok = score >= min
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file.padEnd(26)} ${score.toFixed(1).padStart(5)}%  (min ${min}%)`)
}

process.exit(failed ? 1 : 0)
