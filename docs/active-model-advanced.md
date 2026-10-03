`ActiveModel`: продвинутые возможности
===

Здесь собраны примеры для возможностей API, которые не вошли в основной пример
([active-model-with-decorators.md](active-model-with-decorators.md)): валидаторы, хуки жизненного цикла,
разница между способами создания модели, сериализация и маппинг в другие структуры.

## Валидаторы

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'

class Product extends ActiveModel {
  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'number' || value < 0) {
        throw new TypeError(`"${prop}" must be a non-negative number, got ${value}`)
      }
    }
  })
  price: number = 0
}

const product = Product.create({ price: 100 })

try {
  product.price = -50
} catch (e) {
  console.error((e as Error).message) // "price" must be a non-negative number, got -50
}

console.log(product.price) // 100 — значение не изменилось
```

**Важно:** `validator` — это не предикат. Его возвращаемое значение (`true`/`false`) никак не влияет на
результат — оно просто отбрасывается. Единственный способ отклонить значение — **выбросить исключение**
внутри валидатора.

**Ещё важнее:** валидатор (как и `setter`, и события `beforeSetValue`/`afterSetValue`) срабатывает,
только когда новое значение **отличается** от текущего (сравнение через `Object.is`). Он **не сработает**,
если поле вообще отсутствует в объекте, переданном в `create()`/`fill()`, и **не сработает**, если явно
передать значение, совпадающее с текущим значением поля (например, с его дефолтом из инициализатора).
Так что валидатором нельзя "поймать" отсутствие обязательного поля — только некорректное значение
**при попытке его действительно изменить**. Для обязательности поля проверяйте наличие ключа во входных
данных до вызова `create()` (см. пример в [node-example.md](node-example.md)).

```ts
class Task extends ActiveModel {
  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`"${prop}" must be a non-empty string`)
      }
    }
  })
  title: string = ''
}

Task.create({}) // НЕ бросает — title остаётся дефолтным '', валидатор не вызывался
Task.create({ title: '' }) // тоже НЕ бросает — новое значение равно текущему, снова пропуск
Task.create({ title: 123 as any }) // бросает — значение реально отличается от '', валидатор сработал
```

## Хуки `on` / `once`

`emitter` не является публичным API — у модели нет свойства `model.emitter`. Подписка идёт напрямую через
`on`/`once`, доступные в трёх независимых вариантах:

1. **Через декоратор** `@ActiveField({ on: {...} })` (или `once`) — регистрируется один раз при определении
   класса и общий для **всех** инстансов этого класса. Срабатывает только для того свойства, к которому
   применён декоратор.
2. **Через `model.on(...)` / `.once(...)`** (инстансный метод) — регистрируется на конкретном инстансе.
   Срабатывает для **любого** активного поля этого инстанса — фильтрацию по имени свойства нужно делать
   в колбэке самостоятельно через `payload.prop`.
3. **Через `Model.on(...)` / `.once(...)`** (статический метод класса) — регистрируется один раз на
   классе и применяется сразу ко **всем** его инстансам, включая те, что будут созданы позже. Это
   единственный способ подписаться на `touched`/`created` сразу для всех инстансов класса, а не для
   одного конкретно — эти два события уровня инстанса нельзя объявить через `@ActiveField({ on: {...} })`
   (см. [Жизненный цикл модели](/model-lifecycle)).

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'

class Order extends ActiveModel {
  @ActiveField({
    on: {
      beforeSetValue ({ prop, value, oldValue }) {
        console.log(`[${prop}] будет изменено: ${oldValue} → ${value}`)
      },
      afterSetValue ({ prop, value }) {
        console.log(`[${prop}] изменено на ${value}`)
      },
      // сработает, только когда значение, которое НЕ было null, становится именно null
      // (переход в undefined это событие не вызывает)
      nulling ({ prop, oldValue }) {
        console.log(`[${prop}] обнулено (было: ${oldValue})`)
      }
    }
  })
  status: string = 'new'

  @ActiveField({ protected: true })
  total: number = 0
}

const order = Order.create({})
order.status = 'paid' // сработают beforeSetValue и afterSetValue выше

try {
  delete (order as any).total // total помечено protected
} catch (e) {
  console.error((e as Error).message) // Property "total" is protected!
}
```

