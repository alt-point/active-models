<div align="center">

# @alt-point/active-models

**Reactive, self-validating DTO models built on `Proxy` and TypeScript decorators**

Describe a structure once — get validation on write, integrity control, events, change tracking and mapping
into other shapes.

[![npm version](https://img.shields.io/npm/v/@alt-point/active-models?logo=npm&color=cb3837)](https://www.npmjs.com/package/@alt-point/active-models)
[![npm downloads](https://img.shields.io/npm/dm/@alt-point/active-models?logo=npm&color=cb3837)](https://www.npmjs.com/package/@alt-point/active-models)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@alt-point/active-models?label=minzipped)](https://bundlephobia.com/package/@alt-point/active-models)
[![types](https://img.shields.io/npm/types/@alt-point/active-models?logo=typescript&logoColor=white&color=3178c6)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/@alt-point/active-models?color=blue)](LICENSE.txt)

[![CI](https://img.shields.io/github/actions/workflow/status/alt-point/active-models/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=white)](https://github.com/alt-point/active-models/actions/workflows/ci.yml)
[![docs](https://img.shields.io/github/actions/workflow/status/alt-point/active-models/deploy-docs.yml?branch=master&label=docs&logo=vitepress&logoColor=white)](https://alt-point.github.io/active-models/en/)
[![tests](https://img.shields.io/badge/tests-449%20passing-brightgreen)](docs/en/testing.md)
[![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](docs/en/testing.md)
[![mutation score](https://img.shields.io/badge/mutation%20score-94%25-brightgreen?logo=stryker&logoColor=white)](docs/en/testing.md#mutation-testing)
[![semver](https://img.shields.io/badge/semver-2.0.0-blue)](CHANGELOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)](AGENTS.md)

**[📖 Documentation](https://alt-point.github.io/active-models/en/)** ·
**[🚀 Quick start](#quick-start)** ·
**[🧩 Options reference](docs/en/active-field-options.md)** ·
**[🔄 Migrating to 4.0](docs/en/migration.md)** ·
**[🇷🇺 Русский](README.md)**

</div>

---

## Why

Data from APIs, forms, `localStorage` and WebSockets arrives at runtime — and no TypeScript type guarantees
it. `ActiveModel` catches problems at assignment time, not where they finally blow up:

|  | Problem | Solution |
|---|---|---|
| 🛡️ | External data overwrites protected fields | `readonly`, `fillable`, `protected`, `hidden` |
| ✅ | Invalid values end up in the model | `validator`, `setter`/`getter`, nested `factory` |
| 🔔 | You need to know what changed, and when | events `beforeSetValue`, `afterSetValue`, `nulling`, `touched`, `created` |
| 📝 | "Are there unsaved changes?" | `isTouched()`, `getRaw()` |
| 🔀 | One model, many representations | `mapTo()` into a DTO / view-model / payload |
| 🧬 | Safe copies and snapshots | `clone()`, `makeFreeze()`, `toJSON()` |

## Quick start

```bash
bun add @alt-point/active-models      # or: npm i / yarn add / pnpm add
```

> Requires `"experimentalDecorators": true` in `tsconfig.json` (legacy TypeScript decorators).
> There is no root import: every capability is its own subpath (`/ActiveModel`, `/decorators`, `/scalars/Money`, ...) and
> only what you import is bundled. The list: [Imports and tree-shaking](docs/en/imports.md).
> Native TC39 decorators support is planned.

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'

class Address extends ActiveModel {
  @ActiveField() city: string = ''
}

class User extends ActiveModel {
  @ActiveField({ readonly: true })                       id: string = ''
  @ActiveField({ validator: (_m, prop, v) => { if (!v) throw new TypeError(`${prop} is required`) } })
  name: string = 'Guest'
  @ActiveField({ hidden: true })                         passwordHash: string = ''
  @ActiveField({ factory: Address })                     address?: Address   // a nested model
}

// Always build models through the factory, not `new User(data)`
const user = User.create({ id: '1', name: 'Ann', address: { city: 'Berlin' } }, { tracked: true })

user.on(EventType.afterSetValue, ({ prop, value }) => console.log(prop, '→', value))

user.name = 'Bob'                 // "name → Bob"
user.name = ''                    // TypeError: name is required
user.id = '2'                     // silently ignored: readonly
user.address!.city = 'Munich'     // bubbles up as the parent's touched

user.isTouched()                  // true — the state differs from the initial one
JSON.stringify(user)              // {"id":"1","name":"Bob","address":{"city":"Munich"}} — no passwordHash
```

Class-level subscriptions apply to **every** instance (and subclasses) at once:

```ts
User.on(EventType.created, ({ target }) => audit('user created', (target as User).id))
```

## Features

<details open>
<summary><b>Integrity and validation</b></summary>

- `@ActiveField({ readonly, fillable, protected, hidden })` — fine-grained control per field;
- `validator`, `setter`, `getter`, defaults (`value`/`attribute`, copied per instance);
- `factory: Model` / `[Model, () => default]` — nested models and lists validated at any depth.
</details>

<details>
<summary><b>Events</b></summary>

- field hooks: `@ActiveField({ on: {...}, once: {...} })`;
- instance: `model.on()` / `model.once()`; class: `Model.on()` / `Model.once()` (inherited by subclasses);
- `touched` bubbles up from nested models; a throwing listener doesn't stop the others;
- typed payloads: `EventPayloads`, `EventListener`.
</details>

<details>
<summary><b>Data and copies</b></summary>

- `create` / `createLazy` / `asyncCreate` / `createFromCollection` (+ `Lazy`/`async` variants);
- `fill()`, `clone()`, `makeFreeze()`, `toJSON()` (`Date`, `Set`, `Map` handled correctly);
- `isTouched()` + `getRaw()` — change tracking and the source data (`create(data, { tracked: true })`).
</details>

<details>
<summary><b>Mapping and utilities</b></summary>

- `Decimal` / `Money` / `LocalDate` + `coerce: Money` — exact money, decimals and timezone-free dates;
- `ActiveCollection` / `ActiveMap` / `ActiveSet` / `@ActiveField({ container })` — an array that holds nothing but the model; sorting and binary search;
- `Model.mapTo(Target, handler)` / `model.mapTo(Target)` — several projections of one model;
- `CallableModel` — objects you can call like functions (no `unsafe-eval`, CSP-safe).
</details>

## CallableModel and Enum

`CallableModel` is a base class whose instances can be called like functions (handy for Nuxt.js/Vue.js
plugins; built without `extends Function`, so it works under a strict CSP):

```ts
import { CallableModel } from '@alt-point/active-models/CallableModel'

class Notify extends CallableModel {
  __call (message: string) { return this.success(message) }
  success (message: string) { alert(message) }
  silent (message: string) { console.log('Silent message:', message) }
}

// plugin: inject('notify', new Notify())  →  this.$notify('Alert!'); this.$notify.silent('...')
```

> `Enum` is marked `@deprecated` — for new models prefer a native TypeScript `enum` together with a
> `validator` on the field (see the [example](docs/en/active-model-with-decorators.md)).

## Documentation

| Section | About |
|---|---|
| [Decorators example](docs/en/active-model-with-decorators.md) | the basic workflow on an order model |
| [`@ActiveField()` reference](docs/en/active-field-options.md) | every option: what it does and what it affects |
| [Model lifecycle](docs/en/model-lifecycle.md) | creation/write/delete diagrams and every event |
| [Advanced features](docs/en/active-model-advanced.md) | validators, hooks, `new` vs `create` vs `fill`, `clone`, `makeFreeze` |
| [Change tracking](docs/en/dirty-tracking.md) | `isTouched()` and `getRaw()` with Vue and React examples |
| [Model mapping](docs/en/mapping.md) | `mapTo()`: compared to class-transformer and AutoMapper |
| [Invariants, transactions, undo](docs/en/integrity.md) | `transaction()` with rollback, `changes()`/`revert()`, `undo()`/`redo()` |
| [Validation and normalization](docs/en/validation.md) | rules, `validate()`, `coerce`, `trim`, state transitions, strict mode |
| [Scalars](docs/en/scalars.md) | `Decimal`, `Money` (with `allocate()`), `LocalDate`, custom value classes |
| [Comparison with native code](docs/en/comparison.md) | eight tasks: the ActiveModel solution and the same by hand, in tabs |
| [Imports and tree-shaking](docs/en/imports.md) | a subpath per capability, no root import, bundle sizes |
| [ActiveCollection / Map / Set](docs/en/collections.md) | containers of the declared model only: sorting, binary search, unique keys |
| [Node.js example](docs/en/node-example.md) | a server on plain `node:http` |
| [Known limitations](docs/en/limitations.md) | what doesn't work as you'd expect — and what to do |
| [Migrating to 4.0](docs/en/migration.md) · [CHANGELOG](CHANGELOG.md) | what changed and how to upgrade |
| [Testing and quality](docs/en/testing.md) | coverage, performance budgets, mutation testing |
| [API reference](https://alt-point.github.io/active-models/en/api/) | generated from TSDoc |

## For AI agents

The package ships [`AGENTS.md`](AGENTS.md) — a compact API cheat sheet and the rules that prevent most
mistakes (e.g. "build models with `create()`, never `new`"). There is also an
[`llms.txt`](https://alt-point.github.io/active-models/llms.txt) index. Point your agent at it from your own
`CLAUDE.md`:

```md
Before working with models, read node_modules/@alt-point/active-models/AGENTS.md.
```

## Quality

**449** unit tests · **99 %** coverage · **94 %** mutation score (Stryker, gate at 90 %) · performance budgets
and memory-leak checks · ESLint · strict [SemVer](CHANGELOG.md#versioning-policy).

```bash
bun run test           # unit
bun run test:coverage  # + coverage thresholds
bun run test:perf      # performance budgets
bun run test:mutation  # mutation testing
```

## Contributing

Issues and PRs are welcome. Before a PR: `bun run lint && bun run typecheck && bun run test`. Rules for
contributors and agents live in [`AGENTS.md`](AGENTS.md#contributing-to-this-repo).

## License

[MIT](LICENSE.txt) © [alt-point](https://alt-point.com/) ·
author — [Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
