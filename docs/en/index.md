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
  - title: "ActiveModel"
    details: A Proxy-based model with runtime data integrity control (fillable, hidden, protected, readonly) and type checks — for DTOs from external sources.
  - title: "@ActiveField() decorators"
    details: setter, getter, validator, factory, on/once hooks — declaratively describe each field's behavior. A complete options reference with examples.
  - title: "CallableModel"
    details: A base class whose instances can be called like a function — handy for Nuxt.js/Vue.js plugins.
---

## What problems does this library solve

### Reactive data models with controllable properties

How do you build a data model where every property can be intercepted on read, write, and delete —
without hand-writing getters/setters for each field? `ActiveModel` wraps the instance in a
[`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) and
intercepts `get`/`set`/`deleteProperty`/`has`/`ownKeys`. On top of that, the `@ActiveField()` decorator
declaratively describes each field's behavior — no wrapper classes or manual `Object.defineProperty` calls
needed:

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

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
instance-level events available through `model.emitter`:

```ts
import { EventType } from '@alt-point/active-models'

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
    model.emitter.on(EventType.created, () => console.log('invoice fully built'))
    model.emitter.on(EventType.touched, () => console.log('invoice changed'))
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

Русская версия: [/](/)
