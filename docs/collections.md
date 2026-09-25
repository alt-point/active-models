# ActiveCollection: типизированный, при желании отсортированный массив

## Проблема

Обычный `Order[]` — лишь обещание компилятора. В рантайме в него может попасть что угодно: «сырой» объект из
API, `null`, экземпляр другого класса, а список, который должен оставаться упорядоченным (по приоритету, дате,
цене), приходится пересортировывать руками после каждого изменения. `ActiveCollection` — массив, который
**хранит экземпляры одной модели и больше ничего**, умеет **сам поддерживать порядок** и сообщает об изменениях,
как любая другая модель.

## Создание

```ts
import { ActiveModel, ActiveField, ActiveCollection } from '@alt-point/active-models'

class Task extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() title: string = ''
}

const a = Task.collection([{ id: 2 }, { id: 1 }])                         // от модели
const b = ActiveCollection.create(Task, [{ id: 2 }], { sortBy: 'id' })    // явно
const c = Task.createCollection(apiRows, { sortBy: 'id', tracked: true }) // каждый элемент проходит через create()
```

`Model.collection(items, options)` оборачивает элементы как есть; `Model.createCollection(data, options)` сначала
пропускает каждый элемент через `create()` (действуют `sanitize`, `lazy`, `tracked`; `null` пропускаются).

## Правило: только объявленная модель

```ts
const tasks = Task.collection()
tasks.push({ id: 1 })          // OK: обычный объект превращается в Task
tasks.push(Task.create({}))    // OK
tasks.push(5)                  // TypeError: ActiveCollection<Task> accepts only Task instances or plain objects, got number
tasks.push(Other.create({}))   // TypeError: ... got Other
tasks[0] = 'x'                 // TypeError — присваивание по индексу тоже под защитой
```

- Обычные объекты превращаются в экземпляры через `Model.createLazy()`. Чтобы принимать **только экземпляры**,
  передайте `{ coerce: false }`.
- Проверяется каждый путь внутрь: `push`, `unshift`, `splice`, `fill`, `concat`, присваивание по индексу,
  `replaceAll`, даже нативный `Array.prototype.push.call(tasks, x)`.
- В коллекции **не бывает дыр**: `tasks[10] = x` за концом, увеличение `length` и `delete tasks[0]` бросают
  исключение. Используйте `splice()` / `remove()`.
- Посторонние строковые свойства (`tasks.extra = 1`) запрещены; символы — можно.
- Методы **атомарны**: `push(good, bad)` не добавит ничего.

## Отсортированные коллекции

```ts
const tasks = Task.collection([{ id: 3 }, { id: 1 }], { sortBy: 'id' })
tasks.push({ id: 2 })          // встаёт на своё место: [1, 2, 3]
tasks.unshift({ id: 0 })       // «в начало» здесь не имеет смысла: [0, 1, 2, 3]
tasks[1].id = 10               // элемент переезжает: [0, 2, 3, 10]
```

| Опция | Смысл |
|---|---|
| `sortBy: 'id'` / `sortBy: (t) => key` | ключ сортировки: имя поля или функция; ключи `null`/`undefined` всегда в конце |
| `compare: (a, b) => number` | свой компаратор (приоритетнее `sortBy`) |
| `order: 'asc' \| 'desc'` | направление, по умолчанию `asc` |

- Вставка **стабильна**: равные ключи сохраняют порядок добавления.
- Если у элемента изменился ключ, он **переезжает** на новое место; изменение ещё и всплывает (см. ниже).
- То, что нарушило бы порядок, запрещено: присваивание по индексу, `fill()`, `copyWithin()` и `sort(cmp)` с чужим
  компаратором. `sort()` без аргументов пересортирует, а `reverse()` **меняет направление** и оставляет коллекцию
  отсортированной.
- С `sortBy` доступен **бинарный поиск**:

```ts
tasks.bisectLeft(20)      // индекс первого элемента, ключ которого не меньше 20
tasks.bisectRight(20)     // индекс после последнего элемента с ключом <= 20
tasks.findByKey(20)       // первый элемент с ключом 20 или undefined
tasks.range(10, 30)       // элементы с 10 <= ключ <= 30 (обе границы включены, при любом направлении)
```

## События и всплытие

```ts
tasks.on(EventType.itemsAdded, ({ items, index }) => {})
tasks.on(EventType.itemsRemoved, ({ items, index }) => {})
tasks.on(EventType.touched, ({ target }) => {})      // изменился состав ИЛИ элемент
ActiveCollection.on(EventType.itemsAdded, cb)        // все коллекции класса
```

Добавление и удаление эмитят `itemsAdded` / `itemsRemoved`, а затем `touched`; изменение элемента эмитит `touched`
коллекции. Для «пустой» операции (`push()` без элементов) события нет. `index` — позиция первого затронутого элемента.

## В модели

```ts
class Board extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField({ collection: [Task, { sortBy: 'id' }] }) tasks!: ActiveCollection<Task>
  @ActiveField({ collection: Task }) backlog!: ActiveCollection<Task>
}

const board = Board.create({ tasks: [{ id: 2 }, { id: 1 }] })  // станет отсортированной коллекцией
board.backlog                                                  // по умолчанию пустая коллекция
board.tasks.push({ id: 3 })                                    // всплывает как touched доски
```

Присвоенный массив конвертируется; `null`/`undefined` даёт пустую коллекцию; коллекция той же модели остаётся как
есть; всё остальное — исключение. `toJSON()` / `JSON.stringify` отдают обычные массивы, `clone()` клонирует каждый
элемент, а `isTouched()` видит изменения коллекции. `collection` нельзя совмещать с `factory` в одном поле.

## Методы

`push`, `add` (цепочный `push`), `unshift`, `pop`, `shift`, `splice`, `remove(item)`, `clear()`,
`replaceAll(items)`, `sort`, `reverse`, `fill`, `copyWithin`; `filter`, `slice`, `concat` и `clone()` возвращают
**новые коллекции того же вида**; `map`, `flatMap` — обычные массивы. Чтение (`[i]`, `for...of`, `find`,
`includes`, ...) — обычное, как у `Array`.

## Что важно знать

- **Нативные мутаторы защищены, но не атомарны.** `Array.prototype.splice.call(tasks, ...)` никогда не пустит
  чужой элемент, но работает поэлементно и может остановиться на полпути. Используйте собственные методы коллекции.
- **Стоимость.** Чтение по индексу ≈ в 2,5 раза дороже обычного массива (идёт через `Proxy`); вставка в
  отсортированную — O(log n) на поиск места плюс сдвиг; массовая загрузка сортирует один раз. Цифры:
  [Тестирование и качество](/testing).
- **Время жизни.** Коллекция подписывается на свои элементы, но держит себя слабой ссылкой: брошенная коллекция
  собирается GC, даже пока живы её элементы; подписки снимаются при ближайшем изменении элементов.
