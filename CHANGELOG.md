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
- The published surface is what the `exports` subpaths of `package.json` expose (since 5.0; before, `src/index.ts`) plus the
  documented behavior in `docs/`. Undocumented internals (`src/meta.ts`, `src/emitter.ts`, `useEmitter`, ...) may change in a PATCH.

## [Unreleased]

### Fixed

- `Model.create(data)` looped forever when `data` contained a circular reference: the sanitizer's object walk had no cycle guard.
- `fill(data, true)` and `Object.assign(model, data)` wrote the keys `__proto__` and `constructor` from `data` (e.g. parsed JSON), swapping the prototype or the class of the instance; both keys are now ignored.
- `@ActiveField({ value: 0 })`, `value: false`, `value: ''`, `value: null` and the bare shorthand `@ActiveField(0)` were ignored: the default was tested for truthiness instead of presence.
- `@ActiveField({ factory: Model })` turned `null` / `undefined` (assigned, or passed in `create()` data) into an empty `Model`; the value is now stored as is and `nulling` fires like for any other field.
- `validate()` / `assertValid()` / `create(data, { validate: true })` skipped the items of an `ActiveMap` field: the map iterates `[key, item]` pairs, so no item was recognised as a model.
- `ActiveMap.create(Model, options, items)` (and so `clone()` and the `container` field) spread the items into `add(...items)`, so a map of more than ~100 000 items threw `RangeError: Maximum call stack size exceeded`.
- `ActiveMap.add(a, b, ...)` and the initial items of `ActiveMap.create()` emitted `itemsAdded` and `touched` once per item; like `ActiveCollection` and `ActiveSet`, the whole batch is now reported by one `itemsAdded` (with all `items` / `keys`) and one `touched`. A key repeated in one call keeps the last item; the others are no longer stored and reported removed.
- With `history` enabled, a nested `transaction()` (or atomic `fill()`) that rolled back left its writes in the undo step of the enclosing transaction, so `redo()` re-applied them.
- `Model.createLazy(data)` - and so a plain object pushed into an `ActiveCollection` / `ActiveMap` / `ActiveSet` or assigned to a `factory` field - modified the caller's object: field defaults were added to it and `fillable: false` keys deleted from it. The lazy path now works on a shallow copy (nested values are still shared, as before).
- `isCollection()` is `true` for an `ActiveMap` / `ActiveSet` too, but its type predicate narrowed to `ActiveCollection` only; it now narrows to the union of the three.
- `Object.keys()` and `Reflect.ownKeys()` of a model made non-extensible with `Object.preventExtensions()` no longer throw: its `hidden` fields are listed, as the Proxy invariants require, while `toJSON()` still leaves them out.

### Changed

