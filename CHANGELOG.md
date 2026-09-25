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

## [4.0.0] - 2026-09-25

Migration guide: [docs/en/migration.md](docs/en/migration.md) ([RU](docs/migration.md)).

### Breaking
- `model.emitter` / `Model.emitter` removed. Use `model.on()` / `model.once()`.
- `model.startTracking()` removed. Tracking starts only via `create(data, { tracked: true })`.
- `Model.create()` throws a `TypeError` for an array instead of returning an empty model.
- `createFromCollection*` skips only `null`/`undefined` items (previously any falsy value).

### Added
- `ActiveMap` (a `Map` keyed by a field of its items) and `ActiveSet` (with an optional unique key), plus the `map` / `set` field options; `unique` option and `getByKey()` / `hasKey()` for `ActiveCollection`.
- Declarative field rules - `required`, `type`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `oneOf` - with `model.validate()` (reports **all** problems, recurses into nested models and collections), `model.assertValid()`, `create(data, { validate: true })` and a `ValidationError` carrying `issues`.
- Normalizers (`trim`, `lowercase`, `uppercase`, `transform`) and type coercion (`coerce: 'number' | 'integer' | 'boolean' | 'date' | 'string'`).
- State machines: `transitions` on a field, `model.canTransition()`, `model.allowedTransitions()`.
- `static strict = true` - a model that refuses writes to undeclared properties.
- Model-level invariants (`@InvariantMethod`, `Model.defineInvariant`), checked by `validate()`; `model.transaction(fn)` (all-or-nothing, async supported) and `fill(data, { atomic: true })`.
- `model.changes()`, `dirtyFields()`, `isDirty()`, `revert(prop?)`, `reset()` - per-field diff and restore for models created with `tracked: true`.
- `create(data, { history: true })` with `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clearHistory()`.
- `ActiveCollection` - an array that accepts only instances of one model, optionally kept sorted (`sortBy` / `compare` / `order`), with binary search (`bisectLeft`, `bisectRight`, `findByKey`, `range`), `itemsAdded` / `itemsRemoved` / `touched` events that bubble into a parent model. Created via `Model.collection()`, `Model.createCollection()`, `ActiveCollection.create()` or the `collection` field option.
- `model.getRaw()` - the deep-frozen source data of a model created with `tracked: true` (`undefined` otherwise).
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
- A rejected first write no longer locks a `readonly`/`fillable: false` field.
- `hidden` fields are concealed from `in` and `Object.getOwnPropertyDescriptor`.
- `createFromCollection*` return `InstanceType<T>[]`.
- `CallableModel` no longer extends `Function` via `super()` (CSP-safe).
- The "creating" state is a plain synchronous counter (no `AsyncLocalStorage`) and is exception-safe.
- `files` in `package.json` narrowed to `dist` and `src`; `LICENSE.txt` filled in (was empty).

### Fixed
- `isTouched()` / `changes()` reported a `Set` of models as changed against its own clone: sets are now compared by content. (`fast-deep-equal` is replaced by a small adapted copy, one dependency fewer.)
- `touched` was emitted during `create()`, and for writes that were then rejected or that hit non-field properties.
- `touched` never bubbled up from nested models (docs claimed it did); now it does, with de-duplication,
  unsubscription on replacement and a cycle guard.
- A plain object/array `value: ...` default was one object shared by every instance; now copied per instance.
- Decorator `once` hooks fired only if the first event of that type happened to be for their own field.
- Tracked snapshots deep-froze user-supplied functions (a side effect on caller code); functions are now left alone.
- `toJSON()` passed the proxy (not the raw instance) to getters, unlike a regular read.
- `mapTo()` typing required the handler to return the key's own type for `Symbol`/string targets.
- `AttributeValue` now allows arrays/objects (the runtime always did).
- `@ActiveFactory(undefined)` (typically a circular import) silently did nothing; it now throws a `ReferenceError`.
- License badge link in the READMEs.

## [3.5.0]
- `readonly` fields settable once at creation; `created` event; VitePress docs; bun; tests.
