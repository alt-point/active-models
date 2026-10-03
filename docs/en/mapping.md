# Model mapping: `mapTo()` and `hasMapping()`

## The problem

A model fetched from an API rarely goes out to a third service as-is: a monetary amount arrives in dollars
but the payment provider wants cents; a full name needs splitting into `firstName`/`lastName` for a CRM;
an internal `Order` shouldn't leak fields that aren't part of a GraphQL mutation's contract. Different
consumers often need different projections of the same model at the same time — a REST payload, a UI
view-model, an analytics event.

The usual fix is mapper functions scattered across call sites (`toApiPayload(order)`,
`toAnalyticsEvent(order)`), disconnected from the `Order` class itself and easy to forget exist. `mapTo()`/
`hasMapping()` attach the transformation rule to the model class itself — register it once, call it on any
instance afterward.

## Basic usage

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'

class Order extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField() total: number = 0
}

// The target doesn't have to be an ActiveModel — any class or POJO works
class OrderPayload {
  constructor (public orderId: string, public amountCents: number) {}
}

// Registered once — e.g. at module init time
Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))

const order = Order.create({ id: '42', total: 19.99 })

order.hasMapping(OrderPayload) // true
const payload = order.mapTo(OrderPayload)
// payload instanceof OrderPayload → { orderId: '42', amountCents: 1999 }
```

`Order.mapTo(target, handler)` is static — it registers a handler once for the whole class.
`order.mapTo(target)` is an instance method — it applies the already-registered handler to one specific
instance. `hasMapping(target)` is available both statically (`Order.hasMapping(...)`) and on the instance
(`order.hasMapping(...)`) — both look at the same registry.

## The mapping key is a reference, not a string

`target` is looked up in a `WeakMap` by reference identity, not by name: it can be a class, a `Symbol`, a
string constant — anything, as long as it's the same reference at registration time and at call time. That
means **you can register any number of independent projections on the same model**, each under its own key:

```ts
const ANALYTICS_EVENT = Symbol('order.analytics')

Order.mapTo(ANALYTICS_EVENT, (order) => ({
  event: 'order_viewed',
  order_id: order.id,
  value_cents: Math.round(order.total * 100),
}))

Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))

// Same order, two independent projections
order.mapTo(ANALYTICS_EVENT) // { event: 'order_viewed', order_id: '42', value_cents: 1999 }
order.mapTo(OrderPayload)    // OrderPayload { orderId: '42', amountCents: 1999 }
```

Don't use a freshly-created object literal (`order.mapTo({})`) as a key — it won't equal itself on the
next call, so `hasMapping` will always return `false`. The key needs to be a stable, reused reference: a
class, or a module-level `Symbol`/string constant.

## `lazy` and the fallback

By default (`lazy = true`), a missing mapping isn't treated as an error — the method silently returns
`order.clone()`. That's a deliberate trade-off: code that optionally tries to map a model (e.g. a generic
logger that logs "as-is" when no special format is registered for the type) shouldn't have to wrap every
call in `try/catch`.

```ts
class Unmapped {}
order.mapTo(Unmapped)        // no mapping registered → silently returns order.clone()
order.mapTo(Unmapped, false) // no mapping registered → throws: "Mapping for target not found"
```

Pass `lazy: false` when a missing mapping is a bug that should fail loudly — e.g. when exporting to a
required external contract.

## Extra arguments

`mapTo(target, lazy, ...args)` forwards everything after `lazy` straight to the handler — handy for
parameterizing the transformation without closing over extra state inside the handler itself:

```ts
Order.mapTo(OrderPayload, (order, locale: string) => new OrderPayload(
  order.id,
  Math.round(order.total * 100),
))

order.mapTo(OrderPayload, true, 'en-US')
```

## Using it in Vue

The natural place to map is the boundary between the model and the API/analytics layer — e.g. inside a
composable or a Pinia action:

```ts
// useOrderApi.ts
import { Order, OrderPayload } from './models'

export function useOrderApi () {
  async function submitOrder (order: Order) {
    // system boundary: only the explicitly-mapped projection leaves,
    // not the raw ActiveModel with its internal fields
    return fetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify(order.mapTo(OrderPayload, false)),
    })
  }

  return { submitOrder }
}
```

```vue
<script setup lang="ts">
import { Order } from './models'
import { useOrderApi } from './useOrderApi'

const props = defineProps<{ order: Order }>()
const { submitOrder } = useOrderApi()
</script>

<template>
  <button @click="submitOrder(props.order)">Place order</button>
</template>
```

`lazy: false` here is deliberate: if the `OrderPayload` mapping is missing, failing loudly during
development beats silently POSTing a serialized `Order` in full to the backend.

## Using it in React

Same principle — mapping happens at the boundary where the model leaves the application (an API request,
an analytics event), not spread across components:

```tsx
// orderApi.ts
import { Order, OrderPayload } from './models'

export async function submitOrder (order: Order) {
  return fetch('/api/orders', {
    method: 'POST',
    body: JSON.stringify(order.mapTo(OrderPayload, false)),
  })
}
```

```tsx
import { useState } from 'react'

function OrderView ({ order }: { order: Order }) {
  const [pending, setPending] = useState(false)

  async function onSubmit () {
    setPending(true)
    try {
      await submitOrder(order)
    } finally {
      setPending(false)
    }
  }

  return <button disabled={pending} onClick={onSubmit}>Place order</button>
}
```

If your app needs several output shapes of the same model (a REST payload, a GraphQL input, an analytics
event), register each under its own `Symbol` key next to the `Order` class definition — every available
projection is then visible in one place, instead of scattered across the components that use them.

## Comparison with other approaches

| Approach | Where the rule is registered | Multiple target shapes on one model | Dependencies |
|---|---|---|---|
| **`ActiveModel.mapTo()`** | statically, on the model class | yes, keyed by any stable reference | none — part of the library |
| `class-transformer` (`plainToInstance`/`instanceToPlain`, `@Expose`/`@Exclude`) | decorators on class fields | limited — via `@Expose({ groups })` | `reflect-metadata`, needs `experimentalDecorators` and type metadata |
| AutoMapper (`automapper-nartc` and similar) | separate "profiles" outside the model class | yes, explicitly configured | a separate library, a separate configuration layer |
| Zod `.transform()` | inline in the validation schema chain | one transform per schema | requires modeling data as a Zod schema, not a class |
| Hand-written mapper functions | anywhere in the codebase | yes, but with no central registry | none, but also no programmatic way to ask "is there a mapping" |

The key difference in `mapTo()` isn't transformation power — the handler is a plain function, no automatic
field-by-field matching by name — it's *where the knowledge of available projections lives*: next to the
model class, discoverable via `hasMapping()`, with no reflection and no separate configuration layer. The
trade-off for that simplicity is that mapping is always explicit: field-by-field mapping of nested objects
or lists is something you write inside the handler yourself, not a declarative schema.
