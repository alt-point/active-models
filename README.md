<div align="center">

# @alt-point/active-models

**Реактивные, самопроверяющиеся DTO-модели на `Proxy` и декораторах TypeScript**

Опишите структуру один раз — получите валидацию на записи, контроль целостности, события, отслеживание
изменений и маппинг в другие структуры.

[![npm version](https://img.shields.io/npm/v/@alt-point/active-models?logo=npm&color=cb3837)](https://www.npmjs.com/package/@alt-point/active-models)
[![npm downloads](https://img.shields.io/npm/dm/@alt-point/active-models?logo=npm&color=cb3837)](https://www.npmjs.com/package/@alt-point/active-models)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@alt-point/active-models?label=minzipped)](https://bundlephobia.com/package/@alt-point/active-models)
[![types](https://img.shields.io/npm/types/@alt-point/active-models?logo=typescript&logoColor=white&color=3178c6)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/@alt-point/active-models?color=blue)](LICENSE.txt)

[![CI](https://img.shields.io/github/actions/workflow/status/alt-point/active-models/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=white)](https://github.com/alt-point/active-models/actions/workflows/ci.yml)
[![docs](https://img.shields.io/github/actions/workflow/status/alt-point/active-models/deploy-docs.yml?branch=master&label=docs&logo=vitepress&logoColor=white)](https://alt-point.github.io/active-models/)
[![tests](https://img.shields.io/badge/tests-172%20passing-brightgreen)](docs/testing.md)
[![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](docs/testing.md)
[![mutation score](https://img.shields.io/badge/mutation%20score-94%25-brightgreen?logo=stryker&logoColor=white)](docs/testing.md#мутационное-тестирование)
[![semver](https://img.shields.io/badge/semver-2.0.0-blue)](CHANGELOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)](AGENTS.md)

**[📖 Документация](https://alt-point.github.io/active-models/)** ·
**[🚀 Быстрый старт](#быстрый-старт)** ·
**[🧩 Справочник опций](docs/active-field-options.md)** ·
**[🔄 Миграция на 4.0](docs/migration.md)** ·
**[🇬🇧 English](README_EN.md)**

</div>

---

## Зачем это нужно

Данные из API, форм, `localStorage` и WebSocket приходят в рантайме — и никакие типы TypeScript их не
гарантируют. `ActiveModel` ловит ошибки в момент присваивания, а не там, где они «выстрелят»:

|  | Проблема | Решение |
|---|---|---|
| 🛡️ | Внешние данные перезаписывают защищённые поля | `readonly`, `fillable`, `protected`, `hidden` |
| ✅ | Невалидные значения попадают в модель | `validator`, `setter`/`getter`, вложенные `factory` |
| 🔔 | Нужно знать, что и когда изменилось | события `beforeSetValue`, `afterSetValue`, `nulling`, `touched`, `created` |
| 📝 | «Есть ли несохранённые изменения?» | `isTouched()`, `getRaw()` |
| 🔀 | Одна модель — много представлений | `mapTo()` в DTO / view-модель / payload |
| 🧬 | Безопасные копии и снимки | `clone()`, `makeFreeze()`, `toJSON()` |

## Быстрый старт

```bash
bun add @alt-point/active-models      # или: npm i / yarn add / pnpm add
```

> Нужен `"experimentalDecorators": true` в `tsconfig.json` (декораторы TypeScript «legacy»).
> Поддержка нативных TC39-декораторов запланирована.

```ts
import { ActiveModel, ActiveField, EventType } from '@alt-point/active-models'

class Address extends ActiveModel {
  @ActiveField() city: string = ''
}

class User extends ActiveModel {
  @ActiveField({ readonly: true })                       id: string = ''
  @ActiveField({ validator: (_m, prop, v) => { if (!v) throw new TypeError(`${prop} is required`) } })
  name: string = 'Guest'
  @ActiveField({ hidden: true })                         passwordHash: string = ''
  @ActiveField({ factory: Address })                     address?: Address   // вложенная модель
}

// Всегда создавайте модели через фабрику, а не `new User(data)`
const user = User.create({ id: '1', name: 'Ann', address: { city: 'Berlin' } }, { tracked: true })

user.on(EventType.afterSetValue, ({ prop, value }) => console.log(prop, '→', value))

user.name = 'Bob'                 // "name → Bob"
user.name = ''                    // TypeError: name is required
user.id = '2'                     // молча проигнорировано: readonly
user.address!.city = 'Munich'     // всплывает touched родителя

user.isTouched()                  // true — состояние отличается от исходного
JSON.stringify(user)              // {"id":"1","name":"Bob","address":{"city":"Munich"}} — без passwordHash
```

Класс-уровневые подписки применяются сразу ко **всем** инстансам (и подклассам):

```ts
User.on(EventType.created, ({ target }) => audit('user created', (target as User).id))
```

## Возможности

<details open>
<summary><b>Целостность и валидация</b></summary>

- `@ActiveField({ readonly, fillable, protected, hidden })` — точечный контроль над каждым полем;
- `validator`, `setter`, `getter`, значения по умолчанию (`value`/`attribute`, копия на каждый инстанс);
- `factory: Model` / `[Model, () => default]` — вложенные модели и списки с валидацией на любой глубине.
</details>

<details>
<summary><b>События</b></summary>

- хуки поля: `@ActiveField({ on: {...}, once: {...} })`;
- инстанс: `model.on()` / `model.once()`; класс: `Model.on()` / `Model.once()` (наследуются подклассами);
- `touched` всплывает из вложенных моделей; ошибка в слушателе не мешает остальным;
- типизированные payload: `EventPayloads`, `EventListener`.
</details>

<details>
<summary><b>Данные и копии</b></summary>

- `create` / `createLazy` / `asyncCreate` / `createFromCollection` (+ `Lazy`/`async` варианты);
- `fill()`, `clone()`, `makeFreeze()`, `toJSON()` (`Date`, `Set`, `Map` — корректно);
- `isTouched()` + `getRaw()` — отслеживание изменений и исходные данные (`create(data, { tracked: true })`).
</details>

<details>
<summary><b>Маппинг и утилиты</b></summary>

- `ActiveCollection` / `Model.collection()` / `@ActiveField({ collection })` — массив, в который нельзя положить ничего, кроме модели; сортировка и бинарный поиск;
- `Model.mapTo(Target, handler)` / `model.mapTo(Target)` — несколько проекций одной модели;
- `CallableModel` — объекты, которые можно вызывать как функции (без `unsafe-eval`, CSP-безопасно).
</details>

## CallableModel и Enum

`CallableModel` — базовый класс, экземпляры которого можно вызывать как функции (удобно для плагинов
Nuxt.js/Vue.js; реализован без `extends Function`, поэтому работает под строгим CSP):

```ts
import { CallableModel } from '@alt-point/active-models'

class Notify extends CallableModel {
  __call (message: string) { return this.success(message) }
  success (message: string) { alert(message) }
  silent (message: string) { console.log('Silent message:', message) }
}

// plugin: inject('notify', new Notify())  →  this.$notify('Alert!'); this.$notify.silent('...')
```

> `Enum` помечен `@deprecated` — для новых моделей используйте нативный `enum` TypeScript вместе с
> `validator` на поле (см. [пример](docs/active-model-with-decorators.md)).

## Документация

| Раздел | О чём |
|---|---|
| [Пример с decorators](docs/active-model-with-decorators.md) | базовый воркфлоу на модели заказа |
| [Справочник `@ActiveField()`](docs/active-field-options.md) | каждая опция: что делает и на что влияет |
| [Жизненный цикл модели](docs/model-lifecycle.md) | диаграммы создания/записи/удаления и все события |
| [Продвинутые возможности](docs/active-model-advanced.md) | валидаторы, хуки, `new` vs `create` vs `fill`, `clone`, `makeFreeze` |
| [Отслеживание изменений](docs/dirty-tracking.md) | `isTouched()` и `getRaw()` с примерами на Vue и React |
| [Трансформация моделей](docs/mapping.md) | `mapTo()`: сравнение с class-transformer и AutoMapper |
| [Валидация и нормализация](docs/validation.md) | правила, `validate()`, `coerce`, `trim`, переходы состояний, строгий режим |
| [ActiveCollection](docs/collections.md) | массив только из объявленной модели, сортировка, бинарный поиск |
| [Пример для Node.js](docs/node-example.md) | сервер на чистом `node:http` |
| [Известные ограничения](docs/limitations.md) | что работает не так, как ожидаешь — и что делать |
| [Миграция на 4.0](docs/migration.md) · [CHANGELOG](CHANGELOG.md) | что изменилось и как перейти |
| [Тестирование и качество](docs/testing.md) | покрытие, performance-бюджеты, мутационное тестирование |
| [Справочник API](https://alt-point.github.io/active-models/en/api/) | сгенерировано из TSDoc |

## Для AI-агентов

В пакет входит [`AGENTS.md`](AGENTS.md) — компактная шпаргалка по API и правилам, которые предотвращают
большинство ошибок (например, «создавайте модели через `create()`, а не `new`»). Есть и индекс
[`llms.txt`](https://alt-point.github.io/active-models/llms.txt). Подключите из своего `CLAUDE.md`:

```md
Перед работой с моделями прочитай node_modules/@alt-point/active-models/AGENTS.md.
```

## Качество

**172** unit-тест · покрытие **99 %** · **94 %** mutation score (Stryker, порог 90 %) · performance-бюджеты и
проверки утечек памяти · ESLint · строгий [SemVer](CHANGELOG.md#versioning-policy).

```bash
bun run test           # unit
bun run test:coverage  # + покрытие с порогами
bun run test:perf      # бюджеты производительности
bun run test:mutation  # мутационное тестирование
```

## Участие в разработке

Issues и PR приветствуются. Перед PR: `bun run lint && bun run typecheck && bun run test`. Правила для
контрибьюторов и агентов — в [`AGENTS.md`](AGENTS.md#contributing-to-this-repo).

## Лицензия

[MIT](LICENSE.txt) © [alt-point](https://alt-point.com/) ·
автор — [Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
