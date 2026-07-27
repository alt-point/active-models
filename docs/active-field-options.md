`@ActiveField()`: полный справочник опций
===

`@ActiveField(opts: ActiveFieldDescriptor)` — единственный декоратор, которым описываются поля модели.
Ниже — каждая опция по отдельности: что она делает, на что влияет, как сочетается с другими опциями,
и пример. Общий обзор порядка вызовов (валидатор → события → сеттер) — в конце документа.

Все примеры проверены на реальной сборке (`tsup`/esbuild), а не только прочтением кода.

```ts
type ActiveFieldDescriptor = {
  setter?: Setter<any>
  getter?: Getter<any>
  validator?: Validator<any>
  readonly?: boolean
  hidden?: boolean
  fillable?: boolean
  protected?: boolean
  attribute?: any
  value?: any
  factory?: typeof ActiveModel | [typeof ActiveModel, () => any]
  on?: Partial<Record<PropEvent, ActiveModelHookListener>>
  once?: Partial<Record<PropEvent, ActiveModelHookListener>>
}
```

**Значения по умолчанию** (когда опция не указана явно): `fillable: true`, `protected: true`,
`hidden: false`, `readonly: false`. То есть голый `@ActiveField()` — это поле, которое можно менять,
но нельзя удалить (`delete`).

```ts
class User extends ActiveModel {
  @ActiveField() name: string = ''
}

const user = User.create({ name: 'Alice' })
user.name = 'Bob' // ок — fillable: true по умолчанию
delete (user as any).name // бросит: Property "name" is protected!
```

---

## `value` / `attribute`

Значение по умолчанию для поля. `value` — просто алиас для `attribute`, семантической разницы нет
(`options.attribute || options.value` — если задано хоть одно, используется оно).

