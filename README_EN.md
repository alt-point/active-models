@alt-point/active-models
===

[![npm version](https://img.shields.io/npm/v/@alt-point/active-models.svg)](https://www.npmjs.com/package/@alt-point/active-models)
[![npm downloads](https://img.shields.io/npm/dm/@alt-point/active-models.svg)](https://www.npmjs.com/package/@alt-point/active-models)
[![CI](https://github.com/alt-point/active-models/actions/workflows/ci.yml/badge.svg)](https://github.com/alt-point/active-models/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@alt-point/active-models.svg)](https://github.com/alt-point/active-models/blob/master/LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)

A set of tools written in `es6/TS` to make working with data-structures easier.

**[📖 Documentation](https://alt-point.github.io/active-models/)**

Problems this package tries to solve:

#### Reactive data models with controllable properties

How do you build a data model where every property can be intercepted on read, write, and delete —
without hand-writing getters/setters for each field? [`ActiveModel`](#activemodel) wraps the instance in a
`Proxy` and exposes the `@ActiveField()` decorator, which lets you define a `setter`/`getter`, a default
value, and subscribe to change events via `on`/`once` — all at the level of a single field.

#### Data structure integrity

How do you keep external data (an API response, for example) from silently overwriting a protected field,
deleting a required attribute, or adding stray keys that shouldn't be there? The `fillable`, `readonly`,
`protected`, and `hidden` options on `@ActiveField()` give fine-grained control: `fillable: false` and
`readonly: true` block changes after creation, `protected` blocks `delete`, and `hidden` excludes a field
from enumeration (`Object.keys`, `JSON.stringify`) while keeping it directly accessible.

#### Runtime type and data integrity checks

TypeScript only checks types at compile time — data coming from external sources (an API, localStorage, a
WebSocket) arrives at runtime with no such guarantee. `validator` on `@ActiveField()` runs on every
attempted write and throws if the value doesn't match the expected type/shape; `factory` additionally
wraps nested structures in their own `ActiveModel` automatically, keeping typing and validation intact at
any depth.

#### Subscribing to changes in model properties

How do you find out that a specific field changed, was nulled out, or was deleted — without wrapping every
assignment in your own code? The `beforeSetValue`, `afterSetValue`, `nulling`, and `beforeDeletingAttribute`
events (via `on`/`once` in the decorator), plus the instance-level `touched`/`created` events
(`model.emitter.on(...)`), give you a single place for side effects: logging, syncing to the UI, cache
invalidation, and so on.

Installation
---

yarn

```bash
yarn add @alt-point/active-models
```

npm

```bash
npm install --save @alt-point/active-models
```

bun

```bash
bun add @alt-point/active-models
```

# `ActiveModel`
Active model uses [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) behind the scenes.

Purpose: Structure integrity and type checks for incoming data from external sources/subsystems ([DTO](https://en.wikipedia.org/wiki/Data_transfer_object))

[Example using decorators](docs/en/active-model-with-decorators.md)

Also:
- [`@ActiveField()` options reference](docs/en/active-field-options.md) — every option on its own: what it does, what it affects, with examples
- [Model lifecycle](docs/en/model-lifecycle.md) — every event from creation to deletion, with a diagram
- [Advanced features](docs/en/active-model-advanced.md) — validators, `on`/`once` hooks, the difference between `new Model()`/`create()`/`fill()`, serialization, `mapTo()`
- [Node.js server example](docs/en/node-example.md) — no Vue/Nuxt, plain `node:http`


Decorators
---
`@ActiveField(opts: ActiveFieldDescriptor)`

```ts
type ActiveFieldDescriptor = object & {
    setter?: Setter<any> // setter
    getter?: Getter<any> // getter
    validator?: Validator<any> // validation on setter
    readonly?: boolean // whether the attribute is read only
    hidden?: boolean // whether the attribute is hidden from listings
    fillable?: boolean // whether the attribute can be set and updated
    protected?: boolean // true if deleting the attribute from the model is prohibited
    attribute?: any // default attribute value during instantiation
    value?: any // alias for `attribute`
}
```

>
> **Notice:**
>
> For default values (`attribute`/`value`) to work, create instances via the
> `ActiveModel.create(data)` factory method. Using the plain constructor
> (`new MyModel(data)`) has a subtlety around subclass field initializers — see
> [`new Model(data)` vs `Model.create(data)` vs `fill(data)`](docs/en/active-model-advanced.md#new-model-data-vs-model-create-data-vs-fill-data)
> for the full explanation and the documented workaround.


***

CallableModel
---
A base class that uses [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
under the hood to be able to operate objects like functions.

Usage example:

```js
import { CallableModel } from '@alt-point/active-models'

class Notify extends CallableModel {
  // Define
  __call (...args) {
      return this.success(...args)
  }

  success (successMessage) {
     alert(successMessage)
  }

  silent (message) {
    console.log('Silent message:' + message)
  }
}
```
You can then create an instance of `Notify` as a `Nuxt.js/Vue.js` plugin and do:

```js
// plugin
export default (ctx, inject) => {
  ctx.$notify = new Notify()
  inject('notify', new Notify())
}


// inside the component you can now do:
this.$notify.silent('Write notice to console!')
this.$notify('Alert!')
```


## TODO:
- [ ] add more examples for more platforms;
- 
### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