Подписка на уровне инстанса, для сравнения:

```ts
const off = order.on(EventType.afterSetValue, ({ prop, value }: any) => {
  console.log(`инстанс-обработчик: [${prop}] → ${value}`)
})

order.status = 'shipped' // сработают и декораторный хук, и обработчик выше

off() // отписались

const unsubscribeOnce = order.once(EventType.afterSetValue, () => {
  console.log('сработает только один раз')
})
order.status = 'delivered' // сработает
order.status = 'cancelled' // уже не сработает
```

Подписка на уровне класса — например, чтобы централизованно логировать изменения `status` во **всех**
заказах, независимо от того, где и когда конкретный `Order` был создан. У `beforeSetValue`/`afterSetValue`
есть payload с `target` — значит внутри обработчика доступен именно тот инстанс, на котором произошло
изменение:

```ts
class Order extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField() status: string = 'new'
}

// Регистрируется один раз — например, в точке инициализации приложения,
// до создания хотя бы одного Order
Order.on(EventType.afterSetValue, ({ target, prop, value }: any) => {
  if (prop === 'status') {
    console.log(`order ${target.id}: status → ${value}`)
  }
})

const first = Order.create({ id: '1' })
const second = Order.create({ id: '2' })

first.status = 'paid'     // "order 1: status → paid"
second.status = 'shipped' // "order 2: status → shipped" — подписка одна на весь класс
```

Тот же приём работает для `created`/`touched`, для которых нет варианта 1 (декоратора) — это единственный
способ узнавать о создании/изменении **каждого** инстанса класса, не переопределяя `beforeFill` в каждом
месте, где может понадобиться такая подписка. Payload у них — `{ target }`, где `target` — сам инстанс
модели (см. [Жизненный цикл модели](/model-lifecycle)):

```ts
Order.on(EventType.created, ({ target }) => {
  console.log('создан заказ', target.id)
})

Order.create({ id: '3' }) // "создан заказ 3"
new Order({ id: '4' })    // "создан заказ ..." — асинхронно, см. страницу жизненного цикла
```

Подписки **наследуются**: то, что зарегистрировано на родительском классе (`Parent.on(...)` или хук
`@ActiveField({ on })` в родителе), срабатывает и для инстансов всех подклассов. Порядок вызова: сначала
слушатели самых дальних предков, затем ближайшего класса, затем самого инстанса.

### Ошибки в слушателях

Исключение в слушателе не мешает остальным: событие всегда доходит до **всех** слушателей, и только после
этого первая ошибка пробрасывается наружу (в присваивание, `create()` и т. д.). Если упали несколько
слушателей, бросается `Error` с массивом всех ошибок в свойстве `errors`. Значение к этому моменту уже
записано — для отклонения значения используйте `validator`, а не слушатель.

```ts
counter.on(EventType.afterSetValue, () => { throw new Error('a') })
counter.on(EventType.afterSetValue, () => { throw new Error('b') })

try {
  counter.value = 1
} catch (e) {
  (e as any).errors // [Error('a'), Error('b')]
}
```

## `clone()` и `makeFreeze()`

`clone()` возвращает полноценную модель: она обёрнута в тот же `Proxy` (валидаторы, `readonly` и
`fillable: false` продолжают действовать), значения `hidden`-полей сохраняются, вложенные модели клонируются
независимо, а baseline для `isTouched()` переносится на копию. Слушатели уровня инстанса **не** копируются, и
событие `created` для клона не эмитится.

`makeFreeze()` делает модель неизменяемой: любая последующая запись, `delete` или `defineProperty` бросает
`TypeError`. Заморозка поверхностная (вложенные модели и массивы не затрагиваются) и реализована через
ловушки, а не через `Object.freeze()` — настоящий `Object.freeze()` заставил бы `ownKeys` раскрыть `hidden`-поля,
поэтому `Object.isFrozen(model)` вернёт `false`.

```ts
const frozen = order.makeFreeze()
frozen.status = 'x' // TypeError: Cannot assign to "status": the model is frozen (makeFreeze)
```

## `new Model(data)` vs `Model.create(data)` vs `.fill(data)`

### Ловушка: `new Model(data)` может "потерять" переданные данные

