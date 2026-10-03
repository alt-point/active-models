import { describe, it, expect } from 'vitest'
import { ActiveModel } from '../src/ActiveModel'
import { ActiveField } from '../src/decorators'
import { EventType } from '../src/types'
import { ActiveCollection } from '../src/ActiveCollection'
import { isCollection } from '../src/collectionRegistry'

class Task extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() title: string = ''
  @ActiveField() priority?: number
}
class Other extends ActiveModel {
  @ActiveField() id: number = 0
}

const ids = (c: Iterable<Task>) => Array.from(c, (t) => t.id)

describe('ActiveCollection: what it accepts', () => {
  it('holds instances of its model and turns plain objects into instances', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, Task.create({ id: 2 })])
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toBeInstanceOf(Task)
    expect(tasks[0].id).toBe(1)
    expect(isCollection(tasks)).toBe(true)
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.model).toBe(Task)
  })

  it.each([
    ['a primitive', 5],
    ['a string', 'x'],
    ['null', null],
    ['undefined', undefined],
    ['an array', [1]],
    ['an instance of another model', Other.create({})],
  ])('refuses %s through push()', (_label, value) => {
    const tasks = ActiveCollection.create(Task)
    expect(() => tasks.push(value as any)).toThrow(TypeError)
    expect(tasks).toHaveLength(0)
  })

  it('names the model and what it got in the error', () => {
    expect(() => ActiveCollection.create(Task).push(5 as any)).toThrow(
      'ActiveCollection<Task> accepts only Task instances or plain objects, got number'
    )
    expect(() => ActiveCollection.create(Task, [], { coerce: false }).push({ id: 1 } as any)).toThrow(
      'ActiveCollection<Task> accepts only Task instances, got Object'
    )
    expect(() => ActiveCollection.create(Task).push(Other.create({}) as any)).toThrow(/got Other/)
  })

  it('coerce:false accepts instances only', () => {
    const tasks = ActiveCollection.create(Task, [Task.create({ id: 1 })], { coerce: false })
    expect(tasks).toHaveLength(1)
    expect(() => tasks.push({ id: 2 } as any)).toThrow(TypeError)
  })

  it('is atomic: one bad item means nothing is added', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }])
    expect(() => tasks.push({ id: 2 }, 5 as any, { id: 3 })).toThrow(TypeError)
    expect(ids(tasks)).toEqual([1])
    expect(() => ActiveCollection.create(Task, [{ id: 1 }, 'bad' as any])).toThrow(TypeError)
  })

  it('cannot be built for something that is not a model class', () => {
    expect(() => ActiveCollection.create(class Plain {} as any)).toThrow('needs a class extending ActiveModel')
    expect(() => ActiveCollection.create(undefined as any)).toThrow(TypeError)
  })
})

