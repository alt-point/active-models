`@ActiveField()`: complete options reference
===

`@ActiveField(opts: ActiveFieldDescriptor)` is the single decorator used to describe model fields. Below
is every option on its own: what it does, what it affects, how it interacts with the others, and an
example. The call order overview (validator → events → setter) is at the end of the document.

Every example here has been verified against a real build (`tsup`/esbuild), not just read from the source.

```ts
type ActiveFieldDescriptor = {
  setter?: Setter<any>
  getter?: Getter<any>
  validator?: Validator<any>
  readonly?: boolean
  hidden?: boolean
  fillable?: boolean
  protected?: boolean
  attribute?: any
  value?: any
  factory?: typeof ActiveModel | [typeof ActiveModel, () => any]
  on?: Partial<Record<PropEvent, ActiveModelHookListener>>
  once?: Partial<Record<PropEvent, ActiveModelHookListener>>
}
```

**Defaults** (when an option isn't given explicitly): `fillable: true`, `protected: true`,
`hidden: false`, `readonly: false`. A bare `@ActiveField()` is a field that can be changed but not
`delete`d.

```ts
class User extends ActiveModel {
  @ActiveField() name: string = ''
}

const user = User.create({ name: 'Alice' })
user.name = 'Bob' // fine - fillable: true by default
delete (user as any).name // throws: Property "name" is protected!
```

---

## `value` / `attribute`

The field's default value. `value` is just an alias for `attribute` - there is no semantic difference
(`options.attribute || options.value`, whichever is set, is used).

Applied via `Model.create(data)` (and `new Model(data)` - but see the warning in
[active-model-advanced_EN.md](active-model-advanced_EN.md#new-model-data-vs-model-create-data-vs-fill-data))
when the field is **absent** from the data passed in. If the field is present in the data, the data wins.

```ts
class User extends ActiveModel {
  @ActiveField({ value: 'Guest' }) name?: string
}

User.create({}).name // 'Guest'
User.create({ name: 'Alice' }).name // 'Alice' - data beats the default
```

You can pass a function - it's called lazily, once per instance created (useful for non-primitive
values, so instances don't share the same reference):

```ts
@ActiveField({ value: () => [] })
items: string[] = []
```

**With `readonly`**: works fine - if the field hasn't been written any other way yet, `attribute`/`value`
becomes its value for the instance's whole lifetime.

**With `fillable: false`**: **does not work**. `fillable: false` strips the field out of the
`create()`/`fill()` data flow before `attribute`/`value` ever gets a chance to apply - the only source of
a value for such a field is the class-field initializer (`prop: T = ...` in the class body). Details and
why, in the [`fillable`](#fillable) section below.

```ts
class Locked extends ActiveModel {
  @ActiveField({ fillable: false, value: 'FROM_ATTRIBUTE' })
  id?: string
}

Locked.create({}).id // undefined - the attribute default never applies to a fillable:false field
```

---

## `fillable`

Allows/disallows setting the field's value via `create()`, `fill()`, and direct assignment.

- `fillable: true` (default) - the field can be changed any way.
- `fillable: false` - the field **never** accepts a value from data or assignment. The only way to give
  it a value is a class-field initializer (`prop: T = someValue` in the class body).

```ts
class Invoice extends ActiveModel {
  @ActiveField({ fillable: false })
  number: string = 'INV-0001' // the only source of the value
}

const invoice = Invoice.create({ number: 'HACKED' })
invoice.number // 'INV-0001' - the passed value was ignored

invoice.number = 'HACKED-2' // throws
```

**How this works internally** (useful for building intuition about `attribute`/`value` and the
interaction with `readonly`): keys for `fillable: false` fields are stripped out of the incoming data
before `fill()` is ever called - the data never physically reaches the write, neither for `create()` nor
for `new Model(data)`. The field's value is entirely whatever the class-field initializer set.

**Direct assignment throws** (unlike `create()`/`fill()`, which silently ignore the attempt) - that's how
strict-mode `Proxy` invariants work for an explicit `model.prop = x` assignment.

---

## `readonly`

The field can be set **exactly once** - via `Model.create(data)`, via `new Model(data)`, or from the
class-field initializer's value, whichever happens first. After that, any further attempt to change it -
through `fill()` (even with `force: true`) or direct assignment - is **silently ignored**, no exception.

```ts
class Order extends ActiveModel {
  @ActiveField({ readonly: true })
  id: string = ''
}

const a = Order.create({ id: 'A1' })
a.id // 'A1' - taken from data

a.id = 'A2'
a.id // still 'A1' - the write was silently ignored

const b = new Order({ id: 'B1' })
b.id // 'B1' - works the same way through the constructor
```

### `readonly: true` vs `fillable: false` - not the same thing

At first glance `fillable: false` looks like it just duplicates `readonly: true` - both end up
"not letting the field change." In practice these are two different guarantees, and `readonly` can't
stand in for `fillable: false` (in the `set` trap, the `fillable` check runs earlier and separately from
the `readonly` check - see ["Call order"](#call-order-when-a-value-is-set)):

| | `readonly: true` | `fillable: false` |
|---|---|---|
| Can a value come from `data` at creation (`create()`/`new Model()`)? | **Yes**, once | **Never** |
| What happens on a repeated write attempt? | Silently ignored - no exception | Via `fill()`/`create()` - silently ignored; **direct assignment throws** |
| The only guaranteed source of a value | `data` (if it arrives first) **or** the class-field initializer | **Only** the class-field initializer - `attribute`/`value` doesn't work either, see [`value`/`attribute`](#value-attribute) |
| What if the field never got a value from either `data` or the initializer? | Stays open for one write later, via `.fill()` - see the example in [active-model-advanced_EN.md](active-model-advanced_EN.md#readonly) | Stays `undefined` forever - there's no way left to write it |
| Typical use case | A field configured once at creation (e.g. an ID the caller may supply) that shouldn't change afterwards | A field that must never be determined from the outside at all - e.g. a value the model/server itself is responsible for computing |

If you need **both** guarantees at once - a value that never comes from `data`, and a direct write after
creation that fails loudly - combine `readonly: true` with `fillable: false`:

```ts
class Task extends ActiveModel {
  @ActiveField({ readonly: true, fillable: false })
  id: string = crypto.randomUUID() // the only source of the value
}

Task.create({ id: 'spoofed' } as any).id // the generated UUID - data is ignored
new Task({ id: 'spoofed' } as any).id     // same via the constructor

const task = Task.create({})
task.id = 'HACKED' // throws
```

For a full breakdown of why `readonly` silently ignores the write instead of throwing, and the complete
mechanics, see [active-model-advanced_EN.md, the `readonly` section](active-model-advanced_EN.md#readonly).

---

## `protected`

Prevents the field from being deleted (`delete model.prop`). It **does not** affect whether the value can
be changed - that's `fillable`/`readonly`'s job. It **does not** affect serialization either - the field
still shows up in `JSON.stringify()`/`Object.keys()`.

Enabled **by default** for any `@ActiveField()` without an explicit `protected: false`.

```ts
class User extends ActiveModel {
  @ActiveField() name: string = ''            // protected: true by default
  @ActiveField({ protected: false }) tag: string = ''
}

const user = User.create({ name: 'Alice', tag: 'x' })
delete (user as any).name // throws: Property "name" is protected!
delete (user as any).tag  // fine, field removed
```

---

## `hidden`

Excludes the field from enumeration: `Object.keys()`, `for...in`, `{...spread}`, and `JSON.stringify()`.
The field stays directly accessible (`model.field`) - `hidden` only hides it from enumeration/serialization,
not from access.

```ts
class User extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField({ hidden: true }) passwordHash: string = ''
}

const user = User.create({ id: '1', passwordHash: 'a1b2c3' })
Object.keys(user)              // ['id'] - passwordHash is absent
JSON.stringify(user)           // {"id":"1"}
user.passwordHash              // 'a1b2c3' - direct access works normally
```

A good fit for internal/secret fields the model needs to hold but should never accidentally serialize
outward.

---

## `validator`

A function `(model, prop, value) => boolean | void`, called before the new value is set.

**Important: `validator` is not a predicate.** Its return value (`true`/`false`) has no effect on the
outcome - it's simply discarded. The only way to reject a value is to **throw** inside the validator.

```ts
class Product extends ActiveModel {
  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'number' || value < 0) {
        throw new TypeError(`"${prop}" must be a non-negative number`)
      }
    }
  })
  price: number = 0
}

const product = Product.create({ price: 100 })
product.price = -50 // throws TypeError, price stays 100
```

**The validator only runs when the value actually changes** (compared with `Object.is` against the
current value) - it is **not called**:
- if the field is simply absent from the object passed to `create()`/`fill()`;
- if you explicitly pass a value equal to the field's current value (e.g. its default).

```ts
Product.create({})               // validator NOT called - price stays the default 0, even if 0 is invalid
Product.create({ price: 0 })     // also NOT called - equals the current value
Product.create({ price: -1 })    // called - the value genuinely differs from 0
```

So a validator can't guarantee "this field is required" - only "if this field changes, the new value must
be valid." For required-ness, check the key is present in the input before calling `create()` (example:
[node-example_EN.md](node-example_EN.md)).

---

## `setter`

A function `(model, prop, value, receiver) => boolean`, intercepts the write itself - called **instead of**
the normal assignment (and must perform `Reflect.set(...)` itself, or the value won't be applied).

```ts
class Money extends ActiveModel {
  @ActiveField({
    setter (model, prop, value: number, receiver) {
      return Reflect.set(model, prop, Math.round(value * 100), receiver)
    }
  })
  cents: number = 0
}

Money.create({ cents: 19.999 }).cents // 2000
```

Fires under the same conditions as `validator` - **only when the value actually changes** (the same
`Object.is` check, the same "not called for absent/equal values" logic).

`setter` and `factory` (below) are mutually exclusive ways of handling a value: if `factory` is given, an
explicit `setter` from the decorator options is **not used** (the auto-generated factory setter is used
instead).

---

## `getter`

A function `(model, prop, receiver) => any`, intercepts reads - transforms what reading code sees, without
touching what's actually stored in the field.

```ts
class User extends ActiveModel {
  @ActiveField() firstName: string = ''
  @ActiveField() lastName: string = ''
  @ActiveField({
    getter: (model) => `${model.firstName} ${model.lastName}`.trim()
  })
  fullName?: string = undefined // see the warning below
}

const user = User.create({ firstName: 'Ada', lastName: 'Lovelace' })
user.fullName // 'Ada Lovelace'
```

**Important: a getter-only field needs an initializer.** If you declare the field with no `=`
(`fullName?: string`, no default at all), it never gets a real own-property on the instance - and
`Object.keys()`/`JSON.stringify()`, besides consulting the `ownKeys` trap's key list, also check each
key's property descriptor via `getOwnPropertyDescriptor`, which is empty for a property that was never
actually assigned. The result: the getter still works for direct access (`user.fullName`), but it
**disappears** from `Object.keys()`/`JSON.stringify()`. Add an explicit initializer (`= undefined` counts)
so the field is visible in enumeration too.

---

## `factory`

Wraps an incoming value in an instance of another `ActiveModel` class - handy for nested models. Two forms:

**A single model**: `factory: Model`. The value is wrapped via `Model.createLazy(value)`, and if the value
is an array, each item is wrapped via `Model.createFromCollectionLazy(value)` instead (the form adapts
automatically to whatever actually arrived).

```ts
class Address extends ActiveModel {
  @ActiveField() city: string = ''
}
class User extends ActiveModel {
  @ActiveField({ factory: Address }) address?: Address
}

User.create({ address: { city: 'Berlin' } }).address // Address { city: 'Berlin' }
```

**A model plus a default-value factory**: `factory: [Model, () => defaultValue]` - same wrapping logic,
plus `() => defaultValue` is used as a lazy default (called fresh for each instance - doesn't share a
reference across instances, same as `value`/`attribute`).

```ts
class Item extends ActiveModel {
  @ActiveField() label: string = ''
}
class Order extends ActiveModel {
  @ActiveField({ factory: [Item, () => []] }) items: Item[] = []
}

Order.create({ items: [{ label: 'a' }, { label: 'b' }] }).items // [Item{label:'a'}, Item{label:'b'}]
Order.create({}).items // [] - a fresh array per instance
```

`factory` is implemented via an auto-generated `setter` - a `setter` given in the decorator options is
**ignored** when `factory` is also given.

---

## `on` / `once`

Subscribes to field lifecycle events: `beforeSetValue`, `afterSetValue`, `beforeDeletingAttribute`,
`nulling`. `once` is the same, except the listener is removed after firing once.

Registered **once, when the class is defined**, and shared across **all** instances of that class - fires
only for the property the decorator was applied to.

```ts
class Order extends ActiveModel {
  @ActiveField({
    on: {
      afterSetValue ({ prop, value }) {
        console.log(`${prop} changed to ${value}`)
      }
    }
  })
  status: string = 'new'
}
```

A full breakdown of all four events (including `nulling`'s exact semantics - it only fires on a transition
from non-null to `null`, not to `undefined`), the order relative to `validator`/`setter`, and the
difference from instance-level `model.emitter.on(...)` subscriptions, is in
[active-model-advanced_EN.md, the "`on` / `once` hooks" section](active-model-advanced_EN.md#on-once-hooks).

---

## Call order when a value is set

When you do `model.prop = value` (or it happens via `create()`/`fill()`), ActiveField properties go
through this sequence:

1. `Object.is(old, new)` comparison - if equal, none of the below runs at all (the write goes straight
   through).
2. `fillable` check - if `false`, the write is blocked here (see [`fillable`](#fillable)).
3. `readonly` check - if the field has already been written once, the write is blocked here (see
   [`readonly`](#readonly)).
4. `validator(model, prop, value)` - may throw and stop everything that follows.
5. `beforeSetValue` event.
6. `setter(model, prop, value, receiver)` - or, if there isn't one, a plain `Reflect.set`.
7. `afterSetValue` event.
8. `nulling` event - only if the old value wasn't `null` and the new one is.

`getter` doesn't participate in this sequence - it separately intercepts **reads**, not writes.
`hidden`/`protected` don't affect writes either - they govern enumeration and deletion respectively.
