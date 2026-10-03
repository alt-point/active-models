import { describe, it, expect } from 'vitest'
import { ActiveModel } from '../../src/ActiveModel'
import { ActiveField } from '../../src/decorators'
import { EventType } from '../../src/types'
import { ActiveCollection } from '../../src/ActiveCollection'
import { measure } from './fixtures'

/** Budgets are ~7-10x the numbers measured on a laptop; loosen further with PERF_FACTOR (see budgets.perf.ts). */
const F = Number(process.env.PERF_FACTOR ?? 1)
const us = (n: number) => n * 1000 * F

class Row extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() name: string = ''
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => Row.create({ id: (i * 7919) % 100003, name: 'n' }))

describe('ActiveCollection budgets (median ns/op)', () => {
  it('push + pop of one item', () => {
    const items = rows(10)
    const collection = ActiveCollection.create(Row, [])
    expect(measure(() => { collection.push(items[0]); collection.pop() }, 20_000)).toBeLessThan(us(10))
  })

  it('building a collection of 1000 items, unsorted and sorted', () => {
    const items = rows(1000)
    expect(measure(() => ActiveCollection.create(Row, items), 10, 5)).toBeLessThan(us(6000))
    expect(measure(() => ActiveCollection.create(Row, items, { sortBy: 'id' }), 10, 5)).toBeLessThan(us(8000))
  })

  it('building a sorted collection of 10000 items', () => {
    const items = rows(10_000)
    expect(measure(() => ActiveCollection.create(Row, items, { sortBy: 'id' }), 2, 5)).toBeLessThan(us(100_000))
  })

  it('a sorted insert + remove in 10000 items', () => {
    const collection = ActiveCollection.create(Row, rows(10_000), { sortBy: 'id' })
    expect(measure(() => {
      const extra = Row.create({ id: 50_000 })
      collection.push(extra)
      collection.remove(extra)
    }, 2000)).toBeLessThan(us(400))
  })

  it('binary search: bisectLeft, findByKey and a 200-wide range in 10000 items', () => {
    const collection = ActiveCollection.create(Row, rows(10_000), { sortBy: 'id' })
    expect(measure(() => collection.bisectLeft(50_000), 50_000)).toBeLessThan(us(8))
    expect(measure(() => collection.findByKey(4242), 50_000)).toBeLessThan(us(8))
    expect(measure(() => collection.range(1000, 1200), 5000)).toBeLessThan(us(30))
  })

  it('moving an item whose key changed across 10000 items', () => {
    const collection = ActiveCollection.create(Row, rows(10_000), { sortBy: 'id' })
    const item = collection[5000]
    let high = true
    expect(measure(() => { item.id = high ? 999_999 : -1; high = !high }, 500)).toBeLessThan(us(500))
  })

  it('reading by index stays within 8x of a plain array', () => {
    const items = rows(10_000)
    const collection = ActiveCollection.create(Row, items, { sortBy: 'id' })
    const plain = Array.from(collection)
    const readPlain = () => { let sum = 0; for (let i = 0; i < 1000; i++) sum += plain[i].id; return sum }
    const readCollection = () => { let sum = 0; for (let i = 0; i < 1000; i++) sum += collection[i].id; return sum }
    expect(measure(readCollection, 2000) / measure(readPlain, 2000)).toBeLessThan(8)
  })
})

describe('ActiveCollection scaling', () => {
  it('a 10x larger sorted bulk load costs < 25x', () => {
    const small = rows(5000)
    const large = rows(50_000)
    const t1 = measure(() => ActiveCollection.create(Row, small, { sortBy: 'id' }), 2, 5)
    const t10 = measure(() => ActiveCollection.create(Row, large, { sortBy: 'id' }), 1, 3)
    expect(t10 / t1).toBeLessThan(25)
  })

  it('the cost of a sorted insert grows with size far slower than a full re-sort would', () => {
    const insertInto = (n: number) => {
      const collection = ActiveCollection.create(Row, rows(n), { sortBy: 'id' })
      return measure(() => {
        const extra = Row.create({ id: 50_000 })
        collection.push(extra)
        collection.remove(extra)
      }, 500)
    }
    // 10x more items: shifting is linear, a re-sort per insert would be ~30x
    expect(insertInto(10_000) / insertInto(1000)).toBeLessThan(15)
  })
})

describe('ActiveCollection memory', () => {
  const gc = (globalThis as { gc?: () => void }).gc
  const heap = () => { gc!(); return process.memoryUsage().heapUsed / 1024 / 1024 }

  // A WeakRef keeps its target alive until the end of the current job, so the rounds are separated by real ticks.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it.skipIf(!gc)('dropped collections over long-lived items are collected and stop listening', async () => {
    const items = rows(200)
    const round = () => {
      for (let i = 0; i < 1500; i++) {
        const collection = ActiveCollection.create(Row, items, { sortBy: 'id' })
        collection.on(EventType.touched, () => {})
      }
    }
    round()
    await tick()
    gc!()
    for (const item of items) item.name = 'a'
    await tick()
    const baseline = heap()

    round()
    await tick()
    round()
    await tick()
    gc!() // the collections are now unreachable
    for (const item of items) item.name = 'b' // dead collections unsubscribe themselves on the next change
    await tick()
    expect(heap() - baseline).toBeLessThan(15 * F)
  })
})