describe('ActiveCollection: no way around the rule', () => {
  it('index assignment, length and native Array.prototype calls are all guarded', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }])
    expect(() => { (tasks as any)[0] = 5 }).toThrow(TypeError)
    expect(() => { (tasks as any)[2] = 5 }).toThrow(TypeError)
    expect(() => Array.prototype.push.call(tasks, 5)).toThrow(TypeError)
    expect(() => Object.defineProperty(tasks, '0', { value: 5 })).toThrow(TypeError)
    expect(ids(tasks)).toEqual([1, 2])
  })

  it('native Array.prototype mutators can never let a foreign item in (they are just not atomic)', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }])
    expect(() => Array.prototype.unshift.call(tasks, 5)).toThrow(TypeError)
    expect(() => Array.prototype.splice.call(tasks, 0, 0, 5)).toThrow(TypeError)
    expect(Array.from(tasks).every((item) => item instanceof Task)).toBe(true)
  })

  it('index assignment replaces with a valid item, or appends at length', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }])
    tasks[0] = Task.create({ id: 9 })
    tasks[1] = { id: 10 } as any
    expect(ids(tasks)).toEqual([9, 10])
    expect(tasks[1]).toBeInstanceOf(Task)
  })

  it('cannot get holes: beyond-length assignment, growing length, delete', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }])
    expect(() => { (tasks as any)[5] = { id: 2 } }).toThrow(RangeError)
    expect(() => { tasks.length = 5 }).toThrow(RangeError)
    expect(() => { delete (tasks as any)[0] }).toThrow(/holes/)
    expect(ids(tasks)).toEqual([1])
  })

  it('shrinking length removes items', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }, { id: 3 }])
    tasks.length = 1
    expect(ids(tasks)).toEqual([1])
  })

  it('refuses stray string properties but allows symbols', () => {
    const tasks = ActiveCollection.create(Task)
    expect(() => { (tasks as any).extra = 1 }).toThrow(/cannot set property "extra"/)
    expect(() => Object.defineProperty(tasks, 'extra', { value: 1 })).toThrow(/cannot define property "extra"/)
    const key = Symbol('meta')
    ;(tasks as any)[key] = 1
    expect((tasks as any)[key]).toBe(1)
  })

  it('has the usual Array behavior for reads', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }])
    expect(tasks.map((t) => t.id)).toEqual([1, 2])
    expect(tasks.map((t) => t.id)).not.toBeInstanceOf(ActiveCollection)
    expect(tasks.find((t) => t.id === 2)).toBe(tasks[1])
    expect(tasks.includes(tasks[0])).toBe(true)
    expect([...tasks]).toHaveLength(2)
    expect(tasks.at(-1)).toBe(tasks[1])
    expect(JSON.parse(JSON.stringify(tasks))).toEqual([
      { id: 1, title: '' }, { id: 2, title: '' },
    ])
  })
})

describe('ActiveCollection: mutators', () => {
  it('push / add / unshift / pop / shift', () => {
    const tasks = ActiveCollection.create(Task)
    expect(tasks.push({ id: 2 }, { id: 3 })).toBe(2)
    expect(tasks.unshift({ id: 1 })).toBe(3)
    expect(tasks.add({ id: 4 })).toBe(tasks)
    expect(ids(tasks)).toEqual([1, 2, 3, 4])
    expect(tasks.pop()!.id).toBe(4)
    expect(tasks.shift()!.id).toBe(1)
    expect(ids(tasks)).toEqual([2, 3])
    expect(ActiveCollection.create(Task).pop()).toBeUndefined()
    expect(ActiveCollection.create(Task).shift()).toBeUndefined()
  })

  it('splice removes, inserts and returns what it removed - including negative and clamped arguments', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
    expect(tasks.splice(1, 2, { id: 9 }).map((t) => t.id)).toEqual([2, 3])
    expect(ids(tasks)).toEqual([1, 9, 4])
    expect(tasks.splice(-1).map((t) => t.id)).toEqual([4])
    expect(tasks.splice(-99, 1).map((t) => t.id)).toEqual([1])
    expect(tasks.splice(99, 5, { id: 7 })).toEqual([])
    expect(ids(tasks)).toEqual([9, 7])
    expect(tasks.splice(0, -3)).toEqual([])
    expect(() => tasks.splice(0, 0, 5 as any)).toThrow(TypeError)
  })

  it('remove / clear / replaceAll', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }])
    expect(tasks.remove(tasks[0])).toBe(true)
    expect(tasks.remove(Task.create({ id: 1 }))).toBe(false)
    expect(ids(tasks)).toEqual([2])
    tasks.replaceAll([{ id: 5 }, { id: 6 }])
    expect(ids(tasks)).toEqual([5, 6])
    expect(() => tasks.replaceAll([{ id: 7 }, 'bad' as any])).toThrow(TypeError)
    expect(ids(tasks)).toEqual([5, 6])
    tasks.clear()
    expect(tasks).toHaveLength(0)
  })

  it('sort / reverse / fill / copyWithin work on an unsorted collection', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 3 }, { id: 1 }, { id: 2 }])
    tasks.sort((a, b) => a.id - b.id)
    expect(ids(tasks)).toEqual([1, 2, 3])
    tasks.reverse()
    expect(ids(tasks)).toEqual([3, 2, 1])
    tasks.copyWithin(0, 2)
    expect(ids(tasks)).toEqual([1, 2, 1])
    const same = Task.create({ id: 7 })
    tasks.fill(same, 1)
    expect(ids(tasks)).toEqual([1, 7, 7])
    expect(() => tasks.fill(5 as any)).toThrow(TypeError)
  })

  it('filter / slice / concat return collections of the same kind; map returns a plain array', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }, { id: 3 }])
    const evens = tasks.filter((t) => t.id % 2 === 1)
    expect(evens).toBeInstanceOf(ActiveCollection)
    expect(ids(evens)).toEqual([1, 3])
    expect(evens[0]).toBe(tasks[0])
    expect(isCollection(tasks.slice(1))).toBe(true)
    expect(ids(tasks.slice(1, 2))).toEqual([2])
    const joined = tasks.concat([Task.create({ id: 4 })], Task.create({ id: 5 }))
    expect(isCollection(joined)).toBe(true)
    expect(ids(joined)).toEqual([1, 2, 3, 4, 5])
    expect(() => tasks.concat([5 as any])).toThrow(TypeError)
    expect(isCollection(tasks.map((t) => t))).toBe(false)
  })

  it('clone() deep-copies the items and keeps the options', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 2 }, { id: 1 }], { sortBy: 'id', order: 'desc' })
    const copy = tasks.clone()
    expect(ids(copy)).toEqual([2, 1])
    expect(copy[0]).not.toBe(tasks[0])
    expect(copy.sorted).toBe(true)
    expect(copy.order).toBe('desc')
    copy[0].title = 'changed'
    expect(tasks[0].title).toBe('')
  })
})

