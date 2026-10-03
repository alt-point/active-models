---
layout: home

hero:
  name: "@alt-point/active-models"
  text: Reactive DTO models with Proxy
  tagline: TS base classes for working with data structures — reactive fields, integrity control, declarative validation.
  actions:
    - theme: brand
      text: Decorators example
      link: /en/active-model-with-decorators
    - theme: alt
      text: "@ActiveField() options reference"
      link: /en/active-field-options
    - theme: alt
      text: GitHub
      link: https://github.com/alt-point/active-models

features:
  - icon: 🛡️
    title: Data integrity
    details: readonly, fillable, protected, hidden - fine-grained control per field. External data can't overwrite what's protected or add what shouldn't be there.
  - icon: ✅
    title: Validation on write
    details: validator, setter/getter, defaults and nested factory models - a problem is caught at assignment time, not where it finally blows up.
  - icon: 🔔
    title: Events
    details: Field hooks, model.on() and Model.on() for every instance of a class. touched bubbles up from nested models; a throwing listener doesn't stop the others.
  - icon: 📝
    title: Change tracking
    details: isTouched() and getRaw() - "are there unsaved changes" and the source data. Vue and React examples.
  - icon: 🔀
    title: Mapping
    details: mapTo() - several projections of one model (DTO, view-model, payload) in one place, no reflection.
  - icon: 🧪
    title: Battle-tested
    details: 516 tests, 99% coverage, 94% mutation score, performance budgets and memory-leak checks.
---

