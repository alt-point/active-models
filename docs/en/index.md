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