```ts
class User extends ActiveModel {
  @ActiveField() name: string = 'Гость'
}

const viaConstructor = new User({ name: 'Алиса' })
console.log(viaConstructor.name) // "Гость" — данные потеряны!

const viaCreate = User.create({ name: 'Алиса' })
console.log(viaCreate.name) // "Алиса" — как ожидалось
```

Причина в порядке инициализации полей класса в JS/TS: инициализатор поля (`name: string = 'Гость'`)
выполняется **после** возврата из `super(data)` и затирает то, что базовый конструктор `ActiveModel`
уже успел заполнить из `data`. `Model.create(data)` обходит эту проблему — сначала создаёт инстанс
(инициализаторы полей отрабатывают), и только потом заполняет его данными.

**Рекомендация:** используйте `Model.create(data)` (и `createLazy`/`asyncCreate*`/`asyncCreateLazy`)
как основной способ создания моделей с данными. Если необходимо переопределить конструктор,
задокументированный обходной путь — вызвать `this.fill(data)` явно после `super(data)`:

```ts
class User extends ActiveModel {
  @ActiveField() name: string = 'Гость'

  constructor (data?: any) {
    super(data)
    if (data) {
      this.fill(data)
    }
  }
}

new User({ name: 'Алиса' }).name // "Алиса" — обходной путь восстанавливает данные
```

### `fill()`

`.fill(data, force?)` — точечно заполняет поля уже созданного инстанса.

- Без `force` — заполняет только "свои" ключи: уже объявленные (own) поля модели или поля,
  зарегистрированные как `fillable`. Незнакомые ключи из `data` тихо игнорируются.
- С `force: true` — заполняет **любой** ключ из `data`, включая незадекларированные — используйте
  с осторожностью, это может добавить в модель произвольные поля мимо схемы.
- Поле, помеченное `fillable: false`, всё равно **не будет** перезаписано через `fill()`, даже с
  `force: true` — `force` снимает только проверку "это известное поле", но не проверку `fillable`
  в самом сеттере прокси. Для `readonly` действует более тонкое правило — см. раздел
  [`readonly`](#readonly) ниже.

```ts
const user = User.create({ name: 'Алиса' })
user.fill({ unknownField: '...' } as any) // проигнорировано — unknownField не объявлен и не fillable
user.fill({ unknownField: '...' } as any, true) // добавлено принудительно
```

### `fillable`

По умолчанию (`@ActiveField()` без опций) поле получает `fillable: true, protected: true` — то есть его
можно менять, но нельзя удалить (`delete`). `fillable: false` — поле нельзя изменить ни через
`create()`/`fill()`, ни через прямое присваивание.

```ts
class Invoice extends ActiveModel {
  @ActiveField({ fillable: false })
  number: string = 'INV-0001'
}

const invoice = Invoice.create({ number: 'HACKED' })
console.log(invoice.number) // "INV-0001" — переданное значение молча проигнорировано при create()

try {
  invoice.number = 'HACKED-2'
} catch (e) {
  console.error((e as Error).message) // 'set' on proxy: trap returned falsish for property 'number'
}
```

Обратите внимание на асимметрию: `create()`/`fill()` молча игнорируют заблокированную запись (они вызывают
`Reflect.set` как функцию — она просто возвращает `false`, без исключения), а вот **прямое присваивание**
(`model.prop = x`) в этом случае бросает исключение — так требует строгий режим `Proxy`-инвариантов в ES-классах.

### `readonly`

Поле, помеченное `readonly: true`, можно установить **один раз** — через `Model.create(data)` (фабрику),
через `new Model(data)` (конструктор) или значением из инициализатора поля класса, смотря что сработает
раньше. После этого любые дальнейшие попытки изменить поле — через `fill()` (даже с `force: true`) или
прямое присваивание — **тихо игнорируются**, без исключения: значение просто не меняется.

```ts
class Order extends ActiveModel {
  @ActiveField({ readonly: true })
  id: string = ''
}

const a = Order.create({ id: 'A1' })
console.log(a.id) // 'A1' — значение взято из data

a.id = 'A2'
console.log(a.id) // всё ещё 'A1' — запись молча проигнорирована

const b = new Order({ id: 'B1' })
console.log(b.id) // 'B1' — точно так же работает и через конструктор
```

**Почему это молча игнорируется, а не бросает исключение** (в отличие от `fillable: false` выше): если
бы заблокированная запись бросала исключение, стандартный сценарий "readonly-поле + собственный
инициализатор" ломал бы конструктор. При `new Model(data)` инициализатор подкласса (`id: string =
randomUUID()`) выполняется **после** `super(data)` — то есть он попадает в прокси уже вторым
присваиванием того же поля (первое произошло при заполнении из `data` внутри `super()`), и если бы это
бросало исключение, само создание объекта завершалось бы ошибкой.

**Если нужно, чтобы клиентские данные вообще не могли повлиять на поле** — например, `id`/`createdAt`,
которые обязаны генерироваться только сервером (см. [node-example.md](node-example.md)) — `readonly`
сам по себе для этого недостаточен: раз он допускает установку значения из `data` при первой попытке,
злоумышленник может просто передать нужное поле в `data`, и оно "займёт" эту единственную попытку записи.
Для по-настоящему server-only поля комбинируйте `readonly` с `fillable: false` — эта комбинация ведёт
себя как обычный `fillable: false` (блокирует запись всегда, включая первую попытку из `data`), и
единственный источник значения — инициализатор поля класса:

```ts
class Task extends ActiveModel {
  @ActiveField({ readonly: true, fillable: false })
  id: string = randomUUID() // единственный источник значения — этот инициализатор
}

Task.create({ id: 'spoofed' }).id // сгенерированный UUID, а не 'spoofed' — data полностью проигнорирована
```

## Сериализация и `toJSON()`

```ts
class User extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField({ hidden: true }) passwordHash: string = ''
  @ActiveField({ protected: true }) role: string = 'user'
  @ActiveField({ readonly: true }) createdAt: string = new Date().toISOString()
}

