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

- [x] Implementing data structures with reactive attributes ([`ActiveModel`](#activemodel));
- [x] Managing the integrity of data structures (`ActiveModel.fillable`, `ActiveModel.hidden`, `ActiveModel.protected`);
- [x] Keeping track of runtime-types and data integrity of each class attribute;

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

## `Enum`

> **Deprecated (`@deprecated`).** The `Enum` class is marked deprecated right in the source
> (`src/Enum.ts`), though it's still exported from the package. For new models, prefer a native
> TypeScript `enum` together with a `validator` on the field instead — that's the pattern used in the
> [decorators example](docs/en/active-model-with-decorators.md).

An implementation of `enum` using `Map`

```js
const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

OrderStatuses.values() // ['new', 'complete', 'shipping']
OrderStatuses.validate('foo') // will throw: Value must be one of: new, complete, shipping; Provided value: "foo"
OrderStatuses.default // 'new'

```

## TODO:
- [ ] More usage examples;
- [x] Tests;
- [x] TS;
- [x] Add `node.js` usage examples;
- [x] Translate to english and others languages;

### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
