import { describe, expect, it, vi } from 'vitest'
import { ActiveModel } from '../src/ActiveModel'
import { ActiveField } from '../src/decorators'
import { EventType } from '../src/types'
import { ActiveCollection } from '../src/ActiveCollection'
import { ActiveMap } from '../src/ActiveMap'
import { ActiveSet } from '../src/ActiveSet'
import { ValidationError } from '../src/pipeline'
import { Decimal } from '../src/scalars/Decimal'
import { Money } from '../src/scalars/Money'
import { LocalDate } from '../src/scalars/LocalDate'
import { markImmutable } from '../src/scalars/immutable'
import { deepEqual } from '../src/equal'

class Item extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() title: string = ''
}

describe('Money errors and edges', () => {
  it('names the problem', () => {
    expect(() => Money.of(1, 'usd')).toThrow('3-letter uppercase ISO 4217 code, got "usd"')
    expect(() => Money.of(1, 5 as never)).toThrow('got 5')
    expect(() => Money.of('1.005', 'USD')).toThrow('USD has 2 minor unit digits, got 1.005')
    expect(() => Money.from(12)).toThrow('Cannot make Money from number')
    expect(() => Money.from({ amount: 1 })).toThrow('Cannot make Money from object')
    expect(() => Money.from('12.50')).toThrow('Not a money value')
    expect(Money.from('  12.50 usd  ').toString()).toBe('12.50 USD')
    expect(() => Money.of(1, 'USD').allocate([])).toThrow('at least one ratio')
    expect(() => Money.of(1, 'USD').allocate([0, 0])).toThrow('must not all be zero')
    expect(() => Money.of(1, 'USD').allocate([-1, 3])).toThrow('must not be negative')
    expect(() => Money.of(1, 'USD').allocate([3, -1])).toThrow('must not be negative')
  })

  it('lessThan / greaterThan are strict', () => {
    const one = Money.of(1, 'USD')
    expect(one.lessThan(Money.of(1, 'USD'))).toBe(false)
    expect(one.greaterThan(Money.of(1, 'USD'))).toBe(false)
    expect(one.lessThan(Money.of(2, 'USD'))).toBe(true)
    expect(Money.of(2, 'USD').greaterThan(one)).toBe(true)
    expect(Money.of(2, 'USD').lessThan(one)).toBe(false)
    expect(one.greaterThan(Money.of(2, 'USD'))).toBe(false)
  })
})

describe('Decimal edges', () => {
  const d = (v: string | number) => Decimal.from(v)

  it('reports bad input precisely', () => {
    expect(() => Decimal.from(NaN)).toThrow('Cannot make a Decimal from NaN')
    expect(() => Decimal.from(-Infinity)).toThrow('Cannot make a Decimal from -Infinity')
    expect(() => d('1e1001')).toThrow('Exponent out of range: 1001')
    expect(() => d('1e-1001')).toThrow('Exponent out of range')
    expect(d('1e1000').toString().length).toBe(1001)
    expect(d('1e-1000').scale).toBe(1000)
    expect(() => d(1).divide(3, 2000)).toThrow('Scale must be an integer >= 0 (at most 1000), got 2000')
    expect(() => d(1).divide(3, 1001)).toThrow(RangeError)
    expect(d(1).divide(3, 1000).scale).toBe(1000)
    expect(() => d(1).round(1001)).toThrow('Scale must be an integer (at most 1000)')
    expect(() => d(1).round(-1001)).toThrow(RangeError)
    expect(() => d(1).round(0.5)).toThrow(RangeError)
    expect(() => d(1).toFixed(-1)).toThrow('>= 0')
    expect(() => d(1).divide(0)).toThrow('Division by zero')
  })

  it('round() returns the very same value when nothing is dropped', () => {
    const x = d('1.25')
    expect(x.round(2)).toBe(x)
    expect(x.round(5)).toBe(x)
    expect(x.round(1)).not.toBe(x)
  })

  it('equals / lessThanOrEqual distinguish', () => {
    expect(d(1).equals(2)).toBe(false)
    expect(d(2).lessThanOrEqual(1)).toBe(false)
    expect(d(1).lessThanOrEqual(2)).toBe(true)
    expect(d(1).lessThan(1)).toBe(false)
  })

  it('converts by hint', () => {
    const x = d('0.1234567890123456789') as unknown as Record<symbol, (hint: string) => unknown>
    expect(x[Symbol.toPrimitive]('number')).toBe(0.12345678901234568)
    expect(x[Symbol.toPrimitive]('string')).toBe('0.1234567890123456789')
    expect(x[Symbol.toPrimitive]('default')).toBe('0.1234567890123456789')
  })

  it('works at the scale limit and drops trailing zeros of tiny numbers', () => {
    expect(d('0.000').isZero()).toBe(true)
    expect(d('10').scale).toBe(0)
    expect(d('0.10').scale).toBe(1)
  })
})