Применяется через `Model.create(data)` (и `new Model(data)` — но см. предупреждение в
[active-model-advanced.md](active-model-advanced.md#new-model-data-vs-model-create-data-vs-fill-data)), когда
поле **отсутствует** в переданных данных. Если поле в данных есть — данные побеждают.

```ts
class User extends ActiveModel {
  @ActiveField({ value: 'Guest' }) name?: string
}

User.create({}).name // 'Guest'
User.create({ name: 'Alice' }).name // 'Alice' — данные важнее дефолта
```

Можно передать функцию — она будет вызвана лениво, при каждом создании инстанса (полезно для
не-примитивных значений, чтобы не шарить одну и ту же ссылку между инстансами):

```ts
@ActiveField({ value: () => [] })
items: string[] = []
```

**Взаимодействие с `readonly`**: работает — если поле ещё не было записано другим способом,
`attribute`/`value` станет его единственным значением на всё время жизни инстанса.

**Взаимодействие с `fillable: false`**: **не работает**. `fillable: false` полностью исключает поле
из потока данных `create()`/`fill()` ещё до того, как `attribute`/`value` успеет примениться — единственный
источник значения для такого поля — инициализатор поля класса (`prop: T = ...` в теле класса). Подробности
и почему — в разделе [`fillable`](#fillable) ниже.

```ts
class Locked extends ActiveModel {
  @ActiveField({ fillable: false, value: 'FROM_ATTRIBUTE' })
  id?: string
}

Locked.create({}).id // undefined — attribute-дефолт для fillable:false поля не применяется
```

---

## `fillable`

Разрешает/запрещает установку значения поля через `create()`, `fill()` и прямое присваивание.

- `fillable: true` (по умолчанию) — поле можно менять любым способом.
- `fillable: false` — поле **никогда** не принимает значение из данных или присваивания. Единственный
  способ дать ему значение — инициализатор поля класса (`prop: T = someValue` в теле класса).

```ts
class Invoice extends ActiveModel {
  @ActiveField({ fillable: false })
  number: string = 'INV-0001' // единственный источник значения
}

const invoice = Invoice.create({ number: 'HACKED' })
invoice.number // 'INV-0001' — переданное значение проигнорировано

invoice.number = 'HACKED-2' // бросает исключение
```

**Как это устроено внутри** (важно для интуиции о `attribute`/`value` и о взаимодействии с `readonly`):
ключи `fillable: false`-полей вычищаются из входных данных ещё до вызова `fill()` — то есть данные
физически не долетают до записи, ни при `create()`, ни при `new Model(data)`. Значение поля целиком
определяется тем, что установил инициализатор класса.

**Прямое присваивание бросает исключение** (в отличие от `create()`/`fill()`, которые молча
игнорируют попытку) — так работает строгий режим `Proxy`-инвариантов ES-классов для явного
присваивания `model.prop = x`.

---

## `readonly`

Поле можно установить **один раз** — через `Model.create(data)`, через `new Model(data)`, либо
значением из инициализатора поля класса (что сработает раньше). После этого любые дальнейшие попытки
изменить поле — через `fill()` (даже с `force: true`) или прямое присваивание — **тихо игнорируются**,
без исключения.

```ts
class Order extends ActiveModel {
  @ActiveField({ readonly: true })
  id: string = ''
}

const a = Order.create({ id: 'A1' })
a.id // 'A1' — значение взято из data

a.id = 'A2'
a.id // всё ещё 'A1' — запись молча проигнорирована

const b = new Order({ id: 'B1' })
b.id // 'B1' — так же работает и через конструктор
```

### `readonly: true` vs `fillable: false` — это не одно и то же

На первый взгляд кажется, что `fillable: false` просто дублирует `readonly: true` — оба в итоге
"не дают поле поменять". На деле это два разных гаранта, и `readonly` не может заменить
`fillable: false` (в ловушке `set` проверка `fillable` вообще идёт раньше и отдельно от `readonly` —
см. ["Порядок вызовов"](#порядок-вызовов-при-установке-значения)):

| | `readonly: true` | `fillable: false` |
|---|---|---|
| Можно передать значение через `data` при создании (`create()`/`new Model()`)? | **Да**, один раз | **Никогда** |
| Что происходит при повторной попытке записи? | Тихо игнорируется — без исключения | Через `fill()`/`create()` — тихо игнорируется; **прямое присваивание — бросает исключение** |
| Единственный гарантированный источник значения | `data` (если пришла первой) **или** инициализатор поля класса | **Только** инициализатор поля класса — `attribute`/`value` тоже не работает, см. [`value`/`attribute`](#value-attribute) |
| Что если поле никогда не получало значения ни от `data`, ни от инициализатора? | Остаётся открытым для одной записи позже, через `.fill()` — см. пример в [active-model-advanced.md](active-model-advanced.md#readonly) | Так и останется `undefined` навсегда — записать нечем |
| Типичный сценарий | Поле конфигурируется один раз при создании (например, ID, который может прийти от вызывающей стороны) и потом не должно меняться | Поле в принципе не должно определяться извне — например, значение, которое обязана вычислить сама модель/сервер |

Если нужны **оба** гаранта сразу — значение никогда не берётся из `data`, и попытка прямой записи
после создания громко падает — комбинируйте `readonly: true` с `fillable: false`:

```ts
class Task extends ActiveModel {
  @ActiveField({ readonly: true, fillable: false })
  id: string = crypto.randomUUID() // единственный источник значения
}

Task.create({ id: 'spoofed' } as any).id // сгенерированный UUID — data проигнорирована
new Task({ id: 'spoofed' } as any).id     // то же самое и через конструктор

const task = Task.create({})
task.id = 'HACKED' // бросает исключение
```

Подробный разбор — почему `readonly` тихо игнорирует запись, а не бросает исключение, и полная
механика — в [active-model-advanced.md, раздел `readonly`](active-model-advanced.md#readonly).

---

## `protected`

Запрещает удаление поля (`delete model.prop`). **Не влияет** на возможность изменять значение —
для этого нужен `fillable`/`readonly`. **Не влияет** на сериализацию — поле по-прежнему видно
в `JSON.stringify()`/`Object.keys()`.

Включён **по умолчанию** для любого `@ActiveField()` без явного `protected: false`.

```ts
class User extends ActiveModel {
  @ActiveField() name: string = ''            // protected: true по умолчанию
  @ActiveField({ protected: false }) tag: string = ''
}

const user = User.create({ name: 'Alice', tag: 'x' })
delete (user as any).name // бросает: Property "name" is protected!
delete (user as any).tag  // ок, поле удалено
```

---

## `hidden`

Исключает поле из перечисления: `Object.keys()`, `for...in`, `{...spread}` и `JSON.stringify()`.
Поле остаётся доступным напрямую (`model.field`) — `hidden` скрывает только от перечисления/сериализации,
не от доступа.

```ts
class User extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField({ hidden: true }) passwordHash: string = ''
}

const user = User.create({ id: '1', passwordHash: 'a1b2c3' })
Object.keys(user)              // ['id'] — passwordHash отсутствует
JSON.stringify(user)           // {"id":"1"}
user.passwordHash              // 'a1b2c3' — прямой доступ работает как обычно
```

Хорошо подходит для внутренних/секретных полей, которые модель должна хранить, но никогда не должна
случайно отдать наружу через сериализацию.

---

## `validator`

Функция `(model, prop, value) => boolean | void`, вызывается перед установкой нового значения.

**Важно: `validator` — это не предикат.** Его возвращаемое значение (`true`/`false`) никак не влияет
на результат — оно просто отбрасывается. Единственный способ отклонить значение — **выбросить
исключение** внутри валидатора.

```ts
class Product extends ActiveModel {
  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'number' || value < 0) {
        throw new TypeError(`"${prop}" must be a non-negative number`)
      }
    }
  })
  price: number = 0
}

const product = Product.create({ price: 100 })
product.price = -50 // бросает TypeError, price остаётся 100
```

**Валидатор срабатывает только при реальном изменении значения** (сравнение через `Object.is` с текущим
значением) — он **не вызывается**:
- если поля вообще нет в объекте, переданном в `create()`/`fill()`;
- если явно передать значение, совпадающее с текущим значением поля (например, с его дефолтом).

```ts
Product.create({})               // валидатор НЕ вызван — price остаётся дефолтным 0, даже если 0 невалиден
Product.create({ price: 0 })     // тоже НЕ вызван — совпадает с текущим значением
Product.create({ price: -1 })    // вызван — значение реально отличается от 0
```

Значит, валидатором нельзя гарантировать "поле обязательно" — только "если поле меняется, новое значение
должно быть валидным". Для обязательности проверяйте наличие ключа во входных данных до вызова `create()`
(пример — [node-example.md](node-example.md)).

---

## `setter`

Функция `(model, prop, value, receiver) => boolean`, перехватывает саму запись значения — вызывается
**вместо** обычного присваивания (и должна сама сделать `Reflect.set(...)`, иначе значение не применится).

```ts
class Money extends ActiveModel {
  @ActiveField({
    setter (model, prop, value: number, receiver) {
      return Reflect.set(model, prop, Math.round(value * 100), receiver)
    }
  })
  cents: number = 0
}

Money.create({ cents: 19.999 }).cents // 2000
```

Срабатывает при тех же условиях, что и `validator` — **только при реальном изменении значения**
(та же `Object.is`-проверка, та же логика "не вызывается для отсутствующих/совпадающих значений").

`setter` и `factory` (ниже) — взаимоисключающие способы обработки значения: если задан `factory`,
явный `setter` из опций декоратора **не используется** (используется автоматически сгенерированный
factory-сеттер).

---

## `getter`

Функция `(model, prop, receiver) => any`, перехватывает чтение значения — трансформирует то, что видит
читающий код, не трогая то, что реально хранится в поле.

```ts
class User extends ActiveModel {
  @ActiveField() firstName: string = ''
  @ActiveField() lastName: string = ''
  @ActiveField({
    getter: (model) => `${model.firstName} ${model.lastName}`.trim()
  })
  fullName?: string = undefined // см. предупреждение ниже
}

const user = User.create({ firstName: 'Ada', lastName: 'Lovelace' })
user.fullName // 'Ada Lovelace'
```

**Важно: полю-геттеру без собственного значения нужен инициализатор.** Если объявить поле без `=`
(`fullName?: string`, без значения по умолчанию хотя бы `= undefined`), у него не появится реального
own-property на инстансе — а `Object.keys()`/`JSON.stringify()` помимо списка ключей ловушки `ownKeys`
дополнительно проверяют дескриптор свойства через `getOwnPropertyDescriptor`, и для несуществующего
свойства он пуст. Итог: геттер по-прежнему будет работать при прямом обращении (`user.fullName`), но
**исчезнет** из `Object.keys()`/`JSON.stringify()`. Добавьте явный инициализатор (`= undefined` тоже
считается), чтобы поле было видно и в перечислении.

---

## `factory`

Оборачивает входящее значение в инстанс другого класса `ActiveModel` — удобно для вложенных моделей.
Две формы:

**Одна модель**: `factory: Model`. Значение оборачивается через `Model.createLazy(value)`, а если значение —
массив, каждый элемент оборачивается через `Model.createFromCollectionLazy(value)` (форма автоматически
подстраивается под то, что реально пришло).

```ts
class Address extends ActiveModel {
  @ActiveField() city: string = ''
}
class User extends ActiveModel {
  @ActiveField({ factory: Address }) address?: Address
}

User.create({ address: { city: 'Berlin' } }).address // Address { city: 'Berlin' }
```

**Модель + фабрика дефолтного значения**: `factory: [Model, () => defaultValue]` — та же логика оборачивания,
плюс `() => defaultValue` используется как ленивый дефолт (вызывается заново для каждого инстанса — не
шарит ссылку между инстансами, как и в `value`/`attribute`).

```ts
class Item extends ActiveModel {
  @ActiveField() label: string = ''
}
class Order extends ActiveModel {
  @ActiveField({ factory: [Item, () => []] }) items: Item[] = []
}

Order.create({ items: [{ label: 'a' }, { label: 'b' }] }).items // [Item{label:'a'}, Item{label:'b'}]
Order.create({}).items // [] — свежий массив на каждый инстанс
```

`factory` реализован через автоматически сгенерированный `setter` — свой `setter` в опциях декоратора
при заданном `factory` **игнорируется**.

---

## `on` / `once`

Подписка на события жизненного цикла поля: `beforeSetValue`, `afterSetValue`, `beforeDeletingAttribute`,
`nulling`. `once` — то же самое, но обработчик снимается после первого срабатывания.

Регистрируется **один раз при определении класса** и общая для **всех** инстансов этого класса — сработает
только для того свойства, к которому применён декоратор.

```ts
class Order extends ActiveModel {
  @ActiveField({
    on: {
      afterSetValue ({ prop, value }) {
        console.log(`${prop} изменено на ${value}`)
      }
    }
  })
  status: string = 'new'
}
```

Полный разбор всех четырёх событий (включая точную семантику `nulling` — срабатывает только на переходе
из НЕ-null в null, но не в `undefined`), порядок относительно `validator`/`setter`, и разница с
инстанс-уровневой подпиской `model.emitter.on(...)` — в
[active-model-advanced.md, раздел "Хуки `on` / `once`"](active-model-advanced.md#хуки-on-once).

---

## Порядок вызовов при установке значения

Когда вы делаете `model.prop = value` (или это происходит через `create()`/`fill()`), для
ActiveField-полей срабатывает вот такая последовательность:

1. Сравнение `Object.is(старое, новое)` — если равны, вообще ничего из нижеперечисленного не
   выполняется (запись проходит напрямую).
2. Проверка `fillable` — если `false`, запись блокируется здесь (см. [`fillable`](#fillable)).
3. Проверка `readonly` — если поле уже было записано один раз, запись блокируется здесь (см.
   [`readonly`](#readonly)).
4. `validator(model, prop, value)` — может бросить исключение и прервать всё дальнейшее.
5. Событие `beforeSetValue`.
6. `setter(model, prop, value, receiver)` — либо, если его нет, обычное `Reflect.set`.
7. Событие `afterSetValue`.
8. Событие `nulling` — только если старое значение не было `null`, а новое — `null`.

`getter` в этой последовательности не участвует — он отдельно перехватывает **чтение**, а не запись.
`hidden`/`protected` тоже не влияют на запись — они про перечисление и удаление соответственно.
