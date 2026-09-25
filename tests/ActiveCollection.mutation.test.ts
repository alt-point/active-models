import { describe, it, expect } from 'vitest'
import { ActiveModel, ActiveField, ActiveCollection, EventType } from '../src'

/** Written from surviving mutants of the Stryker run on ActiveCollection: each test pins one detail. */

class Task extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() title: string = ''
  @ActiveField() priority?: number
}
const ids = (c: Iterable<Task>) => Array.from(c, (t) => t.id)
const make = (...list: number[]) => Task.collection(list.map((id) => ({ id })))

describe('splice shifting', () => {
  it('grows, shrinks and keeps length in the middle and at the ends', () => {
    const tasks = make(1, 2, 3, 4)
    tasks.splice(1, 0, { id: 10 }, { id: 11 }, { id: 12 })
    expect(ids(tasks)).toEqual([1, 10, 11, 12, 2, 3, 4])
    tasks.splice(1, 3, { id: 20 })
    expect(ids(tasks)).toEqual([1, 20, 2, 3, 4])
    tasks.splice(1, 1, { id: 30 })
    expect(ids(tasks)).toEqual([1, 30, 2, 3, 4])
    expect(tasks).toHaveLength(5)
    tasks.splice(5, 0, { id: 40 }, { id: 41 })
    expect(ids(tasks)).toEqual([1, 30, 2, 3, 4, 40, 41])
    tasks.splice(0, 2)
    expect(ids(tasks)).toEqual([2, 3, 4, 40, 41])
    tasks.splice(3, 2)
    expect(ids(tasks)).toEqual([2, 3, 4])
    expect(tasks).toHaveLength(3)
  })

  it('remove() of something that is not there (even undefined) returns false', () => {
    const tasks = make(1)
    expect(tasks.remove(undefined as any)).toBe(false)
    expect(tasks.remove(Task.create({ id: 1 }))).toBe(false)
    expect(tasks).toHaveLength(1)
  })
})

describe('property names', () => {
  it('only canonical array indexes are indexes; other string keys are refused', () => {
    const tasks = make(1)
    for (const key of ['01', '-1', '1.5', '1a', 'a1', '4294967295', ' 0', '0 ']) {
      expect(() => { (tasks as any)[key] = { id: 9 } }).toThrow(`cannot set property "${key}"`)
    }
    expect(() => { (tasks as any)['4294967294'] = { id: 9 } }).toThrow(RangeError)
    expect(ids(tasks)).toEqual([1])
  })

  it('deleting an index throws, deleting a non-index property does not', () => {
    const tasks = make(1)
    expect(() => { delete (tasks as any)[0] }).toThrow(/holes/)
    expect(delete (tasks as any).notThere).toBe(true)
    expect(delete (tasks as any)[Symbol.for('x')]).toBe(true)
  })

  it('defineProperty: length and index with a value are handled, accessors and stray names refused', () => {
    const tasks = make(1, 2, 3)
    Object.defineProperty(tasks, 'length', { value: 2 })
    expect(ids(tasks)).toEqual([1, 2])
    Object.defineProperty(tasks, '0', { value: Task.create({ id: 7 }) })
    expect(ids(tasks)).toEqual([7, 2])
    expect(() => Object.defineProperty(tasks, '0', { get: () => 1 })).toThrow('cannot define property "0"')
    expect(() => Object.defineProperty(tasks, 'x', { value: 1 })).toThrow('cannot define property "x"')
    Object.defineProperty(tasks, Symbol.for('meta'), { value: 1 })
    expect((tasks as any)[Symbol.for('meta')]).toBe(1)
  })

  it('setting length to the current length is a no-op; growing it names the reason', () => {
    const tasks = make(1, 2)
    tasks.length = 2
    expect(ids(tasks)).toEqual([1, 2])
    expect(() => { tasks.length = 3 }).toThrow('cannot be grown by setting length')
    expect(() => { (tasks as any)[9] = { id: 1 } }).toThrow('index 9 is beyond length 2')
  })
})

