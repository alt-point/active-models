`ActiveModel`: advanced features
===

This covers API features that aren't shown in the main worked example
([active-model-with-decorators.md](active-model-with-decorators.md)): validators, lifecycle hooks,
the difference between the ways to create a model, serialization, and mapping to other structures.

## Validators

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

class Product extends ActiveModel {
  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'number' || value < 0) {
        throw new TypeError(`"${prop}" must be a non-negative number, got ${value}`)
      }
    }
  })
  price: number = 0
}

const product = Product.create({ price: 100 })

try {
  product.price = -50
} catch (e) {
  console.error((e as Error).message) // "price" must be a non-negative number, got -50
}

console.log(product.price) // 100 — the value was not changed
```

**Important:** `validator` is not a predicate. Its return value (`true`/`false`) has no effect on the
outcome — it is simply discarded. The only way to reject a value is to **throw** inside the validator.

**Even more important:** the validator (like `setter`, and the `beforeSetValue`/`afterSetValue` events)
only fires when the new value **differs** from the current one (compared with `Object.is`). It will
**not** fire if the field is simply absent from the object passed to `create()`/`fill()`, and it will
**not** fire if you explicitly pass a value that happens to equal the field's current value (e.g. its
initializer default). So a validator can't catch a *missing* required field — only an *invalid* value
**when the field is actually being changed**. For required-field checks, verify the key is present in
the input before calling `create()` (see the example in [node-example.md](node-example.md)).

```ts
class Task extends ActiveModel {
  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`"${prop}" must be a non-empty string`)
      }
    }
  })
  title: string = ''
}

Task.create({}) // does NOT throw — title stays the default '', validator never ran
Task.create({ title: '' }) // also does NOT throw — the new value equals the current one, skipped again
Task.create({ title: 123 as any }) // throws — the value genuinely differs from '', validator ran
```

## `on` / `once` hooks

There are two independent levels of subscribing to field events (`beforeSetValue`, `afterSetValue`,
`beforeDeletingAttribute`, `nulling`):

1. **Via the decorator** `@ActiveField({ on: {...} })` (or `once`) — registered once when the class is
   defined, shared across **all** instances of that class. Fires only for the property the decorator
   was applied to.
2. **Via `model.emitter.on(...)` / `.once(...)`** — registered on a specific instance. Fires for
   **any** active field on that instance — filter by property name yourself via `payload.prop` if needed.

```ts
import { ActiveModel, ActiveField, EventType } from '@alt-point/active-models'

class Order extends ActiveModel {
  @ActiveField({
    on: {
      beforeSetValue ({ prop, value, oldValue }) {
        console.log(`[${prop}] about to change: ${oldValue} → ${value}`)
      },
      afterSetValue ({ prop, value }) {
        console.log(`[${prop}] changed to ${value}`)
      },
      // fires only when a value that was NOT null becomes null
      // (transitioning to undefined does not trigger this event)
      nulling ({ prop, oldValue }) {
        console.log(`[${prop}] nulled out (was: ${oldValue})`)
      }
    }
  })
  status: string = 'new'

  @ActiveField({ protected: true })
  total: number = 0
}

const order = Order.create({})
order.status = 'paid' // triggers beforeSetValue and afterSetValue above

try {
  delete (order as any).total // total is marked protected
} catch (e) {
  console.error((e as Error).message) // Property "total" is protected!
}
```

Instance-level subscription, for comparison:

```ts
const off = order.emitter.on(EventType.afterSetValue, ({ prop, value }: any) => {
  console.log(`instance listener: [${prop}] → ${value}`)
})

order.status = 'shipped' // both the decorator hook and the listener above fire

off() // unsubscribe

const unsubscribeOnce = order.emitter.once(EventType.afterSetValue, () => {
  console.log('fires only once')
})
order.status = 'delivered' // fires
order.status = 'cancelled' // no longer fires
```

## `new Model(data)` vs `Model.create(data)` vs `.fill(data)`

### Gotcha: `new Model(data)` can silently drop the data you passed in

```ts
class User extends ActiveModel {
  @ActiveField() name: string = 'Guest'
}

const viaConstructor = new User({ name: 'Alice' })
console.log(viaConstructor.name) // "Guest" — the data was lost!

const viaCreate = User.create({ name: 'Alice' })
console.log(viaCreate.name) // "Alice" — as expected
```

This comes down to JS/TS class-field initializer ordering: the field initializer (`name: string = 'Guest'`)
runs **after** `super(data)` returns, and overwrites whatever `ActiveModel`'s own constructor already
filled in from `data`. `Model.create(data)` sidesteps this — it constructs the instance first (letting
field initializers run), and only fills it with data afterwards.

**Recommendation:** use `Model.create(data)` (and `createLazy`/`asyncCreate*`/`asyncCreateLazy`) as your
primary way to build models from data. If you need to override the constructor, the documented workaround
is to call `this.fill(data)` explicitly after `super(data)`:

```ts
class User extends ActiveModel {
  @ActiveField() name: string = 'Guest'

  constructor (data?: any) {
    super(data)
    if (data) {
      this.fill(data)
    }
  }
}

