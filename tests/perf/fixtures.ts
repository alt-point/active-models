import { ActiveModel } from '../../src/ActiveModel'
import { ActiveField } from '../../src/decorators'

/** A model class with `count` plain fields f0..f{count-1}, built programmatically. */
export function makeModel (count: number, opts: Parameters<typeof ActiveField>[0] = {}) {
  class Generated extends ActiveModel {}
  for (let i = 0; i < count; i++) {
    ActiveField(opts)(Generated.prototype, `f${i}`)
  }
  return Generated
}

export function makeData (count: number) {
  const data: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) data[`f${i}`] = i
  return data
}

export class Line extends ActiveModel {
  @ActiveField() sku: string = ''
  @ActiveField() qty: number = 0
}

export class Order extends ActiveModel {
  @ActiveField() id: string = ''
  @ActiveField({ validator: (_m, _p, v) => { if (typeof v !== 'string') throw new TypeError('string') } })
  status: string = 'new'
  @ActiveField({ hidden: true }) secret: string = 's'
  @ActiveField({ factory: [Line, () => []] }) lines: Line[] = []
}

export const orderData = (lines = 5) => ({
  id: 'o1',
  status: 'paid',
  secret: 'x',
  lines: Array.from({ length: lines }, (_, i) => ({ sku: `sku${i}`, qty: i })),
})

/** Median ns/op over `samples` batches of `iterations` calls (after a warmup). */
export function measure (fn: () => void, iterations = 2000, samples = 9): number {
  for (let i = 0; i < iterations; i++) fn()
  const times: number[] = []
  for (let s = 0; s < samples; s++) {
    const start = performance.now()
    for (let i = 0; i < iterations; i++) fn()
    times.push(((performance.now() - start) * 1e6) / iterations)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(samples / 2)]
}
