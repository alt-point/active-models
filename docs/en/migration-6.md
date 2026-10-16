# Migrating from 5.x to 6.0

Version 6.0 removes `Enum` (deprecated since 4.x) and changes three behaviors that could not be fixed compatibly. There is no
codemod for this release: items 1 and 2 are a runtime or build error you fix at the call site; items 3 and 4 change what
existing code does, so review the places they name.

Coming from 4.x? Do [migrating to 5.0](/en/migration-5) first.

| 5.x | 6.0 |
|---|---|
| `Model.create('str' / 42 / true / null)` was treated as `create({})` | throws a `TypeError` (`User.create() expects an object, got null`), and so does `new Model(primitive)`; `create()` with no argument still gives an empty model |
| `import { Enum } from '@alt-point/active-models/Enum'` (deprecated since 4.x) and the `EnumItemType` type from `/types` | removed: use a TS `enum` or a string union with the `oneOf` rule (`@ActiveField({ oneOf: Status })`) |
| A field `validator` that returned `false` was ignored: the write went through | refuses the write: `ValidationError` with code `validator` and the message `"prop" is invalid`; `validate()` reports a stored value the same way. Throwing works as before; `true` / `undefined` accept |
| `transaction()` rolled back from a snapshot, so a plain value mutated in place (`m.tags.push(x)`, `m.date.setHours(0)`) was restored too | rolls back from a journal of writes: an in-place mutation of a plain value is not a write and stays after the rollback; replace the value instead (`m.tags = [...m.tags, x]`) |

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

The check runs wherever data turns into a model, not only in direct `create()` calls:

- `createLazy()`, and `asyncCreate()` / `asyncCreateLazy()` whose promise resolves to `null`, a string, a number or a
  boolean (they reject);
- a primitive item of `createFromCollection()` other than `null` / `undefined`, e.g. `User.createFromCollection(['a'])`;
- a `factory` field that gets a primitive it used to wrap into an empty model:
  `Order.create({ address: 'Berlin' })` throws `Address.create() expects an object, got "Berlin"`.

`new User(null)` throws too (`new User() expects an object, got null`); in 5.x it gave an empty model. The TypeScript
signatures of `create()`, `createLazy()`, `asyncCreate()` / `asyncCreateLazy()` and the constructor no longer accept `null`, so
such a call fails to compile; `fill(null)` (treated as `{}`) and `null` items of `createFromCollection()` are typed as before.

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

## 3. A `validator` that returns `false` refuses the write

In 5.x only a throwing `validator` refused a value; its return value was ignored, so a predicate-style validator let
everything through. Now `false` refuses the write with a `ValidationError` (code `validator`, message `"prop" is invalid`),
and `validate()` reports a stored value the validator rejects. `true`, `undefined` and throwing work as before
([`validator`](/en/active-field-options#validator)).

```ts
class Product extends ActiveModel {
  @ActiveField({ validator: (_m, _p, v: number) => v >= 0 }) price: number = 0
}

const product = Product.create({ price: 1 })
product.price = -1 // 5.x: written; 6.0: ValidationError: "price" is invalid
```

- A validator that was meant to refuse needs no change; throw instead of returning `false` to give your own message.
- A validator that runs for a side effect and happened to return `false` should return nothing: `validator: (_m, _p, v) => { track(v) }`.
- Code that wrote a value the validator disagrees with and handled it later now gets the exception at the write.

## 4. `transaction()` does not undo in-place mutations of plain values

The rollback used to restore the model from a snapshot taken at the start, which also put back a plain array or `Date`
mutated in place. Now it replays a journal of writes, which is what makes its cost
[proportional to the changes](/en/integrity), and an in-place mutation of a plain value is not a write: `m.tags.push(x)` or
`m.date.setHours(0)` stays after the rollback. Nested models and containers (`ActiveCollection` / `ActiveMap` / `ActiveSet`)
record their own operations and are restored as before.

```ts
order.transaction((o) => {
  o.tags.push('rush')          // stays after the rollback
  o.tags = [...o.tags, 'rush'] // undone
  throw new Error('abort')
})
```

Replace values instead of mutating them (`m.tags = [...m.tags, x]`, `m.date = new Date(...)`): the rule events, dirty
tracking and history already followed.

## What is not affected

- `create()` with no argument (or `undefined`) gives an empty model, as before.
- `createFromCollection()` still skips `null` / `undefined` items.
- `create([])` already threw a `TypeError` in 5.x.