::: tip What's new in 4.0
`model.emitter` and `startTracking()` are removed - subscribe through `model.on()` / `Model.on()`, track via
`create(data, { tracked: true })`. Added `getRaw()`, inherited subscriptions, `touched` bubbling, per-instance
default copies, and a fixed `clone()`. Details: [migrating to 4.0](/en/migration) and the
[CHANGELOG](https://github.com/alt-point/active-models/blob/master/CHANGELOG.md).
:::

## What problems does this library solve

### Reactive data models with controllable properties

How do you build a data model where every property can be intercepted on read, write, and delete —
without hand-writing getters/setters for each field? `ActiveModel` wraps the instance in a
[`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) and
intercepts `get`/`set`/`deleteProperty`/`has`/`ownKeys`. On top of that, the `@ActiveField()` decorator
declaratively describes each field's behavior — no wrapper classes or manual `Object.defineProperty` calls
needed:

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'

class Product extends ActiveModel {
  @ActiveField() name: string = ''

  // setter normalizes the input, getter computes a display value on the fly
  @ActiveField({
    setter: (model, prop, value) => Math.round(Number(value) * 100) / 100,
    getter: (model, prop, target) => `$${target[prop].toFixed(2)}`
  })
  price: number = 0
}

const product = Product.create({ name: 'Mouse', price: 19.999 })
product.price // '$20.00' — 19.999 went in, the getter hands back a display-ready string
```

More: [Decorators example](/en/active-model-with-decorators), [`@ActiveField()` options reference](/en/active-field-options).

### Data structure integrity

How do you keep external data (an API response, for example) from silently overwriting a protected field,
deleting a required attribute, or adding stray keys that shouldn't be there? The `fillable`, `readonly`,
`protected`, and `hidden` options give fine-grained, per-field control:

```ts
class User extends ActiveModel {
  // set once at creation (factory or constructor), read-only from then on
  @ActiveField({ readonly: true, attribute: () => crypto.randomUUID() })
  id!: string

  // delete user.role throws
  @ActiveField({ protected: true })
  role: string = 'guest'

  // excluded from Object.keys()/JSON.stringify(), still directly accessible
  @ActiveField({ hidden: true })
  internalNotes: string = ''
}

const user = User.create({ id: 'ignored-from-outside', role: 'admin' })
user.id       // the generated uuid, not 'ignored-from-outside'
user.id = 'x' // throws - the field was already set
delete user.role // throws - the field is protected from deletion
JSON.stringify(user) // internalNotes is absent from the result
```

More: [`@ActiveField()` options reference](/en/active-field-options#readonly), including a comparison
table between `readonly` and `fillable: false`.

### Runtime type and data integrity checks

TypeScript only checks types at compile time — data coming from external sources (an API, localStorage, a
WebSocket) arrives at runtime with no such guarantee. `validator` runs on every attempted write and throws
if the value doesn't match the expected shape; `factory` automatically wraps nested structures in their
own `ActiveModel`, keeping validation intact at any depth:

```ts
enum OrderStatus { New = 'new', Paid = 'paid', Shipped = 'shipped' }

class Address extends ActiveModel {
  @ActiveField() city: string = ''
}

class Order extends ActiveModel {
  @ActiveField({
    validator: (model, prop, value) => {
      if (!Object.values(OrderStatus).includes(value)) {
        throw new Error(`Invalid status: ${value}`)
      }
    }
  })
  status: OrderStatus = OrderStatus.New

  // the nested object automatically becomes an Address instance with its own validation
  @ActiveField({ factory: Address })
  shippingAddress?: Address
}

const order = Order.create({ status: 'paid', shippingAddress: { city: 'Berlin' } })
order.shippingAddress instanceof Address // true
order.status = 'not-a-real-status' // throws Error: Invalid status: not-a-real-status
```

More: [Advanced features](/en/active-model-advanced) — validators and `factory`.

### Subscribing to changes in model properties

How do you find out that a specific field changed, was nulled out, or was deleted — without wrapping every
assignment in your own code? The `beforeSetValue`, `afterSetValue`, `nulling`, and `beforeDeletingAttribute`
events are subscribed to right in the decorator via `on`/`once`, while `touched`/`created` are
instance-level events available through `model.on`/`model.once` — or class-level, for every instance at
once, through `Model.on`/`Model.once`:

```ts
import { EventType } from '@alt-point/active-models/types'

class Invoice extends ActiveModel {
  @ActiveField({
    on: {
      afterSetValue: ({ prop, value, oldValue }) => {
        console.log(`${prop}: ${oldValue} → ${value}`)
      },
      nulling: ({ prop }) => console.log(`${prop} was explicitly cleared`)
    }
  })
  total: number | null = 0

  static beforeFill (model: any) {
    model.on(EventType.created, () => console.log('invoice fully built'))
    model.on(EventType.touched, () => console.log('invoice changed'))
  }
}

const invoice = Invoice.create({ total: 100 })
// invoice fully built
invoice.total = 250
// total: 100 → 250
// invoice changed
invoice.total = null
// total: 250 → null
// invoice changed
// total was explicitly cleared
```

More: [Model lifecycle](/en/model-lifecycle) — every event from creation to deletion, with a diagram.

## Installation

::: code-group

```bash [yarn]
yarn add @alt-point/active-models
```

```bash [npm]
npm install --save @alt-point/active-models
```

```bash [bun]
bun add @alt-point/active-models
```

:::

## Documentation

- [Decorators example](/en/active-model-with-decorators) — a basic workflow using an order model
- [`@ActiveField()` options reference](/en/active-field-options) — every option on its own, with examples
- [Model lifecycle](/en/model-lifecycle) — every event from creation to deletion, with a diagram
- [Advanced features](/en/active-model-advanced) — validators, hooks, `new`/`create`/`fill`, serialization, `mapTo()`
- [Node.js server example](/en/node-example) — no Vue/Nuxt, plain `node:http`
- [Change tracking: isTouched()](/en/dirty-tracking) — dirty tracking with Vue and React examples, compared to react-hook-form/Formik/MobX
- [Model mapping: mapTo()](/en/mapping) — mapping to DTOs/view-models with Vue and React examples, compared to class-transformer/AutoMapper
- [Invariants, transactions, undo](/en/integrity) — `transaction()` with rollback, `changes()`/`revert()`, `undo()`/`redo()`
- [Validation and normalization](/en/validation) — `required`, `min`/`max`, `pattern`, `oneOf`, `coerce`, `trim`, `validate()`, state transitions, strict mode
- [Scalars: Decimal, Money, LocalDate](/en/scalars) — exact money, decimals and timezone-free dates
- [Comparison with native code](/en/comparison) — eight tasks: the ActiveModel solution and the same by hand
- [ActiveCollection](/en/collections) — an array that holds nothing but the declared model; sorting and binary search
- [Imports and tree-shaking](/en/imports) — a subpath per capability, no root import, bundle sizes
- [Known limitations](/en/limitations), [Migrating to 4.0](/en/migration), [Migrating to 5.0](/en/migration-5), [For AI agents](/en/agents), [API reference](/en/api/)

Русская версия: [/](/)