describe('error messages describe what was refused', () => {
  it.each([
    [null, 'got null'],
    [undefined, 'got undefined'],
    [true, 'got boolean'],
    [[1], 'got Array'],
    [new Date(), 'got Date'],
    [Object.create(Object.create(null)), 'got object'],
  ])('%s', (value, message) => {
    expect(() => make().push(value as any)).toThrow(message)
  })

  it('a prototype-less object counts as plain data', () => {
    const data = Object.assign(Object.create(null), { id: 4 })
    expect(ids(make().add(data))).toEqual([4])
  })

  it('methods refuse a receiver that is not a collection', () => {
    expect(() => ActiveCollection.prototype.push.call([], { id: 1 })).toThrow('Not an ActiveCollection')
  })

  it('create() needs a model class and works without initial items', () => {
    expect(() => ActiveCollection.create(ActiveModel)).toThrow('needs a class extending ActiveModel')
    expect(ActiveCollection.create(Task)).toHaveLength(0)
  })

  it('a sorted refusal names sortBy or compare', () => {
    expect(() => { Task.collection([], { sortBy: 'id' }).fill(Task.create({})) }).toThrow('defined by sortBy')
    expect(() => { Task.collection([], { compare: () => 0 }).copyWithin(0, 0) }).toThrow('defined by compare')
  })
})

describe('sorting details', () => {
  const priorities = (c: Iterable<Task>) => Array.from(c, (t) => `${t.id}:${t.priority ?? '-'}`)

  it('null/undefined keys sort last, keep insertion order, and never move ahead of real keys', () => {
    const list = [{ id: 1 }, { id: 2, priority: 2 }, { id: 3 }, { id: 4, priority: 1 }]
    for (const order of ['asc', 'desc'] as const) {
      const tasks = Task.collection(list, { sortBy: 'priority', order })
      const expected = order === 'asc' ? ['4:1', '2:2', '1:-', '3:-'] : ['2:2', '4:1', '1:-', '3:-']
      expect(priorities(tasks)).toEqual(expected)
      tasks.push({ id: 5 })
      tasks.push({ id: 6, priority: 3 })
      expect(priorities(tasks).slice(-3)).toEqual(['1:-', '3:-', '5:-'])
      expect(Math.max(...tasks.map((t) => t.priority ?? -1))).toBe(3)
    }
  })

  it('the bulk path (many items) orders exactly like one-by-one inserts, for keys and for compare', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: (i * 37) % 11, title: String(i) }))
    const byKey = Task.collection(many, { sortBy: 'id' })
    const oneByOne = Task.collection([], { sortBy: 'id' })
    for (const item of many) oneByOne.push(item)
    expect(byKey.map((t) => t.title)).toEqual(oneByOne.map((t) => t.title))

    const byCompare = Task.collection(many, { compare: (a, b) => a.id - b.id })
    expect(byCompare.map((t) => t.title)).toEqual(oneByOne.map((t) => t.title))
  })

  it('a custom compare is re-evaluated by sort()', () => {
    let direction = 1
    const tasks = Task.collection([{ id: 1 }, { id: 2 }, { id: 3 }], { compare: (a, b) => direction * (a.id - b.id) })
    expect(ids(tasks)).toEqual([1, 2, 3])
    direction = -1
    tasks.sort()
    expect(ids(tasks)).toEqual([3, 2, 1])
  })

  it('reverse() leaves an unsorted collection\'s direction alone', () => {
    const tasks = make(1, 2, 3)
    tasks.reverse()
    expect(tasks.order).toBe('asc')
    expect(tasks.sorted).toBe(false)
    expect(ids(tasks)).toEqual([3, 2, 1])
  })

  it('a key change that only ties with a neighbour does not move the item', () => {
    const [a, b, c] = [Task.create({ id: 1 }), Task.create({ id: 2 }), Task.create({ id: 3 })]
    const tasks = Task.collection([a, b, c], { sortBy: 'id' })
    b.id = 1
    expect(tasks.map((t) => t)).toEqual([a, b, c])
    a.id = 1
    b.id = 3
    expect(tasks.map((t) => t)).toEqual([a, c, b].sort((x, y) => x.id - y.id))
    c.id = 3
    expect(ids(tasks)).toEqual([1, 3, 3])
  })

  it('an item that violates the order only on one side is still moved', () => {
    const [a, b, c, d] = [1, 2, 3, 4].map((id) => Task.create({ id }))
    const tasks = Task.collection([a, b, c, d], { sortBy: 'id' })
    a.id = 2.5
    expect(ids(tasks)).toEqual([2, 2.5, 3, 4])
    d.id = 2.7
    expect(ids(tasks)).toEqual([2, 2.5, 2.7, 3])
    c.id = 0
    expect(ids(tasks)).toEqual([0, 2, 2.5, 2.7])
  })
})

