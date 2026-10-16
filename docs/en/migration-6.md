# Migrating from 5.x to 6.0

Version 6.0 removes behaviors deprecated in 5.x. There is no codemod for this release: each item below is a runtime
error that you fix at the call site.

| 5.x | 6.0 |
|---|---|
| `Model.create('str' / 42 / true / null)` was treated as `create({})` (with a `console.warn` since 5.1) | throws a `TypeError` (`User.create() expects an object, got null`), and so does `new Model(primitive)`; `create()` with no argument still gives an empty model |

## 1. `Model.create(primitive)` throws

A string, a number, a boolean or `null` passed as the data used to give an empty model, so a missing record went on
as `{}`. Now it throws a `TypeError`:

```ts
// before
const user = User.create(await api.findUser(id)) // null -> an empty User

// after
const user = User.create(await api.findUser(id)) // TypeError: User.create() expects an object, got null
```

Check the data before the call, or call `create()` with no argument when you want an empty model:

```ts
const data = await api.findUser(id)
const user = data ? User.create(data) : null
const draft = User.create() // an empty model, as before
```

The 5.x warning (`User.create() got null instead of an object: ...`) points at the calls to fix. Besides direct
`create()` calls, they include:

- `createLazy()`, and `asyncCreate()` / `asyncCreateLazy()` whose promise resolves to `null`, a string, a number or a
  boolean (they reject);
- a primitive item of `createFromCollection()` other than `null` / `undefined`, e.g. `User.createFromCollection(['a'])`;
- a `factory` field that gets a primitive it used to wrap into an empty model:
  `Order.create({ address: 'Berlin' })` throws `Address.create() expects an object, got "Berlin"`.

`new User(null)` throws too (`new User() expects an object, got null`); in 5.x it gave an empty model without a warning.

## What is not affected

- `create()` with no argument (or `undefined`) gives an empty model, as before.
- `createFromCollection()` still skips `null` / `undefined` items.
- `create([])` already threw a `TypeError` in 5.x.
