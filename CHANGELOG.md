# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## Versioning policy

- **MAJOR** - any incompatible change of the public API or of documented behavior (removed/renamed
  exports, methods or options; a call that used to work now throws; changed default).
- **MINOR** - backwards-compatible functionality (new methods, options, events, exports).
- **PATCH** - backwards-compatible bug fixes, performance work, docs/tests/tooling-only changes that
  don't touch the published API.
- Every user-visible change is added to `## [Unreleased]` in the same commit; on release that section is
  renamed to the version and `package.json` is bumped (`bun pm version <major|minor|patch>`), tag `vX.Y.Z`.
- The published surface is what `src/index.ts` exports plus the documented behavior in `docs/`.
  Undocumented internals (`src/meta.ts`, `src/emitter.ts`, `useEmitter`, ...) may change in a PATCH.

## [Unreleased]

## [4.0.0] - pending release

Migration guide: [docs/en/migration.md](docs/en/migration.md) ([RU](docs/migration.md)).

### Breaking
- `model.emitter` / `Model.emitter` removed. Use `model.on()` / `model.once()`.
- `model.startTracking()` removed. Tracking starts only via `create(data, { tracked: true })`.
- `Model.create()` throws a `TypeError` for an array instead of returning an empty model.
- `createFromCollection*` skips only `null`/`undefined` items (previously any falsy value).

### Added
- `Model.on()` / `Model.once()` - class-level subscriptions for every instance, subclasses included.
- `created` / `touched` events carry `{ target }`; typed `EventPayloads` / `EventListener`.
- `makeFreeze()` documented; throws a clear `TypeError` on write/delete/defineProperty.
- Tests: edge cases, coverage (v8, thresholds), performance budgets + benchmarks (`test:perf`, `bench`) and mutation testing (`test:mutation`, Stryker).
- ESLint + `@stylistic`; `typecheck`, `lint`, `test:coverage` scripts; CI runs them.
- Docs: known limitations, migration guide, `AGENTS.md` and `llms.txt` for AI agents.

### Changed
- Listeners registered on a parent class fire for subclass instances.
- One throwing listener no longer prevents the others from running.
- `toJSON()` honors `toJSON()` methods (`Date`...), serializes `Set` as an array and `Map` as an object.
- `clone()` returns a fully working proxied model, keeps `hidden` values, `readonly`/`fillable: false`
  locks and the `isTouched()` baseline.
- `hidden` fields are concealed from `in` and `Object.getOwnPropertyDescriptor`.
- `createFromCollection*` return `InstanceType<T>[]`.
- `CallableModel` no longer extends `Function` via `super()` (CSP-safe).
- The "creating" state is a plain synchronous counter (no `AsyncLocalStorage`) and is exception-safe.
- `files` in `package.json` narrowed to `dist` and `src`; `LICENSE.txt` filled in (was empty).

### Fixed
- `touched` was emitted during `create()`.
- License badge link in the READMEs.

## [3.5.0]
- `readonly` fields settable once at creation; `created` event; VitePress docs; bun; tests.
