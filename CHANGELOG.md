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

Upgrade from 3.5.0. Migration guide: [docs/en/migration.md](docs/en/migration.md) ([RU](docs/migration.md)).

### Breaking changes

**English**

Removed or changed API (your code stops compiling or throws):

| 3.5.0 | 4.0.0 |
|---|---|
| `model.emitter.on(...)`, `Model.emitter` | `model.on(...)` / `model.once(...)`; class-level `Model.on(...)` / `Model.once(...)` for every instance |
| `form.startTracking()` | `form = Form.create(saved, { tracked: true })`; the baseline is reset by re-creating the model |
| `Model.create([...])` returned an empty model | throws `TypeError`; use `Model.createFromCollection([...])` |
| `createFromCollection*` skipped any falsy item (`0`, `''`, `false`) | skips only `null` / `undefined` |
| `createFromCollection*` returned `T[]` | returns `InstanceType<T>[]` (stricter typing) |
| `fast-deep-equal` was a dependency | removed; equality is a vendored copy that compares `Set` members by content |
| `import { ActiveModel, ActiveField, EventType, ... } from '@alt-point/active-models'` | **no root entry**: import from subpaths - `/ActiveModel`, `/decorators`, `/types`, `/pipeline`, `/CallableModel`, `/Enum`, `/utils`, `/ActiveCollection`, `/ActiveMap`, `/ActiveSet`, `/scalars/*` (see [Imports](docs/en/imports.md)) |
| `lodash-es` was a dependency | removed; the package has no runtime dependencies |

Behavior that changed silently (review it if you rely on the old behavior):

- `touched` is no longer emitted during `create()`, for writes that were rejected, or for non-field properties. It now bubbles from nested models and collections.
- One throwing listener no longer stops the others: all run, then the first error is rethrown (several: `error.errors`).
- Listeners registered on a parent class fire for subclass instances.
- `value: []` / `value: {}` defaults are copied per instance (they used to be one shared object).
- `clone()` returns a fully working proxied model and keeps `hidden` values, locks and the `isTouched()` baseline (it used to return a plain object).
- `toJSON()` honors `toJSON()` methods (`Date`), serializes `Set` as an array and `Map` as an object.
- `hidden` fields are concealed from `in` and `Object.getOwnPropertyDescriptor`.
- A rejected first write no longer locks a `readonly` / `fillable: false` field.
- `@ActiveFactory(undefined)` (usually a circular import) throws `ReferenceError` instead of doing nothing.
- `CallableModel` no longer extends `Function` through `super()`.
- The published package contains `dist`, `src`, `AGENTS.md`, `CHANGELOG.md`; `LICENSE.txt` is filled in (MIT).

**Русский**

Удалённый или изменённый API (код перестанет компилироваться или начнёт бросать исключение):

| 3.5.0 | 4.0.0 |
|---|---|
| `model.emitter.on(...)`, `Model.emitter` | `model.on(...)` / `model.once(...)`; на уровне класса `Model.on(...)` / `Model.once(...)` для всех инстансов |
| `form.startTracking()` | `form = Form.create(saved, { tracked: true })`; чтобы сбросить эталон, создайте модель заново |
| `Model.create([...])` возвращал пустую модель | бросает `TypeError`; используйте `Model.createFromCollection([...])` |
| `createFromCollection*` пропускал любые «ложные» элементы (`0`, `''`, `false`) | пропускает только `null` / `undefined` |
| `createFromCollection*` возвращал `T[]` | возвращает `InstanceType<T>[]` (более строгая типизация) |
| `fast-deep-equal` был зависимостью | удалён; сравнение — встроенная копия, которая сравнивает элементы `Set` по содержимому |
| `import { ActiveModel, ActiveField, EventType, ... } from '@alt-point/active-models'` | **корневого входа нет**: импорт из подпутей — `/ActiveModel`, `/decorators`, `/types`, `/pipeline`, `/CallableModel`, `/Enum`, `/utils`, `/ActiveCollection`, `/ActiveMap`, `/ActiveSet`, `/scalars/*` (см. [Импорты](docs/imports.md)) |
| `lodash-es` был зависимостью | удалён; в пакете нет зависимостей в рантайме |

Поведение, изменившееся без ошибок компиляции (проверьте, если опирались на старое):

