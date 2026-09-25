# ActiveCollection: a typed, optionally sorted array

## The problem

A plain `Order[]` is only a promise made by the compiler. At runtime anything can end up in it — a raw
object from the API, a `null`, an instance of another class — and a list that must stay ordered (by priority,
date, price) has to be re-sorted by hand after every change. `ActiveCollection` is an array that **holds
instances of one model and nothing else**, can **keep itself sorted**, and reports its changes like any
other model.

## Creating one

```ts
import { ActiveModel, ActiveField, ActiveCollection } from '@alt-point/active-models'

class Task extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() title: string = ''
}

const a = Task.collection([{ id: 2 }, { id: 1 }])                        // from a model
const b = ActiveCollection.create(Task, [{ id: 2 }], { sortBy: 'id' })   // explicit
const c = Task.createCollection(apiRows, { sortBy: 'id', tracked: true }) // each item goes through create()
```

`Model.collection(items, options)` wraps items as they are; `Model.createCollection(data, options)` first runs
each item through `create()` (so `sanitize`, `lazy` and `tracked` apply, `null` items are skipped).

## The rule: nothing but the declared model

```ts
const tasks = Task.collection()
tasks.push({ id: 1 })          // OK: a plain object becomes a Task
tasks.push(Task.create({}))    // OK
tasks.push(5)                  // TypeError: ActiveCollection<Task> accepts only Task instances or plain objects, got number
tasks.push(Other.create({}))   // TypeError: ... got Other
tasks[0] = 'x'                 // TypeError - index assignment is guarded too
```

- Plain objects are turned into instances with `Model.createLazy()`. Pass `{ coerce: false }` to accept
  **instances only**.
- Every way in is checked: `push`, `unshift`, `splice`, `fill`, `concat`, index assignment, `replaceAll`,
  even the native `Array.prototype.push.call(tasks, x)`.
- The collection **can't have holes**: `tasks[10] = x` beyond the end, growing `length`, and `delete tasks[0]`
  all throw. Use `splice()` / `remove()`.
- Stray string properties (`tasks.extra = 1`) throw; symbols are allowed.
- Methods are **atomic**: `push(good, bad)` adds nothing.

## Sorted collections

```ts
const tasks = Task.collection([{ id: 3 }, { id: 1 }], { sortBy: 'id' })
tasks.push({ id: 2 })          // inserted at its place: [1, 2, 3]
tasks.unshift({ id: 0 })       // "at the start" is meaningless here: [0, 1, 2, 3]
tasks[1].id = 10               // the item moves: [0, 2, 3, 10]
```

| Option | Meaning |
|---|---|
| `sortBy: 'id'` / `sortBy: (t) => key` | sort key: a field name or a function; `null`/`undefined` keys always sort last |
| `compare: (a, b) => number` | a custom comparator (takes precedence over `sortBy`) |
| `order: 'asc' \| 'desc'` | direction, `asc` by default |

- Insertion is **stable**: equal keys keep insertion order.
- When an item's key changes it is **moved** to its new place; the change also bubbles up (see below).
- Operations that would break the order are refused: index assignment, `fill()`, `copyWithin()`, and `sort(cmp)`
  with another comparator. `sort()` with no argument re-sorts; `reverse()` **flips the direction** and keeps
  the collection sorted.
- With `sortBy` the collection has **binary search**:

```ts
tasks.bisectLeft(20)      // index of the first item whose key is not before 20
tasks.bisectRight(20)     // index after the last item with key <= 20
tasks.findByKey(20)       // the first item with key 20, or undefined
tasks.range(10, 30)       // items with 10 <= key <= 30 (both inclusive, whatever the direction)
```

## Events and bubbling

```ts
tasks.on(EventType.itemsAdded, ({ items, index }) => {})
tasks.on(EventType.itemsRemoved, ({ items, index }) => {})
tasks.on(EventType.touched, ({ target }) => {})      // membership changed OR an item changed
ActiveCollection.on(EventType.itemsAdded, cb)        // every collection of the class
```

Adding and removing emit `itemsAdded` / `itemsRemoved` and then `touched`; an item that changes emits the
collection's `touched`. Nothing is emitted for a no-op (`push()` with no items). `index` is the position of the
first affected item.

## On a model

```ts
class Board extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField({ collection: [Task, { sortBy: 'id' }] }) tasks!: ActiveCollection<Task>
  @ActiveField({ collection: Task }) backlog!: ActiveCollection<Task>
}

const board = Board.create({ tasks: [{ id: 2 }, { id: 1 }] })  // becomes a sorted collection
board.backlog                                                  // an empty collection by default
board.tasks.push({ id: 3 })                                    // bubbles up as board's touched
```

Assigning an array converts it; `null`/`undefined` gives an empty collection; a collection of the same model is
kept as is; anything else throws. `toJSON()` / `JSON.stringify` give plain arrays, `clone()` clones every item, and
`isTouched()` sees changes to the collection. `collection` can't be combined with `factory` on one field.

## Methods

`push`, `add` (chainable `push`), `unshift`, `pop`, `shift`, `splice`, `remove(item)`, `clear()`,
`replaceAll(items)`, `sort`, `reverse`, `fill`, `copyWithin`; `filter`, `slice`, `concat` and `clone()` return **new
collections of the same kind**; `map`, `flatMap` return plain arrays. Reads (`[i]`, `for...of`, `find`,
`includes`, ...) are the ordinary `Array` ones.

## Good to know

- **Native mutators are guarded, not atomic.** `Array.prototype.splice.call(tasks, ...)` can never let a foreign
  item in, but it works element by element, so it can stop half-way. Use the collection's own methods.
- **Cost.** Reading by index is ~2.5x a plain array (it goes through a `Proxy`); a sorted insert is O(log n) to find
  the place plus a shift; bulk loading sorts once. Reference numbers: [Testing and quality](/en/testing).
- **Lifetime.** A collection subscribes to its items. It holds itself weakly, so a dropped collection is garbage
  collected even while its items live on; its subscriptions are removed at the items' next change.