describe('ActiveCollection: sorted', () => {
  it('keeps items in order on every way in, stably', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 3 }, { id: 1 }], { sortBy: 'id' })
    expect(tasks.sorted).toBe(true)
    tasks.push({ id: 2 }, { id: 0 })
    tasks.unshift({ id: 5 })
    tasks.splice(0, 0, { id: 4 })
    expect(ids(tasks)).toEqual([0, 1, 2, 3, 4, 5])

    const a = Task.create({ id: 1, title: 'first' })
    const b = Task.create({ id: 1, title: 'second' })
    const stable = ActiveCollection.create(Task, [a], { sortBy: 'id' })
    stable.push(b)
    expect(stable.map((t) => t.title)).toEqual(['first', 'second'])
  })

  it('sortBy accepts a function, order desc, and puts null/undefined last', () => {
    const byLength = ActiveCollection.create(Task, [{ title: 'ccc' }, { title: 'a' }, { title: 'bb' }], {
      sortBy: (t: Task) => t.title.length,
    })
    expect(byLength.map((t) => t.title)).toEqual(['a', 'bb', 'ccc'])

    const desc = ActiveCollection.create(Task, [{ id: 1 }, { id: 3 }, { id: 2 }], { sortBy: 'id', order: 'desc' })
    expect(ids(desc)).toEqual([3, 2, 1])

    const withNil = ActiveCollection.create(Task, [{ id: 1 }, { id: 2, priority: 5 }, { id: 3, priority: 1 }], { sortBy: 'priority' })
    expect(ids(withNil)).toEqual([3, 2, 1])
    const withNilDesc = ActiveCollection.create(Task, [{ id: 1 }, { id: 2, priority: 5 }, { id: 3, priority: 1 }], { sortBy: 'priority', order: 'desc' })
    expect(ids(withNilDesc)).toEqual([2, 3, 1])
  })

  it('compare defines a custom order and respects order desc', () => {
    const by = (a: Task, b: Task) => a.title.localeCompare(b.title)
    const asc = ActiveCollection.create(Task, [{ title: 'b' }, { title: 'a' }, { title: 'c' }], { compare: by })
    expect(asc.map((t) => t.title)).toEqual(['a', 'b', 'c'])
    const desc = ActiveCollection.create(Task, [{ title: 'b' }, { title: 'a' }], { compare: by, order: 'desc' })
    expect(desc.map((t) => t.title)).toEqual(['b', 'a'])
    desc.push({ title: 'c' })
    expect(desc.map((t) => t.title)).toEqual(['c', 'b', 'a'])
  })

  it('refuses what would break the order', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }], { sortBy: 'id' })
    expect(() => { tasks[0] = Task.create({ id: 9 }) }).toThrow(/sorted ActiveCollection cannot be assigned by index/)
    expect(() => tasks.fill(Task.create({ id: 1 }))).toThrow(/cannot be filled/)
    expect(() => tasks.copyWithin(0, 1)).toThrow(/cannot be rearranged/)
    expect(() => tasks.sort((a, b) => b.id - a.id)).toThrow(/another comparator/)
    expect(() => ActiveCollection.create(Task, [], { compare: () => 0 }).fill(Task.create({}))).toThrow(/defined by compare/)
    expect(ids(tasks)).toEqual([1, 2])
  })

  it('sort() re-sorts by its own order; reverse() flips the direction and stays sorted', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }, { id: 3 }], { sortBy: 'id' })
    tasks.reverse()
    expect(tasks.order).toBe('desc')
    expect(ids(tasks)).toEqual([3, 2, 1])
    tasks.push({ id: 4 })
    expect(ids(tasks)).toEqual([4, 3, 2, 1])
    tasks.reverse()
    expect(tasks.order).toBe('asc')
    expect(tasks.sort()).toBe(tasks)
    expect(ids(tasks)).toEqual([1, 2, 3, 4])
  })

  it('moves an item when its sort key changes', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }, { id: 3 }], { sortBy: 'id' })
    tasks[0].id = 10
    expect(ids(tasks)).toEqual([2, 3, 10])
    tasks[2].id = 0
    expect(ids(tasks)).toEqual([0, 2, 3])
    tasks[1].id = 2
    expect(ids(tasks)).toEqual([0, 2, 3])
  })

  it('keeps the order when the same instance sits in several slots', () => {
    const shared = Task.create({ id: 5 })
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, shared, { id: 9 }, shared], { sortBy: 'id' })
    shared.id = 0
    expect(ids(tasks)).toEqual([0, 0, 1, 9])
  })

  it('bisect, findByKey and range use binary search on the key', () => {
    const tasks = ActiveCollection.create(Task, [10, 20, 20, 30, 40].map((id) => ({ id })), { sortBy: 'id' })
    expect(tasks.bisectLeft(20)).toBe(1)
    expect(tasks.bisectRight(20)).toBe(3)
    expect(tasks.bisectLeft(5)).toBe(0)
    expect(tasks.bisectRight(99)).toBe(5)
    expect(tasks.findByKey(30)!.id).toBe(30)
    expect(tasks.findByKey(25)).toBeUndefined()
    expect(tasks.findByKey(99)).toBeUndefined()
    expect(tasks.range(20, 30).map((t) => t.id)).toEqual([20, 20, 30])
    expect(tasks.range(21, 29)).toEqual([])

    const desc = ActiveCollection.create(Task, [10, 20, 30, 40].map((id) => ({ id })), { sortBy: 'id', order: 'desc' })
    expect(desc.range(20, 30).map((t) => t.id)).toEqual([30, 20])
    expect(desc.findByKey(20)!.id).toBe(20)
  })

  it('bisect needs sortBy; an unsorted or compare-only collection refuses', () => {
    expect(() => ActiveCollection.create(Task).bisectLeft(1)).toThrow(/need a collection created with sortBy/)
    expect(() => ActiveCollection.create(Task, [], { compare: () => 0 }).range(1, 2)).toThrow(TypeError)
  })
})