const user = User.create({ id: '1', passwordHash: 'a1b2c3', role: 'admin' })

console.log(Object.keys(user)) // ['id', 'role', 'createdAt'] — passwordHash отсутствует
console.log(JSON.stringify(user)) // {"id":"1","role":"admin","createdAt":"..."}
console.log(user.passwordHash) // "a1b2c3" — hidden скрывает только от перечисления/сериализации
```

- **`hidden`** — поле не появляется в `Object.keys()`, `for...in`, `{...spread}` и `JSON.stringify()`,
  но остаётся доступным напрямую (`user.passwordHash`). Хорошо подходит для паролей/токенов, которые
  модель должна хранить, но никогда не должна случайно сериализовать наружу.
- **`protected`** — поле видно и сериализуется как обычно, но `delete user.role` бросит исключение.
- **`readonly`** — поле видно и сериализуется, но присвоить новое значение после создания нельзя
  (см. также раздел про `fillable`/`readonly` выше).

## `mapTo()` / `hasMapping()`

Позволяет один раз задать правило преобразования модели в другую структуру (DTO для бэкенда, view-модель
и т.п.) и переиспользовать его на любом инстансе.

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'

class Order extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField() total: number = 0
}

// Целевая структура не обязана быть ActiveModel
class OrderPayload {
  constructor (public orderId: string, public amountCents: number) {}
}

// Регистрируем маппинг один раз — например, в точке инициализации приложения
Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))

const order = Order.create({ id: '42', total: 19.99 })

order.hasMapping(OrderPayload) // true

const payload = order.mapTo(OrderPayload)
// payload instanceof OrderPayload → { orderId: '42', amountCents: 1999 }
```

По умолчанию `mapTo(target, lazy = true, ...args)` работает "лениво": если маппинг для `target` не
зарегистрирован, метод молча возвращает `order.clone()` вместо ошибки. Передайте `lazy: false`, чтобы
явно упасть с ошибкой при отсутствии маппинга:

```ts
class Unmapped {}
order.mapTo(Unmapped) // маппинг не зарегистрирован → тихо вернёт order.clone()
order.mapTo(Unmapped, false) // бросит: "Mapping for target not found"
```

Подробнее, с несколькими целями на одной модели, примерами на Vue/React и сравнением с
`class-transformer`/AutoMapper: [Трансформация моделей: mapTo() и hasMapping()](/mapping).
