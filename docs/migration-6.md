# Миграция с 5.x на 6.0

Версия 6.0 убирает поведение, объявленное устаревшим в 5.x. Скрипта миграции для этого релиза нет: каждый пункт
ниже — ошибка в рантайме, которую исправляют в месте вызова.

| 5.x | 6.0 |
|---|---|
| `Model.create('str' / 42 / true / null)` превращался в `create({})` (с `console.warn` начиная с 5.1) | бросает `TypeError` (`User.create() expects an object, got null`), как и `new Model(primitive)`; `create()` без аргумента по-прежнему даёт пустую модель |

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

## Что не затронуто

- `create()` без аргумента (или с `undefined`) даёт пустую модель, как раньше.
- `createFromCollection()` по-прежнему пропускает элементы `null` / `undefined`.
- `create([])` бросал `TypeError` уже в 5.x.