- Performance: the event, lock and child-subscription containers of an instance are allocated on first use, and a tracked model keeps one pristine copy instead of two. Per instance with 10 fields: ~2.7 KB → ~0.8 KB (tracked: ~4.2 KB → ~1.8 KB); `new Model()` 7.4 µs → 2.5 µs; tracked `create()` 27 µs → 21 µs. The perf suite now enforces < 1.5 KB per instance.
- Performance: `isTouched()`, `changes()`, `dirtyFields()`, `isDirty()` and `revert()` compare nested models through their raw objects instead of their proxies, and `isDirty(field)` compares that one field only. Tracked model with a 2000-row collection: `isTouched()` 5.1 ms → 0.49 ms, `isDirty('rows')` 5.3 ms → 0.44 ms, `changes()` 5.1 ms → 0.43 ms (budgets < 1 ms / < 0.6 ms).
- Performance: a model whose class has no `hidden` fields and no getters is created without the `has`, `getOwnPropertyDescriptor` and `ownKeys` traps (a field hidden or a getter defined after an instance exists is not reflected on that instance), `Reflect.ownKeys()` builds its list in one pass, and `toJSON()` reads the raw instance instead of going through the proxy. Model with 10 fields: `Object.keys()` 2.6 µs → 0.75 µs, `toJSON()` 4.1 µs → 0.64 µs, `JSON.stringify()` 4.5 µs → 0.97 µs; `new Model()` 2.1 µs → 1.8 µs. Budgets: `Object.keys()` < 1.5 µs, `toJSON()` < 2 µs, `JSON.stringify()` < 2.5 µs.
- Performance: a write stores the value without the Proxy receiver (no round trip through the `defineProperty` trap; a setter accessor declared with `@ActiveField` now runs with the raw instance as `this`), an event nobody listens to on the instance or on a class is skipped without walking the class chain, the per-write helper objects of the meta and emitter modules are gone, the undo history is consulted only when it is enabled, a `pattern` rule reuses the given `RegExp` (a `g` or `y` pattern is still copied), and `oneOf` with a TS enum is turned into its list of values once at declaration (`resolvePipeline().rules.oneOf` is then that list). Model with 10 fields: write 0.67 µs → 0.26 µs (with a validator and a hidden field 0.77 → 0.28, with history 0.74 → 0.34, with a class listener on a 3-level chain 1.67 → 1.10), `create()` 10.9 µs → 7.5 µs (tracked 19 → 14), an order with 5 nested lines 27 µs → 23 µs, `createFromCollection()` of 10k items 144 ms → 100 ms. Budget: a write < 0.5 µs.
- Performance: `ActiveCollection` reads go to the raw storage instead of through the `Proxy`: `for...of`, spread, `values()` / `keys()` / `entries()`, and `forEach`, `map`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `reduce`, `indexOf`, `includes` (the callback's third argument is now the collection; `filter` used to pass the storage). The subscriptions of a collection, map or set on its items live in a `WeakMap` (removing and re-adding the same item again and again walked an ever longer chain of deleted `Map` entries), and a sorted insert looks up the place of its first item once. 10k items: `for...of` 343 µs → 55 µs, spread 449 → 143, `forEach` 413 → 48, `map` 420 → 49, `filter` 206 → 49, `find` 230 → 46, `reduce` 395 → 15, `indexOf` 570 → 16, `includes` 338 → 22; `push` + `pop` of one item: sorted 40 µs → 1.8 µs, unsorted 23 → 0.8; `push` + `remove(item)` 45 → 5; sorted `push` into the middle + `splice` out 26–40 → 14–27 (the two shifts of 5k items are what is left). Budgets: `for...of` / `map` < 150 µs, `forEach` / `find` / `reduce` < 100 µs, `indexOf` / `includes` < 50 µs per 10k items, sorted `push` + `pop` < 8 µs.
- Performance: `transaction()` keeps nested models, containers and plain lists of models by reference instead of deep-cloning them, and its rollback restores them **in place**: a reference you kept to a nested instance or a container stays valid, a replaced one is put back, a container whose items changed is refilled, and the rollback's events fire on the nested model itself and bubble up as `touched` (a nested model under a `readonly` or non-`fillable` field is now rolled back too). Model with a 2000-row collection: `transaction()` 6.6 ms → 0.89 ms, rollback 11.4 ms → 0.67 ms (`push` + throw 6.4 → 1.5), 2000 `factory` lines 4.5 ms → 0.97 ms, 10 rows 40 µs → 6.8 µs, flat model 1.4 µs → 0.75 µs. Budgets per 2000 rows: `transaction()` < 2 ms, rollback < 1.5 ms.
- Performance: `transaction()` rolls back from a journal of changes instead of a snapshot: while a transaction is open, every write to the model or to a model nested anywhere below it and every operation of a container it holds records how to undo itself, and the rollback replays those records newest first. The transaction no longer walks the model up front, so its cost is `validate()` plus the writes, and a rollback costs in proportion to the changes, not to the size of the model. Model with a 2000-row collection: `transaction()` 0.89 ms → 0.48 ms, rollback 0.67 ms → 6.7 µs (`push` + throw 1.5 ms → 11 µs), 2000 `factory` lines 0.97 ms → 0.47 ms, 10 rows 6.8 µs → 4.3 µs; a flat model 0.75 µs → 0.84 µs. Budgets per 2000 rows: `transaction()` < 0.7 ms, rollback < 50 µs. Mutating a plain value in place inside a transaction (`m.list.push(x)`) is no longer undone - replace the value instead; an instance nested in two models at once is rolled back only by a transaction of the one it was bound to last.

## [5.0.0] - 2026-10-03

Migration guide: [docs/en/migration-5.md](docs/en/migration-5.md) ([RU](docs/migration-5.md)).

### Breaking changes

**English**

| 4.0.0 | next |
|---|---|
| `import { ActiveModel, ActiveField, EventType, ... } from '@alt-point/active-models'` | **no root entry**: import from subpaths - `/ActiveModel`, `/decorators`, `/types`, `/pipeline`, `/CallableModel`, `/Enum`, `/utils`, `/ActiveCollection`, `/ActiveMap`, `/ActiveSet`, `/collectionRegistry`, `/scalars/*` (see [Imports](docs/en/imports.md)) |
| `@ActiveField({ collection: [Model, opts] })`, `{ map: [Model, { key }] }`, `{ set: [Model, opts] }` | `@ActiveField({ container: ActiveCollection.field(Model, opts) })`, `ActiveMap.field(Model, { key })`, `ActiveSet.field(Model, opts)` (one option, same behavior) |
| `Model.collection(items, opts)` / `Model.createCollection(data, opts)` | `ActiveCollection.create(Model, items, opts)` / `ActiveCollection.createFromData(Model, data, opts)` |
| `lodash-es` was a dependency | removed; the package has no runtime dependencies |

Why: `ActiveModel` and `@ActiveField` used to import the collection classes, so every bundle carried them. They are now opt-in.

**Русский**

| 4.0.0 | дальше |
|---|---|
| `import { ActiveModel, ActiveField, EventType, ... } from '@alt-point/active-models'` | **корневого входа нет**: импорт из подпутей — `/ActiveModel`, `/decorators`, `/types`, `/pipeline`, `/CallableModel`, `/Enum`, `/utils`, `/ActiveCollection`, `/ActiveMap`, `/ActiveSet`, `/collectionRegistry`, `/scalars/*` (см. [Импорты](docs/imports.md)) |
| `@ActiveField({ collection: [Model, opts] })`, `{ map: [Model, { key }] }`, `{ set: [Model, opts] }` | `@ActiveField({ container: ActiveCollection.field(Model, opts) })`, `ActiveMap.field(Model, { key })`, `ActiveSet.field(Model, opts)` (одна опция, то же поведение) |
| `Model.collection(items, opts)` / `Model.createCollection(data, opts)` | `ActiveCollection.create(Model, items, opts)` / `ActiveCollection.createFromData(Model, data, opts)` |
| `lodash-es` был зависимостью | удалён; в пакете нет зависимостей в рантайме |

Зачем: `ActiveModel` и `@ActiveField` импортировали классы коллекций, и они попадали в каждый бандл. Теперь они подключаются явно.

### Added
- `npx @alt-point/active-models migrate <dir>` - a codemod for 4.x -> 5.0 (`bin/`, no dependencies): rewrites root imports into subpath imports and the collection API in `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs` / `.vue` files; dry run by default, `--write` applies, `--check` for CI; prints what it cannot rewrite with file and line.
- Tree-shakable packaging: one entry point and `exports` subpath per capability, `typesVersions` for legacy resolution, `sideEffects: false`. The bundle of `ActiveModel` shrinks from 15.7 KB to 8.2 KB gzipped; `ActiveCollection` / `ActiveMap` / `ActiveSet` and the scalars are included only when imported. Guards: `tests/treeshake.test.ts`, `tests/package-entries.test.ts`, `bun run test:dist` (the built package loads by subpath in ESM and CJS and shares one copy of every class).
- `ActiveCollection.field()`, `ActiveMap.field()`, `ActiveSet.field()` and the `container` field option; `ActiveCollection.createFromData()`.
- Zero runtime dependencies: `lodash-es` is replaced by a vendored deep clone (`src/clone.ts`, checked against lodash in the tests).

### Fixed
- `deepEqual` (and so `isTouched()` / `changes()`) looped forever when comparing two `DataView`s.

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
- Value objects `Decimal` (BigInt-based, explicit rounding), `Money` (currency-aware, `allocate()`), `LocalDate` (no time zone), `markImmutable()`. `coerce` / `type` accept a class with a static `from()`, `min` / `max` accept values with `compareTo()`.
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
