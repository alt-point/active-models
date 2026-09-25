# @alt-point/active-models — guide for AI agents

Use this file when writing code **with** this library (a consumer) or **on** it (a contributor).
Full docs: https://alt-point.github.io/active-models/ · Source of truth is `src/` and `tests/`.

## What it is

Reactive, self-validating DTO models built on `Proxy` + legacy TypeScript decorators. A model class
extends `ActiveModel`; each field is declared with `@ActiveField(options)`.

Requires `"experimentalDecorators": true` in tsconfig (legacy decorators, not TC39 stage-3).

```ts
import { ActiveModel, ActiveField, EventType } from '@alt-point/active-models'

class User extends ActiveModel {
  @ActiveField({ readonly: true }) id: string = ''
  @ActiveField({ validator: (_m, prop, v) => { if (!v) throw new TypeError(`${prop} required`) } })
  name: string = 'Guest'
  @ActiveField({ hidden: true }) passwordHash: string = ''
  @ActiveField({ factory: Address }) address?: Address        // nested model (arrays too)
}

const user = User.create({ id: '1', name: 'Ann' })   // ALWAYS create via the factory
user.name = 'Bob'
JSON.stringify(user)                                  // hidden fields are excluded
```

## Rules that prevent the most bugs

1. **Build models with `Model.create(data)`, never `new Model(data)`.** Field initializers run *after*
   the constructor and overwrite the data `new` filled in. (`createLazy` returns an existing instance as-is.)
2. Lists: `Model.createFromCollection([...])`. `create([...])` throws.
3. Async data: `Model.asyncCreate(promise)`, `asyncCreateFromCollection(promise)`.
4. A `validator` rejects only by **throwing**; its return value is ignored. It runs only when the value
   actually changes, so it can't enforce "field is required" — check keys before `create()`.
5. Never rely on a listener to veto a write (the value is already written); use `validator`.
6. Replace values instead of mutating them in place: `m.items = [...m.items, x]`, not `m.items.push(x)` —
   in-place mutation emits no events (nested `ActiveModel`s via `factory` do bubble `touched`).
7. Don't reach into the raw object: the `target` in `beforeSetValue`/`afterSetValue`/`nulling`/
   `beforeDeletingAttribute` payloads is the raw instance — read only.
8. There is no `model.emitter` and no `startTracking()` (removed in 4.0) — see migration below.

## `@ActiveField` options

| Option | Effect |
|---|---|
| `value` / `attribute` | default for a key absent from `create()` data (value or `() => value`) |
| `validator(model, prop, value)` | throw to reject |
| `setter(model, prop, value, receiver)` / `getter(model, prop, receiver)` | transform on write / read |
| `readonly: true` | can be set once at creation, later writes are silently ignored |
| `fillable: false` | data can never set it; direct assignment throws |
| `hidden: true` | excluded from `Object.keys`, spread, `in`, `JSON.stringify`, `isTouched()`; still readable directly |
| `protected` (default `true`) | `delete` throws; set `false` to allow delete |
| `factory: Model` / `[Model, () => default]` | wrap nested object / array items in `Model` |
| `on: { afterSetValue, ... }` / `once` | field-level hooks, shared by all instances (and subclasses) |

## Validation pipeline (every write)

`transform (trim/lowercase/uppercase/fn) → coerce → same value? stop → transitions → rules → validator → events`.
Rules: `required` (not null/undefined/''), `type`, `min`/`max` (number or Date), `minLength`/`maxLength`, `pattern`,
`oneOf` (array or TS enum). A refused write throws `ValidationError` (`.issues`). `model.validate()` → `{ valid, issues }`
covers **all** fields, including ones never set (`required`), nested models and collections (`history[1].city`);
`assertValid()` throws; `create(data, { validate: true })` too. `transitions: { new: ['paid'], paid: [] }` restricts state
changes (first value and creation from data are free); `canTransition()`, `allowedTransitions()`.
`static strict = true` refuses writes to undeclared properties. Rules are bypassed when values are restored (undo/rollback).
Cross-field rules: `@InvariantMethod('msg') static ok(m) { return … }` / `Model.defineInvariant(name, check)`, checked by
`validate()`/`transaction()`/atomic `fill()`, not per write. `model.transaction(fn)` is all-or-nothing (rolls back on a throw or an
invalid result; async ok); `fill(data, { atomic: true })`. Tracked models (`{ tracked: true }`) have `changes()`, `dirtyFields()`,
`isDirty(f)`, `revert(f?)`, `reset()`. `create(data, { history: true | { limit } })` enables `undo()`/`redo()`/`canUndo()`/`canRedo()`/`clearHistory()`;
a transaction is one step.