describe('ActiveCollection: events', () => {
  it('emits itemsAdded / itemsRemoved / touched with the affected items', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }])
    const log: string[] = []
    tasks.on(EventType.itemsAdded, ({ items, index }) => log.push(`+${(items as Task[]).map((t) => t.id)}@${index}`))
    tasks.on(EventType.itemsRemoved, ({ items, index }) => log.push(`-${(items as Task[]).map((t) => t.id)}@${index}`))
    tasks.on(EventType.touched, ({ target }) => log.push(target === tasks ? 'touched' : 'other'))

    tasks.push({ id: 2 }, { id: 3 })
    tasks.shift()
    tasks.splice(0, 1, { id: 9 })
    expect(log).toEqual([
      '+2,3@1', 'touched',
      '-1@0', 'touched',
      '-2@0', 'touched', '+9@0', 'touched',
    ])
  })

  it('emits nothing for an empty push or a no-op removal', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }])
    let events = 0
    tasks.on(EventType.touched, () => { events++ })
    tasks.push()
    tasks.remove(Task.create({}))
    tasks.splice(0, 0)
    expect(events).toBe(0)
  })

  it('an item changing bubbles up as the collection touched, and unsubscribes when removed', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 2 }])
    let touched = 0
    tasks.on(EventType.touched, () => { touched++ })
    const [first] = tasks
    first.title = 'x'
    expect(touched).toBe(1)
    tasks.remove(first)
    expect(touched).toBe(2)
    first.title = 'y'
    expect(touched).toBe(2)
  })

  it('once() and the returned unsubscribe function work; static on() reaches every collection', () => {
    const tasks = ActiveCollection.create(Task)
    let once = 0
    let off = 0
    tasks.once(EventType.itemsAdded, () => { once++ })
    const unsubscribe = tasks.on(EventType.itemsAdded, () => { off++ })
    unsubscribe()
    tasks.push({ id: 1 })
    tasks.push({ id: 2 })
    expect(once).toBe(1)
    expect(off).toBe(0)

    class Tasks extends ActiveCollection<Task> {}
    let seen = 0
    Tasks.on(EventType.itemsAdded, () => { seen++ })
    Tasks.once(EventType.touched, () => { seen += 10 })
    Tasks.create(Task, [{ id: 1 }])
    Tasks.create(Task, [{ id: 2 }])
    expect(seen).toBe(12)
  })
})