new User({ name: 'Alice' }).name // "Alice" — the workaround restores the data
```

### `fill()`

`.fill(data, force?)` — fills fields on an already-created instance.

- Without `force` — only fills "own" keys: fields already declared on the model, or fields registered
  as `fillable`. Unknown keys in `data` are silently ignored.
- With `force: true` — fills **any** key from `data`, including undeclared ones — use with care, this
  can add arbitrary properties to the model outside its schema.
- A field marked `fillable: false` still **won't** be overwritten by `fill()`, even with `force: true` —
  `force` only lifts the "is this a known field" check, not the `fillable` check inside the proxy setter
  itself. `readonly` follows a subtler rule — see the [`readonly`](#readonly) section below.

```ts
const user = User.create({ name: 'Alice' })
user.fill({ unknownField: '...' } as any) // ignored — unknownField is not declared and not fillable
user.fill({ unknownField: '...' } as any, true) // added forcibly
```

### `fillable`

By default (`@ActiveField()` with no options), a field gets `fillable: true, protected: true` — it can be
changed but cannot be `delete`d. `fillable: false` means the field can't be changed either via
`create()`/`fill()` or by direct assignment.

```ts
class Invoice extends ActiveModel {
  @ActiveField({ fillable: false })
  number: string = 'INV-0001'
}

const invoice = Invoice.create({ number: 'HACKED' })
console.log(invoice.number) // "INV-0001" — the passed value was silently ignored during create()

try {
  invoice.number = 'HACKED-2'
} catch (e) {
  console.error((e as Error).message) // 'set' on proxy: trap returned falsish for property 'number'
}
```

Note the asymmetry: `create()`/`fill()` silently ignore a blocked write (they call `Reflect.set` as a
plain function — it just returns `false`, no exception), while a **direct assignment** (`model.prop = x`)
does throw — that's how strict-mode `Proxy` invariants work for ES classes.

### `readonly`

A field marked `readonly: true` can be set **exactly once** — via `Model.create(data)` (the factory), via
`new Model(data)` (the constructor), or from the class-field initializer's value, whichever happens first.
After that, any further attempt to change it — through `fill()` (even with `force: true`) or direct
assignment — is **silently ignored**: no exception, the value just doesn't change.

```ts
class Order extends ActiveModel {
  @ActiveField({ readonly: true })
  id: string = ''
}

const a = Order.create({ id: 'A1' })
console.log(a.id) // 'A1' — taken from data

a.id = 'A2'
console.log(a.id) // still 'A1' — the write was silently ignored

const b = new Order({ id: 'B1' })
console.log(b.id) // 'B1' — works the same way through the constructor
```

**Why this is silent rather than throwing** (unlike `fillable: false` above): if a blocked write threw,
the common "readonly field + its own initializer" pattern would break the constructor. With
`new Model(data)`, a subclass's own field initializer (`id: string = randomUUID()`) runs **after**
`super(data)` — meaning it lands on the proxy as a *second* write to the same field (the first happened
while `data` was being filled inside `super()`), and if that threw, construction itself would fail.

**If you need client data to be completely unable to influence a field** — e.g. `id`/`createdAt` that
must only ever come from the server (see [node-example.md](node-example.md)) — `readonly` alone
isn't enough: since it accepts a value from `data` on the first attempt, an attacker can simply include
that field in `data` and claim the one allowed write for themselves. For a genuinely server-only field,
combine `readonly` with `fillable: false` — that combination behaves like plain `fillable: false` (always
blocks writes, including the first one from `data`), so the class-field initializer becomes the only
possible source of the value:

```ts
class Task extends ActiveModel {
  @ActiveField({ readonly: true, fillable: false })
  id: string = randomUUID() // the only possible source of the value
}

Task.create({ id: 'spoofed' }).id // the generated UUID, not 'spoofed' — data is fully ignored
```

## Serialization and `toJSON()`

```ts
class User extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField({ hidden: true }) passwordHash: string = ''
  @ActiveField({ protected: true }) role: string = 'user'
  @ActiveField({ readonly: true }) createdAt: string = new Date().toISOString()
}

const user = User.create({ id: '1', passwordHash: 'a1b2c3', role: 'admin' })

console.log(Object.keys(user)) // ['id', 'role', 'createdAt'] — passwordHash is absent
console.log(JSON.stringify(user)) // {"id":"1","role":"admin","createdAt":"..."}
console.log(user.passwordHash) // "a1b2c3" — hidden only hides it from enumeration/serialization
```

- **`hidden`** — the field never shows up in `Object.keys()`, `for...in`, `{...spread}` or
  `JSON.stringify()`, but remains directly accessible (`user.passwordHash`). A good fit for passwords or
  tokens the model needs to hold but should never accidentally serialize outward.
- **`protected`** — the field is visible and serializes normally, but `delete user.role` throws.
- **`readonly`** — the field is visible and serializes normally, but cannot be assigned a new value after
  creation (see also the `fillable`/`readonly` note above).

## `mapTo()` / `hasMapping()`

Lets you define a conversion rule from a model to another structure (a backend DTO, a view model, etc.)
once, and reuse it on any instance.

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

class Order extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField() total: number = 0
}

// The target structure doesn't have to be an ActiveModel
class OrderPayload {
  constructor (public orderId: string, public amountCents: number) {}
}

// Register the mapping once — e.g. at your app's init point
Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))

const order = Order.create({ id: '42', total: 19.99 })

order.hasMapping(OrderPayload) // true

const payload = order.mapTo(OrderPayload)
// payload instanceof OrderPayload → { orderId: '42', amountCents: 1999 }
```

By default `mapTo(target, lazy = true, ...args)` is "lazy": if no mapping is registered for `target`, it
silently returns `order.clone()` instead of throwing. Pass `lazy: false` to fail loudly instead:

```ts
class Unmapped {}
order.mapTo(Unmapped) // no mapping registered → silently returns order.clone()
order.mapTo(Unmapped, false) // throws: "Mapping for target not found"
```