describe('LocalDate edges', () => {
  it('accepts the extreme years and says what is wrong', () => {
    expect(LocalDate.of(0, 1, 1).year).toBe(0)
    expect(LocalDate.of(9999, 12, 31).toString()).toBe('9999-12-31')
    expect(() => LocalDate.of(2026, 2, 30)).toThrow('Not a calendar date: 2026-2-30')
    expect(() => LocalDate.from('2026-2-3')).toThrow('Not an ISO date (YYYY-MM-DD): "2026-2-3"')
    expect(() => LocalDate.from(5)).toThrow('Cannot make a LocalDate from number')
  })

  it('compares strictly', () => {
    const a = LocalDate.of(2026, 1, 1)
    expect(a.equals(LocalDate.of(2026, 1, 2))).toBe(false)
    expect(a.isBefore(a)).toBe(false)
    expect(a.isAfter(a)).toBe(false)
    expect(LocalDate.of(2026, 1, 2).isBefore(a)).toBe(false)
    expect(a.isAfter(LocalDate.of(2026, 1, 2))).toBe(false)
  })
})

describe('deepEqual', () => {
  it('handles primitives, null and NaN', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual('a', 'a')).toBe(true)
    expect(deepEqual(0, '')).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual({}, null)).toBe(false)
    expect(deepEqual(undefined, undefined)).toBe(true)
    expect(deepEqual(NaN, NaN)).toBe(true)
    expect(deepEqual(NaN, 1)).toBe(false)
    expect(deepEqual(1, NaN)).toBe(false)
    expect(deepEqual({}, 1)).toBe(false)
    expect(deepEqual(1, {})).toBe(false)
    expect(deepEqual({ a: 1 }, 'a')).toBe(false)
    expect(deepEqual('a', { a: 1 })).toBe(false)
    expect(deepEqual(0, null)).toBe(false)
  })

  it('handles arrays', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
    expect(deepEqual([1, 2], [1, 3])).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]])).toBe(true)
    expect(deepEqual([], {})).toBe(false)
  })

  it('handles maps and sets', () => {
    expect(deepEqual(new Map([[1, 1]]), new Map([[1, 1]]))).toBe(true)
    expect(deepEqual(new Map([[1, 1]]), new Map([[2, 1]]))).toBe(false)
    expect(deepEqual(new Map([[1, { a: 1 }]]), new Map([[1, { a: 2 }]]))).toBe(false)
    expect(deepEqual(new Map([[1, 1]]), new Map([[1, 1], [2, 2]]))).toBe(false)
    expect(deepEqual(new Set([1, 2]), new Set([1, 2]))).toBe(true)
    expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false)
    expect(deepEqual(new Set([1]), new Set([1, 2]))).toBe(false)
    expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 1 }]))).toBe(true)
    expect(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]))).toBe(false)
    expect(deepEqual(new Map(), new Set())).toBe(false)
    const shared = { a: 1 }
    expect(deepEqual(new Set([shared, { b: 2 }]), new Set([shared, { b: 2 }]))).toBe(true)
  })

  it('handles typed arrays, regexps, dates and objects', () => {
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false)
    expect(deepEqual(new Uint8Array([1]), new Float32Array([1]))).toBe(false)
    expect(deepEqual(/a/g, /a/g)).toBe(true)
    expect(deepEqual(/a/g, /a/i)).toBe(false)
    expect(deepEqual(/a/, /b/)).toBe(false)
    expect(deepEqual(new Date(1), new Date(1))).toBe(true)
    expect(deepEqual(new Date(1), new Date(2))).toBe(false)
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
    expect(deepEqual({ a: { b: [1] } }, { a: { b: [2] } })).toBe(false)
    expect(deepEqual(new (class A {})(), new (class B {})())).toBe(false)
    expect(deepEqual({ toString: () => 'x' }, { toString: () => 'x' })).toBe(true)
  })
})