- `touched` больше не вызывается во время `create()`, при отклонённой записи и для свойств, не являющихся полями. Теперь он всплывает из вложенных моделей и коллекций.
- Исключение в одном слушателе не останавливает остальных: выполняются все, затем пробрасывается первая ошибка (несколько — в `error.errors`).
- Слушатели, добавленные на родительском классе, срабатывают и для инстансов подклассов.
- Значения по умолчанию `value: []` / `value: {}` копируются для каждого инстанса (раньше это был один общий объект).
- `clone()` возвращает полностью рабочую модель-прокси и сохраняет `hidden`-значения, блокировки и эталон `isTouched()` (раньше возвращал обычный объект).
- `toJSON()` учитывает методы `toJSON()` (`Date`), сериализует `Set` массивом, а `Map` объектом.
- `hidden`-поля скрыты от оператора `in` и `Object.getOwnPropertyDescriptor`.
- Отклонённая первая запись больше не блокирует поле `readonly` / `fillable: false`.
- `@ActiveFactory(undefined)` (обычно циклический импорт) бросает `ReferenceError`, а не молча ничего не делает.
- `CallableModel` больше не наследует `Function` через `super()`.
- В npm-пакет входят `dist`, `src`, `AGENTS.md`, `CHANGELOG.md`; `LICENSE.txt` заполнен (MIT).

### Added
- Tree-shakable packaging: one entry point and `exports` subpath per capability, `typesVersions` for legacy resolution, `sideEffects: false`. `ActiveModel` (8 KB gzipped, was 15.7 KB) and `@ActiveField` no longer load `ActiveCollection` / `ActiveMap` / `ActiveSet`; the containers are described with `ActiveCollection.field()`, `ActiveMap.field()`, `ActiveSet.field()` and the `container` field option, created with `ActiveCollection.create()` / `ActiveCollection.createFromData()`. Guards: `tests/treeshake.test.ts`, `tests/package-entries.test.ts`, `bun run test:dist`.
- Zero runtime dependencies: `lodash-es` is replaced by a vendored deep clone (`src/clone.ts`, verified against lodash in the tests); the bundle of `ActiveModel` shrinks by 14 KB.
- Value objects `Decimal` (BigInt-based, explicit rounding), `Money` (currency-aware, `allocate()`), `LocalDate` (no time zone), `markImmutable()`. `coerce` / `type` accept a class with a static `from()`, `min` / `max` accept values with `compareTo()`.
- `ActiveMap` (a `Map` keyed by a field of its items) and `ActiveSet` (with an optional unique key), plus `ActiveMap.field()` / `ActiveSet.field()` for the `container` field option; `unique` option and `getByKey()` / `hasKey()` for `ActiveCollection`.
- Declarative field rules - `required`, `type`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `oneOf` - with `model.validate()` (reports **all** problems, recurses into nested models and collections), `model.assertValid()`, `create(data, { validate: true })` and a `ValidationError` carrying `issues`.
- Normalizers (`trim`, `lowercase`, `uppercase`, `transform`) and type coercion (`coerce: 'number' | 'integer' | 'boolean' | 'date' | 'string'`).
- State machines: `transitions` on a field, `model.canTransition()`, `model.allowedTransitions()`.
- `static strict = true` - a model that refuses writes to undeclared properties.
- Model-level invariants (`@InvariantMethod`, `Model.defineInvariant`), checked by `validate()`; `model.transaction(fn)` (all-or-nothing, async supported) and `fill(data, { atomic: true })`.
- `model.changes()`, `dirtyFields()`, `isDirty()`, `revert(prop?)`, `reset()` - per-field diff and restore for models created with `tracked: true`.
- `create(data, { history: true })` with `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clearHistory()`.
- `ActiveCollection` - an array that accepts only instances of one model, optionally kept sorted (`sortBy` / `compare` / `order`), with binary search (`bisectLeft`, `bisectRight`, `findByKey`, `range`), `itemsAdded` / `itemsRemoved` / `touched` events that bubble into a parent model. Created via `ActiveCollection.create()`, `ActiveCollection.createFromData()` or the `container` field option.
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
- `deepEqual` (and so `isTouched()` / `changes()`) looped forever when comparing two `DataView`s.
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
