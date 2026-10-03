# Migrating from 3.x to 4.0

Version 4.0 closes public surfaces that allowed bypassing model invariants, and fixes a number of bugs.
There are five breaking changes.

## 1. `model.emitter` removed → `on` / `once`

```ts
// before
model.emitter.on(EventType.afterSetValue, cb)
model.emitter.once(EventType.afterSetValue, cb)

// after
model.on(EventType.afterSetValue, cb)      // on an instance
model.once(EventType.afterSetValue, cb)
Model.on(EventType.afterSetValue, cb)      // NEW: on the class, for every instance (and subclass)
```

`emit()` is no longer reachable from outside - a lifecycle event can't be forged. `on`/`once` still return
an unsubscribe function.

## 2. `startTracking()` removed

The `isTouched()` snapshot is now only taken at creation: `Model.create(data, { tracked: true })`.
Resetting the baseline after a save means recreating the model:

```ts
// before
await api.save(form.toJSON())
form.startTracking()

// after
form = Form.create(await api.save(form.toJSON()), { tracked: true })
```

A model built via `new Model(data)` can't be tracked (`isTouched()` returns `undefined`).

## 3. `create()` throws a `TypeError` for an array

`Model.create([...])` used to silently return an empty model. Now it throws with a hint; use
`Model.createFromCollection([...])` for lists.

## 4. `createFromCollection` skips only `null` / `undefined`

Any falsy value (`0`, `''`, `false`) used to be dropped. Now only `null`/`undefined` are.

## 5. No root import: one subpath per capability

`import { ... } from '@alt-point/active-models'` no longer resolves. Import each capability from its own subpath;
the full list is in [Imports and tree-shaking](/en/imports).

```ts
// before
import { ActiveModel, ActiveField, EventType, ValidationError } from '@alt-point/active-models'

// after
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'
import { ValidationError } from '@alt-point/active-models/pipeline'
```

| Was exported from the root | Subpath |
|---|---|
| `ActiveModel` | `/ActiveModel` |
| `ActiveField`, `ActiveFactory`, `GetterMethod`, `SetterMethod`, `InvariantMethod` | `/decorators` |
| `EventType` and every option / payload type | `/types` |
| `ValidationError`, `FieldRules`, ... | `/pipeline` |
| `CallableModel` | `/CallableModel` |
| `Enum` | `/Enum` |
| `ModelProperties`, `RecursivePartialActiveModel` | `/utils` |

The sub-paths `/ActiveModel`, `/CallableModel` and `/decorators` already existed in 3.x. Only what you import is bundled;
the library has no runtime dependencies any more (`lodash-es` is gone).

## Behavior changes (non-breaking)

| What | Before | After |
|---|---|---|
| Subscriptions on a parent class | didn't fire for subclasses | fire |
| `created` / `touched` payload | none | `{ target }` |
| `touched` during `create()` | emitted for the initial fill | not emitted |
| `touched` and a rejected write | emitted before the checks | emitted after a successful write; bubbles up from nested models |
| A `value: []` / `{}` default | one object shared by every instance | a copy per instance |
| `once` in `@ActiveField` | could miss if the first event was for another field | fires on the first event of its own field |
| `@ActiveFactory(undefined)` | silently did nothing | `ReferenceError` at class definition |
| An exception in a listener | aborted the remaining listeners | all listeners run, then the first error is thrown |
| `toJSON()` for `Date`/`Set`/`Map` | `{}` | ISO string / array / object |
| `clone()` | a plain object without `Proxy`, lost `hidden` | a full model, `hidden` kept, baseline carried over |
| `makeFreeze()` | confusing error about `Symbol(@touched)` | a clear `TypeError` |
| `'hidden' in model` | `true` | `false` |
| `createFromCollection` | typed `ActiveModel[]` | `InstanceType<T>[]` |
| `CallableModel` | `extends Function` (needs `unsafe-eval` under CSP) | a plain function, CSP-safe |
| ESM build | `AsyncLocalStorage` silently disabled | not used at all |
