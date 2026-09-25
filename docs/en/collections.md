# ActiveCollection, ActiveMap, ActiveSet: typed containers

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

## Unique keys

```ts
const users = User.collection(rows, { unique: 'email' })      // or unique: (u) => u.email.toLowerCase()
users.push({ id: 9, email: 'a@x.io' })    // ValidationError code 'unique': Duplicate key "a@x.io" in ActiveCollection<User>
users.getByKey('a@x.io')                  // O(1) lookup
users.hasKey('b@x.io')
```

The key is checked when items come in (`push`, `unshift`, `splice`, index assignment, `replaceAll`, the initial items) and
**nothing changes** if it is refused; `splice`/`replaceAll` may reuse the key of an item that is leaving. `null` and
`undefined` keys are exempt. When an item's key field changes, the lookup follows it — but a change onto a key another item
already holds is **not prevented** (the write has happened) and doesn't steal the entry. An unsorted unique collection
refuses `fill()` and `copyWithin()`, which would put one item in several slots.

## `ActiveMap`: keyed by a field

```ts
const users = ActiveMap.create(User, { key: 'id' }, rows)     // key: a field name or (item) => key

users.get(1)                              // a User
users.add({ id: 2 }, { id: 3 })           // the key is derived from each item
users.set(4, { id: 4 })                   // the key must be the item's own: set(5, { id: 4 }) throws
users.delete(1); users.clear()
```

It is a real `Map` (`instanceof Map`, `size`, `keys()`, `for...of`...), but holds only instances of the model, with the
same coercion rule as the collection. Setting a key that exists replaces the item and reports both; when an item's key
field changes the entry moves to the new key (displacing whatever held it). Events: `itemsAdded`, `itemsRemoved`
(payload has `keys`) and `touched`. `toJSON()` is an object keyed by the key.

## `ActiveSet`: identity plus an optional unique key

```ts
const members = ActiveSet.create(User, rows, { unique: 'email' })
members.add({ id: 1 })                    // a plain object becomes a User; adding the same instance again is a no-op
members.addAll([...])                     // atomic
members.getByKey('a@x.io'); members.hasKey('b@x.io')
```

## On a model

```ts
class Team extends ActiveModel {
  @ActiveField({ map: [User, { key: 'id' }] }) byId!: ActiveMap<User>
  @ActiveField({ set: [User, { unique: 'email' }] }) members!: ActiveSet<User>
  @ActiveField({ collection: [User, { unique: 'email' }] }) list!: ActiveCollection<User>
}
```

`map` accepts an array, a `Map` or an object of items; `set` accepts an array or a `Set`; both default to empty. Like the
collection they bubble every change up as the model's `touched`, serialize to plain data, clone deeply and are covered by
`isTouched()`, `changes()` and `revert()`. One container option per field.

## Good to know

- **Native mutators are guarded, not atomic.** `Array.prototype.splice.call(tasks, ...)` can never let a foreign
  item in, but it works element by element, so it can stop half-way. Use the collection's own methods.
- **Cost.** Reading by index is ~2.5x a plain array (it goes through a `Proxy`); a sorted insert is O(log n) to find
  the place plus a shift; bulk loading sorts once. Reference numbers: [Testing and quality](/en/testing).
- **Lifetime.** A collection subscribes to its items. It holds itself weakly, so a dropped collection is garbage
  collected even while its items live on; its subscriptions are removed at the items' next change.
