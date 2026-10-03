import { describe, expect, it } from 'vitest'
import lodashCloneDeep from 'lodash-es/cloneDeep'
import lodashCloneDeepWith from 'lodash-es/cloneDeepWith'
import { cloneDeep, cloneDeepWith } from '../src/clone'
import { deepEqual } from '../src/equal'

class Point {
  constructor (public x = 0, public y = 0) {}
}
class Bag extends Map<string, unknown> {}

const sym = Symbol('s')

const samples = (): Record<string, unknown> => {
  const shared = { n: 1 }
  const cyclic: Record<string, unknown> = { name: 'loop' }
  cyclic.self = cyclic
  cyclic.list = [cyclic, shared, shared]
  return {
    primitives: [1, 'a', true, null, undefined, '10', NaN],
    plain: { a: 1, b: { c: [1, 2, { d: 3 }] } },
    array: [1, [2, [3, [4]]], { a: 1 }],
    sparse: [1, , 3], // eslint-disable-line no-sparse-arrays
    date: new Date(1700000000000),
    regexp: Object.assign(/a(b)c/gi, { lastIndex: 3 }),
    map: new Map<unknown, unknown>([['a', { x: 1 }], [{ k: 1 }, [1, 2]]]),
    set: new Set<unknown>([1, { x: 1 }, [2]]),
    bag: new Bag([['k', { v: 1 }]]),
    typed: new Float64Array([1.5, 2.5, 3.5]),
    sliced: new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(2, 5),
    buffer: new Uint8Array([9, 8, 7]).buffer,
    view: new DataView(new Uint8Array([1, 2, 3, 4]).buffer, 1, 2),
    boxed: [new Boolean(true), new Number(5), new String('x')],
    klass: new Point(3, 4),
    symbols: { [sym]: { deep: true }, plain: 1 },
    cyclic,
    shared: [shared, shared],
    nullProto: Object.assign(Object.create(null), { a: { b: 1 } }),
    withFunction: { fn: () => 1, nested: { fn2: function named () { return 2 } } },
    errors: { error: new Error('x'), weak: new WeakMap() },
    hiddenKey: { visible: 1 },
  }
}

