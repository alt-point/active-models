# Migrating from 5.x to 6.0

Version 6.0 removes behaviors and APIs deprecated in 5.x. There is no codemod for this release: each item below is a
runtime or build error that you fix at the call site.

| 5.x | 6.0 |
|---|---|
| `Model.create('str' / 42 / true / null)` was treated as `create({})` (with a `console.warn` since 5.1) | throws a `TypeError` (`User.create() expects an object, got null`), and so does `new Model(primitive)`; `create()` with no argument still gives an empty model |
| `import { Enum } from '@alt-point/active-models/Enum'` (deprecated since 4.x) and the `EnumItemType` type from `/types` | removed: use a TS `enum` or a string union with the `oneOf` rule (`@ActiveField({ oneOf: Status })`) |

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

## 2. `Enum` removed

The `/Enum` subpath, the `Enum` class and the `EnumItemType` type are gone, so
`import { Enum } from '@alt-point/active-models/Enum'` no longer resolves. List the allowed values in a TypeScript `enum`
or an `as const` array (its item type is the string union) and let the [`oneOf` rule](/en/validation) refuse the rest:

```ts
// before
import { Enum } from '@alt-point/active-models/Enum'

export const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

class Order extends ActiveModel {
  @ActiveField({ validator: (_model, _prop, value) => OrderStatuses.validate(value) })
  status: string = OrderStatuses.default
}

// after
export enum OrderStatus { New = 'new', Complete = 'complete', Shipping = 'shipping' }

class Order extends ActiveModel {
  @ActiveField({ oneOf: OrderStatus })
  status: OrderStatus = OrderStatus.New
}
```

| `Enum` | 6.0 |
|---|---|
| `new Enum(['new', 'complete'], 'new')` | `enum OrderStatus { ... }` or `const STATUSES = ['new', 'complete'] as const` |
| `.default` | the field initializer or the `value` option |
| `.values()`, `.keys()` | `Object.values(OrderStatus)` (a string enum) or the array itself |
| `.has(v)` | `(Object.values(OrderStatus) as string[]).includes(v)` or the array's `includes` |
| `.validate(v)` in a `validator` | `oneOf`: a refused value throws `ValidationError` with code `oneOf` instead of a plain `Error` |

`.get(v)` and `.entries()` have no counterpart: `get(v)` returned `v` or `undefined`, `entries()` the pairs `[v, v]`.

`validate([a, b])` over an array of values has no rule of its own: keep a `validator` that checks each item, e.g.
`validator: (_m, _p, v: OrderStatus[]) => v.every((s) => Object.values(OrderStatus).includes(s))`.

## What is not affected

- `create()` with no argument (or `undefined`) gives an empty model, as before.
- `createFromCollection()` still skips `null` / `undefined` items.
- `create([])` already threw a `TypeError` in 5.x.
