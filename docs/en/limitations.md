# Known limitations

Things that don't work the way you might expect - and what to do instead. Everything here is covered by
tests in the repository.

## In-place mutations don't emit events

`ActiveModel` intercepts **assigning a field** (`model.items = ...`), not mutating the value inside it.
`model.items.push(x)` or `model.address.city = 'X'` (for a plain object, not a model) doesn't fire
`touched`, `afterSetValue` or field hooks. `isTouched()` does see such a change - it compares the whole
state - but no events are emitted.

```ts
model.items.push('a')               // isTouched() → true, but touched is NOT emitted
model.items = [...model.items, 'a'] // afterSetValue and touched are emitted
```

**What to do:** replace the value as a whole, and declare nested structures that need events through
`factory` - then it's a separate `ActiveModel`, and a change to its field bubbles up as `touched`.

## `new Model(data)` can silently drop data

Subclass field initializers run after the constructor and overwrite the filled value. Use
`Model.create(data)`. Details: [`new` vs `create` vs `fill`](/en/active-model-advanced#new-model-data-vs-model-create-data-vs-fill-data).
A side effect of the same ordering: on this path the field initializers emit `touched` (after the
constructor), and `created` arrives asynchronously, via a microtask.

## `hidden` fields and `isTouched()`

The `isTouched()` snapshot is built through the same `ownKeys` as serialization, so changing a `hidden`
field doesn't make the model "touched". `clone()`, however, **keeps** `hidden` values.

## `create(existingModel)` doesn't copy `hidden` fields

Passing a ready model to `create()` clones it as data - and data is walked with `for...in`, which doesn't
see `hidden` fields. Use `model.clone()` for an exact copy.

## `Object.isFrozen()` and `makeFreeze()`

`makeFreeze()` protects the model through traps, not `Object.freeze()` (which would force `ownKeys` to
expose `hidden` fields), so `Object.isFrozen(model)` returns `false`. The freeze is shallow.

## `clone()` doesn't copy listeners and doesn't emit `created`

Instance-level listeners stay on the original; class-level listeners (`Model.on`) keep working on the
clone, but no `created` is emitted for it - it wasn't "created" via `create()`/`new`.

## A listener can't reject a value

An exception in a listener reaches the caller, but the value has already been written. Reject values in a
`validator` (it runs before the write).

## `validator` doesn't run for an absent or unchanged value

Details: [Advanced features → Validators](/en/active-model-advanced#validators).

## `createFromCollection` skips only `null`/`undefined`

Every other item (primitives included) goes to `create()`; an array instead of an object in `create()`
throws a `TypeError` pointing at `createFromCollection()`.