describe('ActiveCollection on a model', () => {
  class Board extends ActiveModel {
    @ActiveField() name: string = ''
    @ActiveField({ container: ActiveCollection.field(Task, { sortBy: 'id' }) }) tasks!: ActiveCollection<Task>
    @ActiveField({ container: ActiveCollection.field(Task) }) backlog!: ActiveCollection<Task>
  }

  it('turns an array into a collection, defaults to an empty one, and treats null as empty', () => {
    const board = Board.create({ tasks: [{ id: 2 }, { id: 1 }] })
    expect(isCollection(board.tasks)).toBe(true)
    expect(ids(board.tasks)).toEqual([1, 2])
    expect(isCollection(board.backlog)).toBe(true)
    expect(board.backlog).toHaveLength(0)
    board.backlog = null as any
    expect(board.backlog).toHaveLength(0)
    board.backlog = [{ id: 7 }] as any
    expect(board.backlog[0]).toBeInstanceOf(Task)
    expect(() => { board.backlog = 5 as any }).toThrow('A collection of Task expects an array, got number')
    expect(() => { board.backlog = ['x'] as any }).toThrow(TypeError)
  })

  it('keeps a collection of the same model as is, and rebuilds a foreign one', () => {
    const board = Board.create({})
    const ready = ActiveCollection.create(Task, [{ id: 1 }], { sortBy: 'id' })
    board.tasks = ready
    expect(board.tasks).toBe(ready)
    expect(() => { board.tasks = ActiveCollection.create(Other, [{ id: 1 }]) as any }).toThrow(TypeError)
  })

  it('a change in the collection or in an item bubbles up as the board touched', () => {
    const board = Board.create({ tasks: [{ id: 1 }] })
    let touched = 0
    board.on(EventType.touched, () => { touched++ })
    board.tasks.push({ id: 2 })
    board.tasks[0].title = 'x'
    board.tasks.pop()
    expect(touched).toBe(3)
  })

  it('serializes to plain data, clones deeply and tracks changes', () => {
    const board = Board.create({ name: 'b', tasks: [{ id: 2 }, { id: 1 }] }, { tracked: true })
    expect(JSON.parse(JSON.stringify(board))).toEqual({
      name: 'b',
      tasks: [{ id: 1, title: '' }, { id: 2, title: '' }],
      backlog: [],
    })
    expect((board.toJSON() as any).tasks).toEqual([{ id: 1, title: '' }, { id: 2, title: '' }])

    expect(board.isTouched()).toBe(false)
    board.tasks.push({ id: 3 })
    expect(board.isTouched()).toBe(true)

    const copy = board.clone()
    expect(isCollection(copy.tasks)).toBe(true)
    expect(copy.tasks).not.toBe(board.tasks)
    expect(copy.tasks[0]).not.toBe(board.tasks[0])
    let touched = 0
    copy.on(EventType.touched, () => { touched++ })
    copy.tasks.push({ id: 4 })
    expect(touched).toBe(1)
    expect(board.tasks).toHaveLength(3)
  })

  it('a replaced collection stops notifying the model', () => {
    const board = Board.create({})
    const old = board.backlog
    board.backlog = [] as any
    let touched = 0
    board.on(EventType.touched, () => { touched++ })
    old.push({ id: 1 })
    expect(touched).toBe(0)
  })

  it('cannot combine factory and collection on one field', () => {
    expect(() => {
      class Bad extends ActiveModel {
        @ActiveField({ factory: Task, container: ActiveCollection.field(Task) }) x?: unknown
      }
      return Bad
    }).toThrow('use either factory or container')
  })

  it('an explicit default wins over the empty collection', () => {
    const seeded = ActiveCollection.create(Task, [{ id: 1 }])
    class Seeded extends ActiveModel {
      @ActiveField({ container: ActiveCollection.field(Task), value: () => seeded }) tasks!: ActiveCollection<Task>
    }
    expect(Seeded.create({}).tasks).toBe(seeded)
  })

  it('ActiveCollection.createFromData(Model) runs every item through create() with the factory options', () => {
    const source = [{ id: 2, title: 't' }, null, { id: 1 }]
    const tasks = ActiveCollection.createFromData(Task, source, { sortBy: 'id', tracked: true })
    expect(ids(tasks)).toEqual([1, 2])
    expect(tasks[1].isTouched()).toBe(false)
    expect(ActiveCollection.createFromData(Task).length).toBe(0)
  })
})

describe('ActiveCollection: bulk load', () => {
  it('a large batch into a sorted collection ends up sorted, stable, and merged with what was there', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ id: i * 10, title: 'old' }))
    const batch = Array.from({ length: 100 }, (_, i) => ({ id: (i * 7) % 50, title: 'new' }))
    const tasks = ActiveCollection.create(Task, existing, { sortBy: 'id' })
    tasks.push(...batch)

    const all = [...existing, ...batch]
    expect(ids(tasks)).toEqual(all.map((t) => t.id).sort((a, b) => a - b))
    expect(tasks).toHaveLength(105)
    // ties: the already-stored item stays before the newly added one
    const zeros = tasks.filter((t) => t.id === 0).map((t) => t.title)
    expect(zeros[0]).toBe('old')
  })

  it('reports the sorted position of the first batch item and emits once', () => {
    const tasks = ActiveCollection.create(Task, [{ id: 1 }, { id: 100 }], { sortBy: 'id' })
    const events: Array<number | undefined> = []
    tasks.on(EventType.itemsAdded, ({ index }) => events.push(index))
    tasks.push(...Array.from({ length: 40 }, (_, i) => ({ id: 50 + i })))
    expect(events).toEqual([1])
  })
})