describe('subscriptions to items', () => {
  const countTouched = (c: ActiveCollection<Task>) => {
    const seen = { n: 0 }
    c.on(EventType.touched, () => { seen.n++ })
    return seen
  }

  it('an instance held twice keeps notifying until its last slot is gone', () => {
    const shared = Task.create({ id: 1 })
    const tasks = Task.collection([shared, shared])
    const seen = countTouched(tasks)
    shared.title = 'a'
    expect(seen.n).toBe(1)
    tasks.pop()
    expect(seen.n).toBe(2)
    shared.title = 'b'
    expect(seen.n).toBe(3)
    tasks.pop()
    expect(seen.n).toBe(4)
    shared.title = 'c'
    expect(seen.n).toBe(4)
  })

  it('replacing by index swaps the subscription and reports what left and what came', () => {
    const tasks = make(1, 2)
    const old = tasks[0]
    const fresh = Task.create({ id: 9 })
    const events: string[] = []
    tasks.on(EventType.itemsRemoved, ({ items, index }) => events.push(`-${(items as Task[])[0].id}@${index}`))
    tasks.on(EventType.itemsAdded, ({ items, index }) => events.push(`+${(items as Task[])[0].id}@${index}`))
    tasks[0] = fresh
    expect(events).toEqual(['-1@0', '+9@0'])

    const seen = countTouched(tasks)
    old.title = 'ignored'
    expect(seen.n).toBe(0)
    fresh.title = 'heard'
    expect(seen.n).toBe(1)
  })

  it('appending by index only adds - nothing is reported as removed', () => {
    const tasks = make(1)
    const events: string[] = []
    tasks.on(EventType.itemsRemoved, () => events.push('removed'))
    tasks.on(EventType.itemsAdded, ({ index }) => events.push(`added@${index}`))
    tasks[1] = { id: 2 } as any
    expect(events).toEqual(['added@1'])
  })

  it('fill() and copyWithin() re-point subscriptions to the items that are now inside', () => {
    const [a, b, c] = [1, 2, 3].map((id) => Task.create({ id }))
    const tasks = Task.collection([a, b, c])
    const seen = countTouched(tasks)
    const replacement = Task.create({ id: 9 })
    tasks.fill(replacement, 0, 2)
    expect(tasks.map((t) => t)).toEqual([replacement, replacement, c])
    a.title = 'gone'
    b.title = 'gone'
    expect(seen.n).toBe(1)
    replacement.title = 'in'
    expect(seen.n).toBe(2)

    const [x, y, z] = [1, 2, 3].map((id) => Task.create({ id }))
    const list = Task.collection([x, y, z])
    const moves = countTouched(list)
    list.copyWithin(0, 2)
    expect(list.map((t) => t)).toEqual([z, y, z])
    x.title = 'gone'
    expect(moves.n).toBe(1)
    z.title = 'in'
    expect(moves.n).toBe(2)
  })
})

describe('touched targets', () => {
  it('every operation reports the collection itself as the target', () => {
    const tasks = Task.collection([{ id: 2 }, { id: 1 }])
    const targets: unknown[] = []
    tasks.on(EventType.touched, ({ target }) => targets.push(target))

    const first = tasks[0]
    first.title = 'x'
    tasks.push({ id: 3 })
    tasks.sort((a, b) => a.id - b.id)
    tasks.reverse()
    tasks.fill(first, 0, 1)
    tasks.copyWithin(1, 0, 1)
    tasks[0] = Task.create({ id: 8 })
    tasks.pop()

    expect(targets.length).toBeGreaterThanOrEqual(8)
    expect(targets.every((target) => target === tasks)).toBe(true)
  })

  it('sorting and reverse announce themselves as changes', () => {
    const tasks = make(2, 1)
    let touched = 0
    tasks.on(EventType.touched, () => { touched++ })
    tasks.sort((a, b) => a.id - b.id)
    tasks.reverse()
    expect(touched).toBe(2)
  })
})
