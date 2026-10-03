import { bench, describe } from 'vitest'
import { EventType } from '../../src/types'
import { makeModel, makeData, Order, orderData } from './fixtures'

const M10 = makeModel(10)
const M100 = makeModel(100)
const d10 = makeData(10)
const d100 = makeData(100)

class Plain {
  f0 = 0
  constructor (data: Record<string, unknown>) { Object.assign(this, data) }
}

describe('creation', () => {
  bench('plain class + Object.assign (baseline)', () => { new Plain(d10) })
  bench('create() 10 fields', () => { M10.create(d10) })
  bench('create() 100 fields', () => { M100.create(d100) })
  bench('create() order + 5 lines', () => { Order.create(orderData(5)) })
  bench('create() tracked', () => { M10.create(d10, { tracked: true }) })
  bench('createFromCollection() x100', () => { M10.createFromCollection(Array.from({ length: 100 }, () => d10)) })
})

describe('access', () => {
  const m = M10.create(d10) as any
  const listened = M10.create(d10) as any
  for (let i = 0; i < 5; i++) listened.on(EventType.afterSetValue, () => {})
  const plain: any = { f0: 0 }
  const tracked = M10.create(d10, { tracked: true }) as any
  tracked.f0 = -1

  bench('plain object write (baseline)', () => { plain.f0++ })
  bench('write', () => { m.f0 = m.f0 + 1 })
  bench('write, 5 listeners', () => { listened.f0 = listened.f0 + 1 })
  bench('read', () => { void m.f0 })
  bench('isTouched()', () => { tracked.isTouched() })
})

describe('serialization', () => {
  const order = Order.create(orderData(50))
  bench('toJSON() order + 50 lines', () => { order.toJSON() })
  bench('JSON.stringify() order + 50 lines', () => { JSON.stringify(order) })
  bench('clone() order + 50 lines', () => { order.clone() })
})
