import { describe, expect, it } from 'vitest'
import { ActiveModel } from '../../src/ActiveModel'
import { ActiveField } from '../../src/decorators'
import { ActiveMap } from '../../src/ActiveMap'
import { ActiveSet } from '../../src/ActiveSet'
import { Decimal } from '../../src/scalars/Decimal'
import { Money } from '../../src/scalars/Money'
import { LocalDate } from '../../src/scalars/LocalDate'
import { measure } from './fixtures'

/** Budgets for validation, transactions, history and value objects; see budgets.perf.ts for the rules. */
const F = Number(process.env.PERF_FACTOR ?? 1)
const us = (n: number) => n * 1000 * F

class Form extends ActiveModel {
  @ActiveField({ trim: true, lowercase: true, required: true, pattern: /^[^@\s]+@[^@\s]+$/ }) email: string = 'a@b.c'
  @ActiveField({ coerce: 'integer', min: 0, max: 200 }) age: number = 30
  @ActiveField() note: string = ''
}

class Item extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() title: string = ''
}

describe('features budgets (median ns/op)', () => {
  it('write through rules, coercion and normalizers', () => {
    const form = Form.create({})
    let i = 0
    expect(measure(() => { form.age = (i++ % 100) as never }, 20_000)).toBeLessThan(us(15))
    expect(measure(() => { form.email = ` User${i++ % 50}@Example.com ` }, 20_000)).toBeLessThan(us(20))
  })

  it('validate() of a model', () => {
    const form = Form.create({})
    expect(measure(() => form.validate(), 5000)).toBeLessThan(us(30))
  })

  it('transaction() over three writes', () => {
    const form = Form.create({})
    let i = 0
    expect(measure(() => form.transaction((f) => { f.age = i++ % 100 as never; f.note = 'x' + i; f.email = 'a@b.c' }), 2000)).toBeLessThan(us(120))
  })

  it('changes() and isTouched() on a tracked model', () => {
    const form = Form.create({}, { tracked: true })
    form.age = 31 as never
    expect(measure(() => form.changes(), 2000)).toBeLessThan(us(120))
    expect(measure(() => form.isTouched(), 2000)).toBeLessThan(us(120))
  })

  it('a write with history enabled, and undo/redo', () => {
    const form = Form.create({}, { history: true })
    let i = 0
    expect(measure(() => { form.note = 'n' + i++ }, 20_000)).toBeLessThan(us(20))
    expect(measure(() => { form.undo(); form.redo() }, 5000)).toBeLessThan(us(20))
  })

  it('ActiveMap and ActiveSet operations', () => {
    const map = ActiveMap.create(Item, { key: 'id' })
    let i = 0
    expect(measure(() => { map.set(i, { id: i } as never); i++ }, 5000)).toBeLessThan(us(30))
    expect(measure(() => map.get(100), 50_000)).toBeLessThan(us(2))
    const set = ActiveSet.create(Item, [], { unique: 'id' })
    let j = 0
    expect(measure(() => { set.add({ id: j++ } as never) }, 5000)).toBeLessThan(us(30))
  })

  it('Decimal, Money and LocalDate', () => {
    const a = Decimal.from('12345.6789')
    expect(measure(() => a.multiply('1.075').add('0.01'), 20_000)).toBeLessThan(us(15))
    expect(measure(() => Decimal.from('12345.6789'), 20_000)).toBeLessThan(us(15))
    const m = Money.of('100', 'USD')
    expect(measure(() => m.allocate([1, 1, 1]), 5000)).toBeLessThan(us(60))
    expect(measure(() => m.multiply('1.075'), 20_000)).toBeLessThan(us(20))
    const d = LocalDate.of(2026, 9, 25)
    expect(measure(() => d.addMonths(1).addDays(3), 20_000)).toBeLessThan(us(10))
    expect(measure(() => LocalDate.from('2026-09-25'), 20_000)).toBeLessThan(us(10))
  })
})