describe('history groups', () => {
  class Doc extends ActiveModel {
    @ActiveField() title: string = 'A'
    @ActiveField() body: string = ''
  }

  it('an empty transaction records nothing', () => {
    const doc = Doc.create({}, { history: true })
    doc.transaction(() => undefined)
    expect(doc.canUndo()).toBe(false)
  })

  it('nested transactions are one step; a failed inner one leaves the outer usable', () => {
    const doc = Doc.create({}, { history: true })
    doc.transaction((d) => {
      d.title = 'X'
      try {
        d.transaction((inner) => {
          inner.body = 'Y'
          throw new Error('inner')
        })
      } catch { /* the outer transaction goes on */ }
    })
    expect(doc.title).toBe('X')
    expect(doc.body).toBe('')
    doc.title = 'Z'
    doc.undo()
    expect(doc.title).toBe('X')
    doc.undo()
    expect(doc.title).toBe('A')
    expect(doc.canUndo()).toBe(false)
  })

  it('nested successful transactions commit once, at the outermost level', () => {
    const doc = Doc.create({}, { history: true })
    doc.transaction((d) => {
      d.title = 'X'
      d.transaction((inner) => { inner.body = 'Y' })
      d.title = 'W'
    })
    doc.undo()
    expect([doc.title, doc.body]).toEqual(['A', ''])
    expect(doc.canUndo()).toBe(false)
  })

  it('a transaction on a model without history still works', () => {
    const doc = Doc.create({})
    doc.transaction((d) => { d.title = 'Q' })
    expect(doc.title).toBe('Q')
    expect(() => doc.transaction(() => { throw new Error('x') })).toThrow('x')
  })
})

