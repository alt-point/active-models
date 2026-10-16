# Миграция с 5.x на 6.0

Версия 6.0 убирает поведение и API, объявленные устаревшими в 5.x. Скрипта миграции для этого релиза нет: каждый
пункт ниже — ошибка в рантайме или при сборке, которую исправляют в месте вызова.

| 5.x | 6.0 |
|---|---|
| `Model.create('str' / 42 / true / null)` превращался в `create({})` (с `console.warn` начиная с 5.1) | бросает `TypeError` (`User.create() expects an object, got null`), как и `new Model(primitive)`; `create()` без аргумента по-прежнему даёт пустую модель |
| `import { Enum } from '@alt-point/active-models/Enum'` (устарел с 4.x) и тип `EnumItemType` из `/types` | удалены: используйте TS-`enum` или объединение строк с правилом `oneOf` (`@ActiveField({ oneOf: Status })`) |

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

Вызовы, которые нужно исправить, показывает предупреждение 5.x (`User.create() got null instead of an object: ...`).
Кроме прямых вызовов `create()`, это:

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

## Что не затронуто

- `create()` без аргумента (или с `undefined`) даёт пустую модель, как раньше.
- `createFromCollection()` по-прежнему пропускает элементы `null` / `undefined`.
- `create([])` бросал `TypeError` уже в 5.x.