## Events

`EventType`: `beforeSetValue`, `afterSetValue`, `nulling` (non-null → `null` only),
`beforeDeletingAttribute`, `touched`, `created`. Payloads: `{ target, prop, value, oldValue }`;
`beforeDeletingAttribute` → `{ target, prop }`; `touched`/`created` → `{ target }` (the model itself).

```ts
const off = user.on(EventType.afterSetValue, ({ prop, value }) => {})   // one instance; returns unsubscribe
User.on(EventType.created, ({ target }) => {})                          // every instance + subclasses
user.once(...) / User.once(...)
```

- `create()` emits `created` synchronously; `new Model()` emits it in a microtask. Children before parents.
- `touched` is not emitted during creation. `created` listeners must be registered *before* `create()`
  (use `Model.on`, or `static beforeFill(model, data)` to reach the instance under construction).
- Listener errors: all listeners run, then the first error is rethrown (several → `error.errors`).

## Other API

- `model.fill(data, force?)` — partial update; ignores unknown / `fillable: false` keys unless `force`.
  Does not re-apply `value` defaults.
- `model.toJSON()` — hidden/functions/symbols dropped; honors `toJSON()` (Date), `Set`→array, `Map`→object.
- `model.clone()` — deep, fully working proxied copy (hidden kept, locks + `isTouched` baseline carried).
- `model.makeFreeze()` — shallow; later write/delete throws `TypeError`.
- Dirty tracking: `Model.create(data, { tracked: true })`; `model.isTouched()` → `true`/`false`, or
  `undefined` if never tracked. Reset the baseline by re-creating the model. `model.getRaw()` returns the
  frozen source data exactly as passed to that `create()` (pre-defaults, pre-strip), `undefined` if untracked.
- Mapping: `Model.mapTo(Target, (m, ...args) => ...)`, `model.mapTo(Target, lazy = true, ...args)`,
  `hasMapping(Target)`. `lazy` (default) falls back to `clone()`; `lazy: false` throws.
- Collections: `Model.collection(items, { sortBy, compare, order, coerce })` /
  `Model.createCollection(data, opts)` / `@ActiveField({ collection: Model | [Model, options] })` give an
  `ActiveCollection`: an array that accepts only instances of that model (plain objects are coerced unless
  `coerce: false`; anything else throws), never has holes, and — with `sortBy`/`compare` — stays sorted
  (`push` inserts in place, items move when their key changes, `bisectLeft/Right`, `findByKey`, `range`).
  `unique: 'field' | fn` rejects duplicate keys atomically (`ValidationError` code `unique`; `getByKey`/`hasKey`).
  `ActiveMap.create(Model, { key })` / `ActiveSet.create(Model, items, { unique })` and the `map: [Model, { key }]` / `set: Model | [Model, opts]`
  field options give the keyed / set flavours with the same rules. Events: `itemsAdded`, `itemsRemoved`, `touched` (bubbles into the parent model). Use its own methods, not
  `Array.prototype.x.call(collection)` (guarded but not atomic).
- `CallableModel` — instances are callable, implement `__call`. `Enum` is deprecated.

## Migrating 3.x → 4.0

`model.emitter.on(...)` → `model.on(...)`; `form.startTracking()` → `form = Form.create(saved, { tracked: true })`;
`create([...])` → `createFromCollection([...])`. Details: `docs/en/migration.md`.

## Contributing to this repo

```bash
bun install
bun run typecheck && bun run lint && bun run test        # all must pass
bun run test:coverage                                    # thresholds enforced
bun run test:perf                                        # performance budgets
bun run test:mutation                                    # Stryker mutation testing
bun run build                                            # tsup -> dist/
bun run docs:dev                                         # VitePress
```

- Tests use a custom esbuild transform (`vitest.config.ts`) so they compile decorators exactly like the
  published build; don't replace it with SWC/oxc — class-field/Proxy timing differs.
- Style: no semicolons, single quotes, `space-before-function-paren` (enforced by ESLint).
- Add a test for every behavior change and update `docs/` (RU) + `docs/en/` (EN) + `CHANGELOG.md`.
- Versioning is strict SemVer (rules at the top of `CHANGELOG.md`): breaking → MAJOR, feature → MINOR,
  fix → PATCH. Record every user-visible change under `## [Unreleased]` in the same commit and mark
  breaking commits with `!` (`fix!:`) plus a `BREAKING CHANGE:` footer.
- Commit messages: conventional commits; do not add co-author footers.