describe('cloneDeep', () => {
  it('copies like lodash on a wide set of structures', () => {
    const source = samples()
    for (const key of Object.keys(source)) {
      const mine = cloneDeep(source[key])
      const theirs = lodashCloneDeep(source[key])
      expect(typeof mine, key).toBe(typeof theirs)
      if (typeof mine === 'object' && mine !== null) {
        // lodash turns a null-prototype object into a regular one; we keep the prototype (see the test below)
        if (key !== 'nullProto') expect(Object.getPrototypeOf(mine), key).toBe(Object.getPrototypeOf(theirs))
        expect(Object.prototype.toString.call(mine), key).toBe(Object.prototype.toString.call(theirs))
        expect(Reflect.ownKeys(mine as object).map(String), key).toEqual(Reflect.ownKeys(theirs as object).map(String))
        if (!['cyclic', 'errors', 'withFunction', 'sparse', 'nullProto'].includes(key)) {
          expect(deepEqual(mine, theirs), key).toBe(true)
        }
      }
    }
  })

  it('returns values that share nothing with the source', () => {
    const source = samples() as Record<string, any>
    const copy = cloneDeep(source)
    expect(copy).not.toBe(source)
    expect(copy.plain).not.toBe(source.plain)
    expect(copy.plain.b.c[2]).not.toBe(source.plain.b.c[2])
    expect(copy.map).not.toBe(source.map)
    expect(copy.map.get('a')).not.toBe(source.map.get('a'))
    expect(copy.set).not.toBe(source.set)
    expect(copy.date).not.toBe(source.date)
    expect(copy.date.getTime()).toBe(source.date.getTime())
    expect(copy.typed).not.toBe(source.typed)
    expect(Array.from(copy.typed)).toEqual([1.5, 2.5, 3.5])
    expect(Array.from(copy.sliced)).toEqual([3, 4, 5])
    expect(copy.sliced.buffer).not.toBe(source.sliced.buffer)
    expect(copy.buffer).not.toBe(source.buffer)
    expect(copy.view.byteLength).toBe(2)
    expect(copy.view.byteOffset).toBe(1)
    expect(copy.view.getUint8(0)).toBe(2)
    expect(copy.klass).toBeInstanceOf(Point)
    expect(copy.klass).not.toBe(source.klass)
    expect(copy.bag).toBeInstanceOf(Bag)
    expect(copy.regexp.lastIndex).toBe(3)
    expect(copy.regexp.flags).toBe('gi')
    expect(copy.boxed[1]).toBeInstanceOf(Number)
    expect(copy.boxed[1].valueOf()).toBe(5)
    expect(copy.symbols[sym]).toEqual({ deep: true })
    expect(copy.symbols[sym]).not.toBe(source.symbols[sym])
  })

  it('keeps circular and shared references, in the copy', () => {
    const source = samples() as Record<string, any>
    const copy = cloneDeep(source)
    expect(copy.cyclic.self).toBe(copy.cyclic)
    expect(copy.cyclic.list[0]).toBe(copy.cyclic)
    expect(copy.cyclic.list[1]).toBe(copy.cyclic.list[2])
    expect(copy.cyclic.list[1]).not.toBe(source.cyclic.list[1])
    expect(copy.shared[0]).toBe(copy.shared[1])
  })

  it('shares what cannot be copied, instead of breaking', () => {
    const source = samples() as Record<string, any>
    const copy = cloneDeep(source)
    expect(copy.withFunction.fn).toBe(source.withFunction.fn)
    expect(copy.withFunction.nested.fn2).toBe(source.withFunction.nested.fn2)
    expect(copy.errors.error).toBe(source.errors.error)
    expect(copy.errors.weak).toBe(source.errors.weak)
    const fn = () => 1
    expect(cloneDeep(fn)).toBe(fn)
    expect(cloneDeep(null)).toBeNull()
    expect(cloneDeep(5)).toBe(5)
  })

  it('turns holes of a sparse array into undefined entries, like lodash', () => {
    const mine = cloneDeep([1, , 3]) // eslint-disable-line no-sparse-arrays
    const theirs = lodashCloneDeep([1, , 3]) // eslint-disable-line no-sparse-arrays
    expect(mine.length).toBe(theirs.length)
    expect(1 in mine).toBe(1 in theirs)
  })

  it('does not let an own "__proto__" key poison the copy', () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}')
    const copy = cloneDeep(source) as Record<string, unknown>
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(copy).sort()).toEqual(['__proto__', 'ok'])
    expect(copy.polluted).toBeUndefined()
  })

  it('copies only enumerable own keys (strings and symbols)', () => {
    const source: Record<string | symbol, unknown> = { shown: 1, [sym]: 2 }
    Object.defineProperty(source, 'hidden', { value: 3, enumerable: false })
    Object.defineProperty(source, Symbol.for('hiddenSym'), { value: 4, enumerable: false })
    const copy = cloneDeep(source)
    expect(Reflect.ownKeys(copy).map(String).sort()).toEqual(['Symbol(s)', 'shown'])
  })

  it('keeps a null prototype (lodash would replace it with Object.prototype)', () => {
    const copy = cloneDeep(Object.assign(Object.create(null), { a: { b: 1 } }))
    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(copy.a).toEqual({ b: 1 })
  })

  it('reads accessors as values', () => {
    const source = { get computed () { return 7 } }
    const copy = cloneDeep(source)
    expect(Object.getOwnPropertyDescriptor(copy, 'computed')).toMatchObject({ value: 7, writable: true })
  })
})

describe('cloneDeepWith', () => {
  it('calls the customizer for the root without a parent, then for every child with its parent', () => {
    const seen: Array<[unknown, unknown, unknown]> = []
    const mine = { a: 1, b: [2, { c: 3 }], m: new Map([['k', 4]]), s: new Set([5]) }
    cloneDeepWith(mine, (value, key, parent) => { seen.push([value, key, parent]) })
    const reference: Array<[unknown, unknown, unknown]> = []
    lodashCloneDeepWith(mine, (value, key, parent) => { reference.push([value, key, parent]) })
    expect(seen.length).toBe(reference.length)
    expect(seen[0]).toEqual([mine, undefined, undefined])
    for (let i = 0; i < seen.length; i++) {
      expect(seen[i][0], `value ${i}`).toBe(reference[i][0])
      expect(seen[i][1], `key ${i}`).toBe(reference[i][1])
      expect(seen[i][2], `parent ${i}`).toBe(reference[i][2])
    }
  })

  it('uses what the customizer returns and does not descend into it', () => {
    const marker = { replaced: true }
    const source = { keep: { x: 1 }, swap: { y: 2 } }
    const copy = cloneDeepWith(source, (value, key) => (key === 'swap' ? marker : undefined))
    expect(copy.swap).toBe(marker)
    expect(copy.keep).toEqual({ x: 1 })
    expect(copy.keep).not.toBe(source.keep)
    const root = cloneDeepWith(source, (value, _key, parent) => (parent === undefined ? 'root' : undefined))
    expect(root).toBe('root')
  })

  it('a falsy but defined result from the customizer is used', () => {
    const copy = cloneDeepWith({ a: 1, b: 2 }, (value, key) => (key === 'a' ? 0 : undefined))
    expect(copy).toEqual({ a: 0, b: 2 })
  })
})
