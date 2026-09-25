# Testing and quality

| Command | What it does |
|---|---|
| `bun run test` | unit tests (Vitest) |
| `bun run test:coverage` | the same with v8 coverage; thresholds (90% statements/lines, 85% branches/functions) fail the run |
| `bun run test:perf` | performance budgets, scaling and memory checks |
| `bun run bench` | benchmarks (`vitest bench`) for tracking numbers over time |
| `bun run test:mutation` | mutation testing with Stryker |
| `bun run lint` / `typecheck` | ESLint (+ `@stylistic`) / `tsc --noEmit` |

## Why tests use a custom transform

`vitest.shared.ts` compiles `.ts` with `esbuild.transform()` and legacy decorators - the same toolchain `tsup`
uses for the published build. Don't swap in SWC or oxc: class-field and Proxy timing differ subtly between
transpilers, and this library's `readonly`/`created` logic depends on it.

## Performance tests

`tests/perf/budgets.perf.ts` asserts **median** time per operation against budgets that are 5-8x the numbers
measured on a laptop, so a slow CI runner doesn't flake but an accidental O(n²) or a per-call allocation
storm trips them. Loosen on a slow machine with `PERF_FACTOR=3 bun run test:perf`.

What is covered:

- **absolute budgets** - `create()` (10/100 fields, nested order, `new Model`), read, write, `toJSON()`,
  `clone()`, `isTouched()`, `createFromCollection()` of 1000 items;
- **listeners are cheap** - five listeners add < 5x to a write; a class-level listener on a 3-level
  inheritance chain stays sub-8µs;
- **scaling** - 10x more fields costs < 25x per `create()`, 5x more collection items < 9x, a 50-level
  self-nested model doesn't overflow the stack, a 10k-element array field stays within budget;
- **memory** (needs `--expose-gc`, set in `vitest.perf.config.ts`) - dropped models with instance and class
  listeners are garbage collected; tracked snapshots don't accumulate.

Reference numbers on a laptop (ns/op): `create()` 10 fields ≈ 11k, 100 fields ≈ 116k; write ≈ 760 (plain
object: 4); read ≈ 37; `toJSON()` of 10 fields ≈ 4.9k; `isTouched()` ≈ 4.3k. A write costs ~190x a plain
assignment because every write walks the pipeline (fillable → readonly → validator → events); that is the
price of the guarantees, and it is still under a microsecond.

## Mutation testing

Coverage says a line *ran*; mutation testing says a test would *notice* if it were wrong. Stryker changes the
code (flips a condition, drops a statement, swaps an operator) and checks that some test fails. A surviving
mutant means a behavior nobody pins down.

```bash
bun run test:mutation        # HTML report: reports/mutation/index.html
```

The score is gated (`break: 65`), configured in `stryker.config.mjs`; runs are incremental
(`reports/stryker-incremental.json`), so only changed code is re-mutated. In CI it runs weekly and on demand
(`quality.yml`), not on every PR - it takes minutes.
