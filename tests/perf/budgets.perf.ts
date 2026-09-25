import { describe, it, expect } from 'vitest'
import { ActiveField, ActiveModel, EventType } from '../../src'
import { makeModel, makeData, Order, orderData, measure } from './fixtures'

/**
 * Budgets are deliberately loose (5-8x the numbers measured on a laptop) so a slow CI runner
 * doesn't flake, yet an accidental O(n^2) or a per-call allocation storm still trips them.
 * Loosen further on a slow machine with PERF_FACTOR=3.
 */
const F = Number(process.env.PERF_FACTOR ?? 1)
const us = (n: number) => n * 1000 * F

describe('absolute budgets (median ns/op)', () => {
  const M10 = makeModel(10)
  const M100 = makeModel(100)
  const d10 = makeData(10)
  const d100 = makeData(100)

  it('create() with 10 fields', () => {
    expect(measure(() => M10.create(d10))).toBeLessThan(us(60))
  })

  it('create() with 100 fields', () => {
    expect(measure(() => M100.create(d100), 500)).toBeLessThan(us(600))
  })

  it('new Model(data) with 1 field', () => {
    const M1 = makeModel(1)
    expect(measure(() => new M1({ f0: 1 }), 500)).toBeLessThan(us(25))
  })

  it('create() of an order with 5 nested lines', () => {
    expect(measure(() => Order.create(orderData(5)), 500)).toBeLessThan(us(180))
  })

  it('reading a field', () => {
    const m = M10.create(d10) as any
    expect(measure(() => m.f0, 100_000)).toBeLessThan(1000 * F)
  })

  it('writing a field', () => {
    const m = M10.create(d10) as any
    expect(measure(() => { m.f0 = m.f0 + 1 }, 50_000)).toBeLessThan(us(8))
  })

  it('toJSON() of 10 fields / of an order with 50 lines', () => {
    const m = M10.create(d10)
    expect(measure(() => m.toJSON(), 5000)).toBeLessThan(us(30))
    const order = Order.create(orderData(50))
    expect(measure(() => order.toJSON(), 500)).toBeLessThan(us(400))
  })

  it('clone() of an order with 50 lines', () => {
    const order = Order.create(orderData(50))
    expect(measure(() => order.clone(), 300)).toBeLessThan(us(400))
  })

  it('isTouched() on a tracked model', () => {
    const t = M10.create(d10, { tracked: true }) as any
    t.f0 = 999
    expect(measure(() => t.isTouched(), 5000)).toBeLessThan(us(30))
  })

  it('createFromCollection() of 1000 items', () => {
    const items = Array.from({ length: 1000 }, () => d10)
    expect(measure(() => M10.createFromCollection(items), 3, 5)).toBeLessThan(us(80_000))
  })
})

describe('listeners are cheap', () => {
  const M10 = makeModel(10)
  const d10 = makeData(10)

  it('5 listeners on afterSetValue cost less than 5x a write with none', () => {
    const bare = M10.create(d10) as any
    const listened = M10.create(d10) as any
    for (let i = 0; i < 5; i++) listened.on(EventType.afterSetValue, () => {})
    const base = measure(() => { bare.f0 = bare.f0 + 1 }, 20_000)
    const withListeners = measure(() => { listened.f0 = listened.f0 + 1 }, 20_000)
    expect(withListeners).toBeLessThan(base * 5)
  })

  it('a class-level listener on a 3-level inheritance chain stays sub-8µs per write', () => {
    class A extends makeModel(3) {}
    class B extends A {}
    class C extends B {}
    A.on(EventType.afterSetValue, () => {})
    B.on(EventType.afterSetValue, () => {})
    const c = C.create({}) as any
    expect(measure(() => { c.f0 = c.f0 === 1 ? 2 : 1 }, 20_000)).toBeLessThan(us(8))
  })
})

describe('scaling stays roughly linear', () => {
  it('10x more fields costs < 25x per create()', () => {
    const M10 = makeModel(10)
    const M100 = makeModel(100)
    const t10 = measure(() => M10.create(makeData(10)), 1000)
    const t100 = measure(() => M100.create(makeData(100)), 300)
    expect(t100 / t10).toBeLessThan(25)
  })

  it('5x more collection items costs < 9x', () => {
    const M = makeModel(5)
    const make = (n: number) => Array.from({ length: n }, () => makeData(5))
    const small = make(1000)
    const large = make(5000)
    const t1 = measure(() => M.createFromCollection(small), 3, 5)
    const t5 = measure(() => M.createFromCollection(large), 2, 5)
    expect(t5 / t1).toBeLessThan(9)
  })

  it('a 50-level deep self-nested model neither overflows the stack nor blows the budget', () => {
    class Tree extends ActiveModel {}
    ActiveField()(Tree.prototype, 'label')
    ActiveField({ factory: Tree })(Tree.prototype, 'child')
    let data: any = { label: 'leaf' }
    for (let i = 0; i < 50; i++) data = { label: `n${i}`, child: data }

    const root = Tree.create(data) as any
    let depth = 0
    for (let n = root; n; n = n.child) depth++
    expect(depth).toBe(51)
    expect(measure(() => Tree.create(data), 50, 5)).toBeLessThan(us(10_000))
  })

  it('a 10k-element array field is created within budget', () => {
    const M = makeModel(1)
    const data = { f0: Array.from({ length: 10_000 }, (_, i) => ({ i })) }
    expect(measure(() => M.create(data), 3, 5)).toBeLessThan(us(60_000))
  })
})

describe('memory', () => {
  const gc = (globalThis as { gc?: () => void }).gc
  const heap = () => { gc!(); return process.memoryUsage().heapUsed / 1024 / 1024 }

  it.skipIf(!gc)('dropped models (with instance + class listeners) are garbage collected', () => {
    const M = makeModel(5)
    M.on(EventType.afterSetValue, () => {})
    const round = () => {
      for (let i = 0; i < 20_000; i++) {
        const m = M.create(makeData(5)) as any
        m.on(EventType.afterSetValue, () => {})
        m.f0 = 'x'
      }
    }
    round()
    const afterFirst = heap()
    round()
    round()
    const afterThree = heap()
    // WeakMap-keyed registries must not retain dropped instances
    expect(afterThree - afterFirst).toBeLessThan(15 * F)
  })

  it.skipIf(!gc)('creating and discarding tracked models does not accumulate snapshots', () => {
    const M = makeModel(5)
    for (let i = 0; i < 5000; i++) M.create(makeData(5), { tracked: true })
    const before = heap()
    for (let i = 0; i < 20_000; i++) M.create(makeData(5), { tracked: true })
    expect(heap() - before).toBeLessThan(15 * F)
  })
})
