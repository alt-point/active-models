# Миграция с 5.x на 6.0

Версия 6.0 удаляет `Enum` (устарел с 4.x) и меняет три поведения, которые нельзя было исправить совместимо. Скрипта
миграции для этого релиза нет: пункты 1 и 2 — ошибка в рантайме или при сборке, которую исправляют в месте вызова; пункты 3 и 4
меняют работу существующего кода — проверьте места, которые они называют.

| 5.x | 6.0 |
|---|---|
| `Model.create('str' / 42 / true / null)` превращался в `create({})` | бросает `TypeError` (`User.create() expects an object, got null`), как и `new Model(primitive)`; `create()` без аргумента по-прежнему даёт пустую модель |
| `import { Enum } from '@alt-point/active-models/Enum'` (устарел с 4.x) и тип `EnumItemType` из `/types` | удалены: используйте TS-`enum` или объединение строк с правилом `oneOf` (`@ActiveField({ oneOf: Status })`) |
| `validator`, вернувший `false`, игнорировался: запись проходила | отклоняет запись: `ValidationError` с кодом `validator` и сообщением `"prop" is invalid`; `validate()` так же сообщает о сохранённом значении. Исключение работает как раньше; `true` / `undefined` принимают |
| `transaction()` откатывался из снимка, поэтому plain-значение, изменённое на месте (`m.tags.push(x)`, `m.date.setHours(0)`), тоже восстанавливалось | откатывается по журналу записей: правка plain-значения на месте записью не является и остаётся после отката; заменяйте значение (`m.tags = [...m.tags, x]`) |

## 1. `Model.create(primitive)` бросает `TypeError`

Строка, число, булево значение или `null` вместо данных раньше давали пустую модель, и отсутствующая запись шла
дальше как `{}`. Теперь это `TypeError`:

```ts
// было
const user = User.create(await api.findUser(id)) // null -> пустой User

// стало
const user = User.create(await api.findUser(id)) // TypeError: User.create() expects an object, got null
```

Проверяйте данные до вызова или вызывайте `create()` без аргумента, если нужна пустая модель:

```ts
const data = await api.findUser(id)
const user = data ? User.create(data) : null
const draft = User.create() // пустая модель, как раньше
```

Проверка срабатывает везде, где данные превращаются в модель, а не только в прямых вызовах `create()`:

- `createLazy()`, а также `asyncCreate()` / `asyncCreateLazy()`, чей промис вернул `null`, строку, число или булево
  значение (они отклоняются);
- элемент-примитив `createFromCollection()`, кроме `null` / `undefined`, например `User.createFromCollection(['a'])`;
- поле с `factory`, которому пришёл примитив, раньше превращавшийся в пустую модель:
  `Order.create({ address: 'Berlin' })` бросает `Address.create() expects an object, got "Berlin"`.

`new User(null)` тоже бросает исключение (`new User() expects an object, got null`); в 5.x он молча давал пустую модель.

## 2. Удалён `Enum`

Подпуть `/Enum`, класс `Enum` и тип `EnumItemType` удалены, поэтому
`import { Enum } from '@alt-point/active-models/Enum'` больше не разрешается. Перечислите допустимые значения в
TypeScript-`enum` или в массиве `as const` (тип его элемента — объединение строк), а остальные отклонит
[правило `oneOf`](/validation):

```ts
// было
import { Enum } from '@alt-point/active-models/Enum'

export const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

class Order extends ActiveModel {
  @ActiveField({ validator: (_model, _prop, value) => OrderStatuses.validate(value) })
  status: string = OrderStatuses.default
}

// стало
export enum OrderStatus { New = 'new', Complete = 'complete', Shipping = 'shipping' }

class Order extends ActiveModel {
  @ActiveField({ oneOf: OrderStatus })
  status: OrderStatus = OrderStatus.New
}
```

| `Enum` | 6.0 |
|---|---|
| `new Enum(['new', 'complete'], 'new')` | `enum OrderStatus { ... }` или `const STATUSES = ['new', 'complete'] as const` |
| `.default` | инициализатор поля или опция `value` |
| `.values()`, `.keys()` | `Object.values(OrderStatus)` (строковый `enum`) или сам массив |
| `.has(v)` | `(Object.values(OrderStatus) as string[]).includes(v)` или `includes` массива |
| `.validate(v)` в `validator` | `oneOf`: отклонённое значение бросает `ValidationError` с кодом `oneOf` вместо обычного `Error` |

У `.get(v)` и `.entries()` замены нет: `get(v)` возвращал `v` или `undefined`, `entries()` — пары `[v, v]`.

Для `validate([a, b])` по массиву значений своего правила нет: оставьте `validator`, который проверяет каждый элемент, например
`validator: (_m, _p, v: OrderStatus[]) => v.every((s) => Object.values(OrderStatus).includes(s))`.

## 3. `validator`, вернувший `false`, отклоняет запись

В 5.x значение отклонял только `validator`, бросивший исключение; возвращаемое значение игнорировалось, и валидатор-предикат
пропускал всё. Теперь `false` отклоняет запись с `ValidationError` (код `validator`, сообщение `"prop" is invalid`), а
`validate()` сообщает о сохранённом значении, которое валидатор не принимает. `true`, `undefined` и исключение работают как
раньше ([`validator`](/active-field-options#validator)).

```ts
class Product extends ActiveModel {
  @ActiveField({ validator: (_m, _p, v: number) => v >= 0 }) price: number = 0
}

const product = Product.create({ price: 1 })
product.price = -1 // 5.x: записано; 6.0: ValidationError: "price" is invalid
```

- Валидатор, который и должен был отклонять, менять не нужно; ради своего сообщения бросьте исключение вместо `false`.
- Валидатор ради побочного эффекта, случайно возвращавший `false`, не должен возвращать ничего: `validator: (_m, _p, v) => { track(v) }`.
- Код, который записывал значение вопреки валидатору и разбирался с ним позже, теперь получает исключение при записи.

## 4. `transaction()` не откатывает правки plain-значений на месте

Раньше откат восстанавливал модель из снимка, сделанного в начале, и заодно возвращал обычный массив или `Date`, изменённые на
месте. Теперь он проигрывает журнал записей — поэтому его стоимость [пропорциональна изменениям](/integrity), — а правка
plain-значения на месте записью не является: `m.tags.push(x)` или `m.date.setHours(0)` остаются после отката. Вложенные модели
и контейнеры (`ActiveCollection` / `ActiveMap` / `ActiveSet`) записывают свои операции сами и восстанавливаются, как раньше.

```ts
order.transaction((o) => {
  o.tags.push('rush')          // останется после отката
  o.tags = [...o.tags, 'rush'] // будет отменено
  throw new Error('abort')
})
```

Заменяйте значения вместо правки на месте (`m.tags = [...m.tags, x]`, `m.date = new Date(...)`): это правило уже действовало
для событий, dirty-tracking и истории.

## Что не затронуто

- `create()` без аргумента (или с `undefined`) даёт пустую модель, как раньше.
- `createFromCollection()` по-прежнему пропускает элементы `null` / `undefined`.
- `create([])` бросал `TypeError` уже в 5.x.
