// Per-file mutation score gate, run after `stryker run` (which enforces the global `thresholds.break`).
// Reads the incremental report Stryker writes and fails when a file drops below its own minimum.
import { readFileSync } from 'node:fs'

const MIN = {
  'src/ActiveCollection.ts': 90,
  'src/collectionRegistry.ts': 95,
  'src/ActiveModel.ts': 88,
  'src/decorators.ts': 93,
  'src/emitter.ts': 95,
  'src/meta.ts': 95,
  'src/utils.ts': 92,
  'src/mapper.ts': 95,
  'src/CallableModel.ts': 95,
  'src/pipeline.ts': 90,
  'src/history.ts': 90,
  'src/equal.ts': 90,
  'src/clone.ts': 90,
  'src/collectionCore.ts': 95,
  'src/ActiveMap.ts': 85,
  'src/ActiveSet.ts': 88,
  'src/scalars/Decimal.ts': 90,
  'src/scalars/Money.ts': 88,
  'src/scalars/LocalDate.ts': 92,
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
