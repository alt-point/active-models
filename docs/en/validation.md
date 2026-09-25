# Validation, normalization and state rules

Everything a value goes through when it is written to a field, in this order:

```
transform (trim / lowercase / uppercase / your own) → coerce → same value? stop → transitions → rules → validator → events
```

A refused write throws a `ValidationError`; `validate()` runs the same rules over the **current** state and reports
**all** problems instead of stopping at the first.

## Normalizers

```ts
class User extends ActiveModel {
  @ActiveField({ trim: true, lowercase: true }) email: string = ''
  @ActiveField({ uppercase: true }) country: string = ''
  @ActiveField({ transform: [(v) => String(v).replace(/\s+/g, ' '), (v) => v.slice(0, 50)] }) bio: string = ''
}

user.email = '  Ann@Example.COM '   // stored as "ann@example.com"
```

`transform` takes a function (or an array) `(value, { model, prop }) => newValue`; the built-in shorthands run first.
Non-strings pass through `trim`/`lowercase`/`uppercase` untouched. Events and `touched` see the **normalized** value, and
a write that normalizes to the current value is a no-op (nothing is emitted).

## Type coercion

```ts
@ActiveField({ coerce: 'number' })  price: number = 0      // '12.5' → 12.5
@ActiveField({ coerce: 'integer' }) qty: number = 0        // '4' → 4, '2.5' is refused
@ActiveField({ coerce: 'boolean' }) active: boolean = false // 'true' / '1' / 1 → true, 'false' / '0' / 0 → false
@ActiveField({ coerce: 'date' })    when?: Date            // ISO string or timestamp → Date
@ActiveField({ coerce: 'string' })  label?: string         // 42 → '42', Date → ISO string
```

`null`/`undefined` pass through. A value that can't be converted is refused with code `coerce`.

## Declarative rules

| Option | Checks |
|---|---|
| `required` | not `null`, `undefined` or `''` |
| `type` | `'string' \| 'number' \| 'integer' \| 'boolean' \| 'date' \| 'array' \| 'object'` (`coerce` implies one) |
| `min`, `max` | a number or a `Date` |
| `minLength`, `maxLength` | characters of a string / items of an array |
| `pattern` | a string matches the `RegExp` (a `/g` flag is harmless) |
| `oneOf` | one of an array, or a value of a TypeScript `enum` (string or numeric) |

An optional field that is `null`/`undefined` isn't checked; `required` is the only rule that fails on absence.

```ts
class Person extends ActiveModel {
  @ActiveField({ required: true, minLength: 2 }) name?: string
  @ActiveField({ min: 0, max: 150 }) age?: number
  @ActiveField({ oneOf: Role }) role?: Role
}
```

## `validate()` and `assertValid()`

The write-time checks can't see a field that was **never set** (there is no write). `validate()` can:

```ts
const { valid, issues } = order.validate()
// issues: [
//   { path: 'id', code: 'required', message: '"id" is required' },
//   { path: 'address.city', code: 'required', ... },
//   { path: 'history[1].city', code: 'required', ... },
// ]

order.assertValid()                                   // throws ValidationError, its .issues lists all of them
Order.create(data, { validate: true })                // throws instead of returning an invalid model; `created` is not emitted
```

It recurses into nested models, collections and arrays of models (with paths like `history[1].city`), survives reference
cycles, and runs `validator`s only for values that are set (as they do on write). Codes: `required`, `type`, `coerce`,
`min`, `max`, `minLength`, `maxLength`, `pattern`, `oneOf`, `transition`, `validator`.

## State transitions

```ts
class Order extends ActiveModel {
  @ActiveField({ transitions: { new: ['paid', 'cancelled'], paid: ['shipped'], shipped: [] } })
  status?: 'new' | 'paid' | 'shipped' | 'cancelled'
}

const order = Order.create({ status: 'new' })
order.status = 'paid'        // ok
order.status = 'new'         // ValidationError: "status" cannot change from "paid" to "new"

order.canTransition('status', 'shipped')   // true
order.allowedTransitions('status')         // ['shipped']
```

A state with no entry is terminal. The **first** value (from `undefined`/`null`) and creation from stored data are
unrestricted, so an order loaded as `shipped` is fine; only changes made afterwards are checked. Writing the same
state is a no-op.

## Strict models

```ts
class Strict extends ActiveModel {
  static strict = true
  @ActiveField() name: string = ''
}

strict.name = 'x'   // ok
strict.nmae = 'x'   // TypeError: Unknown property "nmae" on Strict: declare it with @ActiveField() (strict model)
```

Symbols and properties that already exist on the object (undecorated class fields, methods) are allowed. Build strict
models with `create()`: `new Model(data)` runs undeclared class-field initializers through the same check.

## `ValidationError`

```ts
try { user.age = -1 } catch (e) {
  if (e instanceof ValidationError) e.issues   // [{ path: 'age', code: 'min', message: '"age" must be at least 0', value: -1 }]
}
```

## Good to know

- **A rejected first write doesn't lock a `readonly` field** — the "written once" mark is set only after every check passed.
- `validator` is still there for anything the declarative rules can't express; use rules first, they also feed `validate()`.
- Rules and normalizers are **bypassed** when values are put back (rollback, undo, revert): those values were valid when taken.
