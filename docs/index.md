---
layout: home

hero:
  name: "@alt-point/active-models"
  text: Reactive DTO models with Proxy
  tagline: Базовые классы на TS для упрощения работы со структурами данных — реактивные поля, контроль целостности, декларативная валидация.
  actions:
    - theme: brand
      text: Пример с decorators
      link: /active-model-with-decorators
    - theme: alt
      text: Справочник опций @ActiveField()
      link: /active-field-options
    - theme: alt
      text: GitHub
      link: https://github.com/alt-point/active-models

features:
  - title: "ActiveModel"
    details: Proxy-based модель с контролем целостности данных (fillable, hidden, protected, readonly) и типов в рантайме — для DTO из внешних источников.
  - title: "@ActiveField() decorators"
    details: setter, getter, validator, factory, хуки on/once — декларативное описание поведения каждого поля. Полный справочник опций с примерами.
  - title: "CallableModel"
    details: Базовый класс, с которым инстанс можно вызывать как функцию — удобно для Nuxt.js/Vue.js плагинов.
---

## Какие проблемы решает библиотека

### Реактивные модели данных с контролируемыми свойствами

Как реализовать модель данных, в которой каждое свойство можно перехватывать при чтении, записи и
удалении, — без ручного написания геттеров/сеттеров для каждого поля? `ActiveModel` оборачивает инстанс в
[`Proxy`](https://developer.mozilla.org/ru/docs/Web/JavaScript/Reference/Global_Objects/Proxy) и
перехватывает `get`/`set`/`deleteProperty`/`has`/`ownKeys`. Поверх этого декоратор `@ActiveField()`
декларативно описывает поведение конкретного поля — не нужно писать классы-обёртки или ручные
Object.defineProperty:

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

class Product extends ActiveModel {
  @ActiveField() name: string = ''

  // getter вычисляет значение на лету, setter приводит вход к нужному виду
  @ActiveField({
    setter: (model, prop, value) => Math.round(Number(value) * 100) / 100,
    getter: (model, prop, target) => `$${target[prop].toFixed(2)}`
  })
  price: number = 0
}

const product = Product.create({ name: 'Mouse', price: 19.999 })
product.price // '$20.00' — записали 19.999, а getter отдал уже готовую строку для отображения
```

Подробнее: [Пример с decorators](/active-model-with-decorators), [Справочник опций `@ActiveField()`](/active-field-options).

### Целостность структуры данных

Как защититься от того, что внешние данные (например, ответ API) случайно перезапишут защищённое поле,
удалят обязательный атрибут или добавят в модель лишние ключи, которых там быть не должно? Опции
`fillable`, `readonly`, `protected` и `hidden` дают точечный контроль над каждым полем по отдельности:

```ts
class User extends ActiveModel {
  // задаётся один раз при создании (фабрикой или конструктором), дальше - только чтение
  @ActiveField({ readonly: true, attribute: () => crypto.randomUUID() })
  id!: string

  // нельзя удалить свойство через delete user.role
  @ActiveField({ protected: true })
  role: string = 'guest'

  // не попадёт в Object.keys()/JSON.stringify(), но доступно напрямую
  @ActiveField({ hidden: true })
  internalNotes: string = ''
}

const user = User.create({ id: 'ignored-from-outside', role: 'admin' })
user.id       // сгенерированный uuid, а не 'ignored-from-outside'
user.id = 'x' // выбросит исключение - поле уже установлено
delete user.role // выбросит исключение - поле защищено от удаления
JSON.stringify(user) // internalNotes отсутствует в результате
```

Подробнее: [Справочник опций `@ActiveField()`](/active-field-options#readonly), включая таблицу
сравнения `readonly` и `fillable: false`.

### Контроль типов и целостности данных в рантайме

TypeScript проверяет типы только на этапе компиляции, а данные из внешних источников (API, localStorage,
WebSocket) приходят в рантайме и никакими типами не гарантированы. `validator` выполняется при каждой
попытке установить значение и бросает исключение, если данные не подходят под ожидаемый формат; `factory`
автоматически оборачивает вложенные структуры в собственные `ActiveModel`, сохраняя валидацию на любом
уровне вложенности:

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

  // вложенный объект автоматически станет экземпляром Address со своей валидацией
  @ActiveField({ factory: Address })
  shippingAddress?: Address
}

const order = Order.create({ status: 'paid', shippingAddress: { city: 'Berlin' } })
order.shippingAddress instanceof Address // true
order.status = 'not-a-real-status' // выбросит Error: Invalid status: not-a-real-status
```

Подробнее: [Продвинутые возможности](/active-model-advanced) — валидаторы и `factory`.

### Подписка на изменения данных в свойствах модели

Как узнать, что конкретное поле модели изменилось, было обнулено или удалено, — не оборачивая каждое
присваивание в собственный код? События `beforeSetValue`, `afterSetValue`, `nulling`,
`beforeDeletingAttribute` подписываются прямо в декораторе через `on`/`once`, а `touched`/`created` — на
уровне всего инстанса через `model.emitter`:

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

Подробнее: [Жизненный цикл модели](/model-lifecycle) — все события от создания до удаления, с диаграммой.

## Установка

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

## Документация

- [Пример с decorators](/active-model-with-decorators) — базовый воркфлоу на примере модели заказа
- [Справочник опций `@ActiveField()`](/active-field-options) — каждая опция по отдельности, с примерами
- [Жизненный цикл модели](/model-lifecycle) — все события от создания до удаления, с диаграммой
- [Продвинутые возможности](/active-model-advanced) — валидаторы, хуки, `new`/`create`/`fill`, сериализация, `mapTo()`
- [Пример для Node.js-сервера](/node-example) — без Vue/Nuxt, на чистом `node:http`

English version: [/en/](/en/)