describe('ActiveMap re-keying and events', () => {
  const make = () => ActiveMap.create(Item, { key: 'id' }, [{ id: 1, title: 'a' }, { id: 2, title: 'b' }])

  it('moves an item when its key changes and drops the one it displaces', () => {
    const map = make()
    const removed = vi.fn()
    const touched = vi.fn()
    map.on(EventType.itemsRemoved, removed)
    map.on(EventType.touched, touched)
    const first = map.get(1)!
    const second = map.get(2)!
    first.id = 5
    expect(map.has(1)).toBe(false)
    expect(map.get(5)).toBe(first)
    expect(removed).not.toHaveBeenCalled()
    expect(touched).toHaveBeenCalledTimes(1)
    first.id = 2
    expect(map.get(2)).toBe(first)
    expect(map.size).toBe(1)
    expect(removed).toHaveBeenCalledTimes(1)
    expect(removed.mock.calls[0][0]).toMatchObject({ target: map, items: [second], keys: [2] })
    touched.mockClear()
    second.title = 'ignored'
    expect(touched).not.toHaveBeenCalled()
    first.title = 'seen'
    expect(touched).toHaveBeenCalledTimes(1)
    expect(touched.mock.calls[0][0].target).toBe(map)
  })

  it('an unrelated change keeps the key and still bubbles', () => {
    const map = make()
    const touched = vi.fn()
    map.on(EventType.touched, touched)
    const item = map.get(1)!
    item.title = 'z'
    expect(map.get(1)).toBe(item)
    expect(touched).toHaveBeenCalledTimes(1)
  })

  it('once() fires a single time', () => {
    const map = make()
    const cb = vi.fn()
    map.once(EventType.itemsAdded, cb)
    map.add({ id: 3 }, { id: 4 })
    map.add({ id: 5 })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('validates its arguments', () => {
    const map = make()
    expect(() => map.add({ title: 'no key' } as never)).not.toThrow()
    expect(() => ActiveMap.prototype.add.call({} as never)).toThrow('Not an ActiveMap: create it with ActiveMap.create()')
    expect(() => map.set(7, { id: 8 } as never)).toThrow('key mismatch: stored under 7 but the item\'s key is 8')
    expect(() => ActiveMap.create(class Plain {} as never, { key: 'id' } as never)).toThrow('ActiveMap.create() needs a class extending ActiveModel')
  })

  it('reports the missing key by value', () => {
    const map = ActiveMap.create(Item, { key: 'title' })
    expect(() => map.add({ id: 1, title: null } as never)).toThrow('needs a key for every item, got null')
    expect(() => map.add({ id: 1, title: undefined } as never)).toThrow('got undefined')
    expect(map.size).toBe(0)
  })

  it('clear() detaches every item and reports keys; clearing an empty map is silent', () => {
    const map = make()
    const removed = vi.fn()
    const touched = vi.fn()
    map.on(EventType.itemsRemoved, removed)
    map.on(EventType.touched, touched)
    const a = map.get(1)!
    map.clear()
    expect(removed.mock.calls[0][0]).toMatchObject({ target: map, keys: [1, 2] })
    expect(removed.mock.calls[0][0].items).toHaveLength(2)
    expect(touched).toHaveBeenCalledTimes(1)
    expect(touched.mock.calls[0][0].target).toBe(map)
    a.title = 'gone'
    expect(touched).toHaveBeenCalledTimes(1)
    removed.mockClear()
    map.clear()
    expect(removed).not.toHaveBeenCalled()
    expect(touched).toHaveBeenCalledTimes(1)
  })

  it('delete() detaches the item and emits both events with the target', () => {
    const map = make()
    const removed = vi.fn()
    const touched = vi.fn()
    map.on(EventType.itemsRemoved, removed)
    map.on(EventType.touched, touched)
    const item = map.get(1)!
    expect(map.delete(1)).toBe(true)
    expect(map.delete(1)).toBe(false)
    expect(removed.mock.calls[0][0]).toMatchObject({ target: map, items: [item], keys: [1] })
    expect(touched.mock.calls[0][0].target).toBe(map)
    touched.mockClear()
    item.title = 'x'
    expect(touched).not.toHaveBeenCalled()
  })

  it('replacing an item under the same key detaches the old one', () => {
    const map = make()
    const removed = vi.fn()
    map.on(EventType.itemsRemoved, removed)
    const old = map.get(1)!
    map.add({ id: 1, title: 'new' })
    expect(map.get(1)).not.toBe(old)
    expect(removed.mock.calls[0][0]).toMatchObject({ items: [old], keys: [1] })
    const touched = vi.fn()
    map.on(EventType.touched, touched)
    old.title = 'stale'
    expect(touched).not.toHaveBeenCalled()
  })
})

describe('ActiveSet unique keys and events', () => {
  const make = () => ActiveSet.create(Item, [{ id: 1 }, { id: 2 }], { unique: 'id' })

  it('reports duplicate keys with an empty path', () => {
    const set = make()
    try {
      set.add({ id: 1 })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).issues[0]).toMatchObject({ path: '', code: 'unique', value: 1 })
      expect((error as ValidationError).message).toContain('Duplicate key 1 in ActiveSet<Item>')
    }
    expect(() => set.addAll([{ id: 9 }, { id: 9 }])).toThrow(ValidationError)
    expect(set.size).toBe(2)
  })

  it('follows a changed key and frees the old one', () => {
    const set = make()
    const [first] = Array.from(set)
    first.id = 10
    expect(() => set.add({ id: 1 })).not.toThrow()
    expect(() => set.add({ id: 10 })).toThrow(ValidationError)
  })

  it('does not steal a key another item holds', () => {
    const set = make()
    const [first, second] = Array.from(set)
    first.id = 2
    expect(() => set.add({ id: 1 })).not.toThrow()
    second.id = 3
    expect(() => set.add({ id: 3 })).toThrow(ValidationError)
  })

  it('emits touched with the set as target, delete() answers true, clear() detaches', () => {
    const set = make()
    const touched = vi.fn()
    const removed = vi.fn()
    set.on(EventType.touched, touched)
    set.on(EventType.itemsRemoved, removed)
    const [first, second] = Array.from(set)
    first.title = 'x'
    expect(touched.mock.calls[0][0].target).toBe(set)
    touched.mockClear()
    expect(set.delete(first)).toBe(true)
    expect(set.delete(first)).toBe(false)
    expect(touched.mock.calls[0][0].target).toBe(set)
    touched.mockClear()
    set.clear()
    expect(touched.mock.calls[0][0].target).toBe(set)
    touched.mockClear()
    second.title = 'gone'
    expect(touched).not.toHaveBeenCalled()
    expect(() => set.add({ id: 2 })).not.toThrow()
  })

  it('once() fires a single time', () => {
    const set = make()
    const cb = vi.fn()
    set.once(EventType.itemsAdded, cb)
    set.add({ id: 3 })
    set.add({ id: 4 })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('rejects a class that is not a model', () => {
    expect(() => ActiveSet.create(class Plain {} as never)).toThrow('ActiveSet.create() needs a class extending ActiveModel')
  })
})

describe('pipeline details', () => {
  it('checks runtime types strictly', () => {
    class T extends ActiveModel {
      @ActiveField({ type: 'number' }) n?: unknown
      @ActiveField({ type: 'object' }) o?: unknown
      @ActiveField({ type: 'array' }) a?: unknown
      @ActiveField({ type: 'boolean' }) b?: unknown
      @ActiveField({ type: 'date' }) d?: unknown
      @ActiveField({ type: 'string' }) s?: unknown
      @ActiveField({ type: 'integer' }) i?: unknown
    }
    const t = T.create({})
    const bad = (prop: string, value: unknown) => expect(() => { (t as any)[prop] = value }, `${prop}=${String(value)}`).toThrow(ValidationError)
    const ok = (prop: string, value: unknown) => expect(() => { (t as any)[prop] = value }, `${prop}=${String(value)}`).not.toThrow()
    bad('n', NaN); bad('n', '1'); ok('n', 1)
    bad('o', 'x'); bad('o', [1]); bad('o', 5); ok('o', { a: 1 })
    bad('a', {}); ok('a', [1])
    bad('b', 'true'); ok('b', false)
    bad('d', 'x'); bad('d', new Date('nope')); ok('d', new Date())
    bad('s', 1); ok('s', 'x')
    bad('i', 1.5); ok('i', 2)
  })

  it('describes offending strings quoted and bounds by ISO date', () => {
    class T extends ActiveModel {
      @ActiveField({ type: 'number' }) n?: unknown
      @ActiveField({ min: new Date('2020-01-01T00:00:00.000Z') }) d?: Date
      @ActiveField({ maxLength: 2 }) s?: string
      @ActiveField({ pattern: /a/g }) p?: string
      @ActiveField({ oneOf: [0, 1, 2] }) e?: number
      @ActiveField({ coerce: 'number' }) c?: unknown
      @ActiveField({ coerce: 'boolean' }) f?: unknown
      @ActiveField({ transitions: { a: ['b'] } }) st: string = 'a'
    }
    const t = T.create({})
    expect(() => { t.n = 'abc' }).toThrow('got "abc"')
    expect(() => { t.d = new Date('2019-01-01') }).toThrow('at least "2020-01-01T00:00:00.000Z"')
    expect(() => { t.s = 'abc' }).toThrow('at most 2 characters/items, has 3')
    t.p = 'a'
    expect(() => { t.p = 'ab' }).not.toThrow()
    t.e = 1
    expect(t.e).toBe(1)
    expect(() => { t.c = '   ' }).toThrow('cannot be converted to number')
    t.f = 1 as never
    expect(t.f).toBe(true)
    t.f = '0' as never
    expect(t.f).toBe(false)
    expect(t.allowedTransitions('st')).toEqual(['b'])
  })

  it('keeps an existing value-class instance as it is', () => {
    class Percent {
      private constructor (readonly value: number) { Object.freeze(this) }
      static from (x: unknown) {
        if (typeof x !== 'number') throw new TypeError('number only')
        return new Percent(x)
      }
    }
    markImmutable(Percent)
    class Box extends ActiveModel {
      @ActiveField({ coerce: Percent }) p?: Percent
    }
    const box = Box.create({})
    const value = Percent.from(5)
    box.p = value
    expect(box.p).toBe(value)
    expect(() => { box.p = 'x' as never }).toThrow(ValidationError)
  })

  it('uppercase and lowercase normalizers apply only when asked', () => {
    class T extends ActiveModel {
      @ActiveField({ uppercase: true }) up: string = ''
      @ActiveField({ lowercase: true }) low: string = ''
      @ActiveField({ transform: (v) => v }) plain: string = ''
    }
    const t = T.create({})
    t.up = ' aB '
    t.low = ' aB '
    t.plain = ' aB '
    expect([t.up, t.low, t.plain]).toEqual([' AB ', ' ab ', ' aB '])
  })
})

describe('decorator options applied inside a test (so the mutants are active)', () => {
  it('map and set field options build containers, with defaults', () => {
    class Holder extends ActiveModel {
      @ActiveField({ container: ActiveMap.field(Item, { key: 'id' }) }) byId!: ActiveMap<Item>
      @ActiveField({ container: ActiveSet.field(Item, { unique: 'id' }) }) uniq!: ActiveSet<Item>
      @ActiveField({ container: ActiveCollection.field(Item, { sortBy: 'id' }) }) list!: Item[]
    }
    const holder = Holder.create({})
    expect(holder.byId).toBeInstanceOf(ActiveMap)
    expect(holder.uniq).toBeInstanceOf(ActiveSet)
    expect(Array.isArray(holder.list)).toBe(true)
    const other = Holder.create({})
    expect(other.byId).not.toBe(holder.byId)
    holder.byId = { 1: { id: 1 } } as never
    expect(holder.byId).toBeInstanceOf(ActiveMap)
    expect(holder.byId.get(1)).toBeInstanceOf(Item)
    holder.uniq = [{ id: 1 }] as never
    expect(holder.uniq).toBeInstanceOf(ActiveSet)
    expect(holder.uniq.size).toBe(1)
  })

  it('a container field with its own default keeps it', () => {
    class Holder extends ActiveModel {
      @ActiveField({ container: ActiveMap.field(Item, { key: 'id' }), value: () => ActiveMap.create(Item, { key: 'id' }, [{ id: 9 }]) }) byId!: ActiveMap<Item>
    }
    expect(Holder.create({}).byId.has(9)).toBe(true)
  })

  it('refuses a container or factory whose model is not an ActiveModel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    class Plain {}
    expect(() => {
      class A extends ActiveModel {
        @ActiveField({ container: ActiveMap.field(Plain as never, { key: 'id' } as never) }) m?: unknown
      }
      return A
    }).toThrow('Model factory for prop "m" must be instanceof ActiveModel!')
    expect(() => {
      class B extends ActiveModel {
        @ActiveField({ factory: Plain as never }) f?: unknown
      }
      return B
    }).toThrow('must be instanceof ActiveModel')
    expect(warn).toHaveBeenCalledWith('Model factory for prop "m" must be instanceof ActiveModel!', Plain)
    warn.mockRestore()
  })

  it('transform accepts a function or a list, in order, after trim', () => {
    class T extends ActiveModel {
      @ActiveField({ transform: (v) => `<${String(v)}>` }) one: string = ''
      @ActiveField({ trim: true, transform: [(v) => `${String(v)}1`, (v) => `${String(v)}2`] }) many: string = ''
    }
    const t = T.create({})
    t.one = 'x'
    t.many = ' y '
    expect([t.one, t.many]).toEqual(['<x>', 'y12'])
  })

  it('a bare value is shorthand for the default', () => {
    class T extends ActiveModel {
      @ActiveField(5 as never) n?: number
      @ActiveField(null as never) z?: unknown
    }
    const t = T.create({})
    expect(t.n).toBe(5)
    expect(t.z).toBeUndefined()
  })

  it('a setter option works on its own', () => {
    class T extends ActiveModel {
      @ActiveField({ setter: (m, p, v, r) => Reflect.set(m, p, String(v).toUpperCase(), r) }) s: string = ''
    }
    const t = T.create({})
    t.s = 'abc'
    expect(t.s).toBe('ABC')
  })
})
