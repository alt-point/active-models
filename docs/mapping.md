# Трансформация моделей: `mapTo()` и `hasMapping()`

## Проблема

Модель, полученную от API, редко можно отправить в третий сервис как есть: денежная сумма приходит в
долларах, а платёжному провайдеру нужны центы; полное имя нужно разбить на `firstName`/`lastName` для
CRM; внутренний `Order` не должен светить наружу поля, которых нет в контракте GraphQL-мутации. Разным
получателям бывает нужна разная проекция одной и той же модели одновременно — REST-пейлоад, view-модель
для UI, событие для аналитики.

Обычное решение — функции-мапперы, разбросанные по местам использования (`toApiPayload(order)`,
`toAnalyticsEvent(order)`), которые никак не связаны с самим классом `Order` и о существовании которых
нужно помнить отдельно. `mapTo()`/`hasMapping()` привязывают правило трансформации к самому классу модели
— один раз регистрируете, дальше вызываете на любом инстансе.

## Базовое использование

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

class Order extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField() total: number = 0
}

// Целевая структура не обязана быть ActiveModel — это может быть любой класс или POJO
class OrderPayload {
  constructor (public orderId: string, public amountCents: number) {}
}

// Регистрируется один раз — например, в точке инициализации модуля
Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))

const order = Order.create({ id: '42', total: 19.99 })

order.hasMapping(OrderPayload) // true
const payload = order.mapTo(OrderPayload)
// payload instanceof OrderPayload → { orderId: '42', amountCents: 1999 }
```

`Order.mapTo(target, handler)` — статический метод, регистрирует обработчик один раз для всего класса.
`order.mapTo(target)` — инстансный метод, применяет уже зарегистрированный обработчик к конкретному
инстансу. `hasMapping(target)` доступен и статически (`Order.hasMapping(...)`), и на инстансе
(`order.hasMapping(...)`) — оба смотрят в один и тот же реестр.

## Ключ маппинга — это ссылка, а не строка

`target` ищется в `WeakMap` по идентичности ссылки, а не по имени: это может быть класс, `Symbol`,
строковая константа — что угодно, лишь бы это была одна и та же ссылка при регистрации и при вызове.
Отсюда следует, что **на одной модели можно зарегистрировать сколько угодно независимых проекций**,
каждая под своим ключом:

```ts
const ANALYTICS_EVENT = Symbol('order.analytics')

Order.mapTo(ANALYTICS_EVENT, (order) => ({
  event: 'order_viewed',
  order_id: order.id,
  value_cents: Math.round(order.total * 100),
}))

Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))

// Один и тот же order — две независимые проекции
order.mapTo(ANALYTICS_EVENT) // { event: 'order_viewed', order_id: '42', value_cents: 1999 }
order.mapTo(OrderPayload)    // OrderPayload { orderId: '42', amountCents: 1999 }
```

Не используйте объектный литерал, созданный заново на каждый вызов (`order.mapTo({})`), в качестве ключа
— он не будет равен самому себе при следующем вызове, и `hasMapping` всегда вернёт `false`. Ключ должен
быть стабильной, переиспользуемой ссылкой: классом, модулем-константой `Symbol`/строкой.

## `lazy` и запасной вариант

По умолчанию (`lazy = true`) отсутствие маппинга не считается ошибкой — метод молча возвращает
`order.clone()`. Это осознанный компромисс: код, который опционально пытается замапить модель (например,
универсальный логгер, который логирует "как есть", если специального формата для типа не задано), не
должен оборачивать каждый вызов в `try/catch`.

```ts
class Unmapped {}
order.mapTo(Unmapped)        // маппинг не зарегистрирован → тихо возвращает order.clone()
order.mapTo(Unmapped, false) // маппинг не зарегистрирован → бросает: "Mapping for target not found"
```

Передавайте `lazy: false`, когда отсутствие маппинга — это баг, который должен упасть максимально громко
(например, при экспорте в обязательный внешний контракт).

## Дополнительные аргументы

`mapTo(target, lazy, ...args)` прокидывает всё, что после `lazy`, прямо в обработчик — удобно для
параметризации трансформации без замыкания лишнего состояния в самом обработчике:

```ts
Order.mapTo(OrderPayload, (order, locale: string) => new OrderPayload(
  order.id,
  Math.round(order.total * 100),
))

order.mapTo(OrderPayload, true, 'ru-RU')
```

## Использование во Vue

Типичное место для маппинга — граница между моделью и слоем API/аналитики, например в composable или
Pinia-экшене:

```ts
// useOrderApi.ts
import { Order, OrderPayload } from './models'

export function useOrderApi () {
  async function submitOrder (order: Order) {
    // граница системы: наружу уходит только явно замапленная проекция,
    // а не сам ActiveModel с его служебными полями
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
  <button @click="submitOrder(props.order)">Оформить заказ</button>
</template>
```

`lazy: false` здесь осознан: если маппинг для `OrderPayload` не зарегистрирован, лучше упасть с понятной
ошибкой на этапе разработки, чем молча отправить на бэкенд сериализованный `Order` целиком.

## Использование в React

Тот же принцип — маппинг вызывается на границе, где модель покидает приложение (запрос к API, событие
аналитики), а не размазывается по компонентам:

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

  return <button disabled={pending} onClick={onSubmit}>Оформить заказ</button>
}
```

Если в приложении несколько форматов вывода одной модели (REST-пейлоад, GraphQL input, аналитическое
событие), зарегистрируйте под каждый свой `Symbol`-ключ рядом с определением класса `Order` — тогда все
доступные проекции видны в одном месте, а не разбросаны по компонентам, которые их используют.

## Сравнение с другими подходами

| Подход | Где регистрируется правило | Несколько целевых форм на одной модели | Зависимости |
|---|---|---|---|
| **`ActiveModel.mapTo()`** | статически на классе модели | да, по произвольному ключу-ссылке | нет — часть библиотеки |
| `class-transformer` (`plainToInstance`/`instanceToPlain`, `@Expose`/`@Exclude`) | декораторы на полях класса | ограниченно — через `@Expose({ groups })` | `reflect-metadata`, требует `experimentalDecorators` и метаданные типов |
| AutoMapper (`automapper-nartc` и аналоги) | отдельные "профили" вне класса модели | да, явно конфигурируется | отдельная библиотека, отдельный слой конфигурации |
| Zod `.transform()` | в цепочке схемы валидации | по одной трансформации на схему | требует описывать модель как Zod-схему, а не класс |
| Ручные функции-мапперы | где угодно в кодовой базе | да, но без единого реестра | нет, но и нет способа узнать "а есть ли маппинг" программно |

Ключевое отличие `mapTo()` — не в мощности трансформации (обработчик — обычная функция, никакой магии
автоматического сопоставления полей по имени), а в том, **где живёт knowledge о доступных проекциях**:
рядом с классом модели, обнаруживаемо через `hasMapping()`, без рефлексии и без отдельного слоя
конфигурации. Плата за простоту — маппинг всегда explicit: если нужно поле-в-поле сопоставление вложенных
объектов или списков, это пишете вы сами внутри обработчика, а не декларативная схема.
