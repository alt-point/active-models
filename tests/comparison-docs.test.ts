import { describe, expect, it, vi } from 'vitest'
import { ActiveField, ActiveModel, EventType, InvariantMethod, Money, ValidationError } from '../src'

describe('docs/comparison.md examples', () => {
  it('money', () => {
    class Order extends ActiveModel {
      @ActiveField({ coerce: Money, min: Money.of(0, 'USD') })
      total: Money = Money.of(0, 'USD')
    }
    const order = Order.create({ total: '19.99 USD' } as never)
    order.total = order.total.multiply(3)
    expect(order.total.toString()).toBe('59.97 USD')
    const withTax = order.total.multiply('1.075')
    expect(withTax.toString()).toBe('64.47 USD')
    expect(withTax.allocate([1, 1, 1]).map(String)).toEqual(['21.49 USD', '21.49 USD', '21.49 USD'])
    expect(() => { order.total = '5 EUR' as never }).toThrow(ValidationError)
    expect(JSON.stringify(order)).toBe('{"total":{"amount":"59.97","currency":"USD"}}')
  })

  it('form', () => {
    class Signup extends ActiveModel {
      @ActiveField({ trim: true, lowercase: true, required: true, pattern: /^[^@\s]+@[^@\s]+$/ })
      email: string = ''

      @ActiveField({ coerce: 'integer', min: 18, max: 120 })
      age: number = 0
    }
    const form = Signup.create({ email: '  Ann@Example.COM ', age: '32' } as never)
    expect(form.email).toBe('ann@example.com')
    expect(form.age).toBe(32)
    expect(() => { form.age = 'abc' as never }).toThrow('cannot be converted to integer')
    expect(() => { form.age = 10 }).toThrow('at least 18')
    const { valid, issues } = Signup.create({}).validate()
    expect(valid).toBe(false)
    expect(issues.map((i) => [i.path, i.code])).toEqual([['email', 'required'], ['age', 'min']])
  })

  it('dirty tracking', () => {
    class Profile extends ActiveModel {
      @ActiveField() name: string = ''
      @ActiveField() bio: string = ''
    }
    const profile = Profile.create({ name: 'Ann', bio: 'x' }, { tracked: true })
    profile.name = 'Bob'
    expect(profile.isTouched()).toBe(true)
    expect(profile.changes()).toEqual({ name: { from: 'Ann', to: 'Bob' } })
    expect(profile.dirtyFields()).toEqual(['name'])
    profile.revert('name')
    expect(profile.name).toBe('Ann')
    profile.name = 'Z'
    profile.reset()
    expect(profile.name).toBe('Ann')
    profile.name = 'Ann'
    expect(profile.isTouched()).toBe(false)
  })

  it('undo/redo with a transaction', () => {
    class Doc extends ActiveModel {
      @ActiveField() title: string = ''
      @ActiveField() body: string = ''
    }
    const doc = Doc.create({ title: 'A' }, { history: { limit: 50 } })
    doc.title = 'B'
    doc.title = 'C'
    doc.undo()
    expect(doc.title).toBe('B')
    doc.undo()
    expect(doc.title).toBe('A')
    doc.redo()
    expect(doc.title).toBe('B')
    expect(doc.canUndo()).toBe(true)
    doc.transaction((d) => { d.title = 'X'; d.body = 'Y' })
    doc.undo()
    expect([doc.title, doc.body]).toEqual(['B', ''])
  })

  it('invariant transaction', () => {
    class Trip extends ActiveModel {
      @ActiveField({ coerce: 'date' }) start?: Date
      @ActiveField({ coerce: 'date' }) end?: Date

      @InvariantMethod('end must not be before start')
      static endAfterStart (trip: Trip) {
        return !trip.start || !trip.end || trip.end >= trip.start
      }
    }
    const trip = Trip.create({ start: '2026-01-01', end: '2026-01-05' } as never)
    trip.transaction((t) => {
      t.start = '2026-03-01' as never
      t.end = '2026-03-10' as never
    })
    expect(trip.end?.toISOString().slice(0, 10)).toBe('2026-03-10')
    expect(() => trip.transaction((t) => { t.end = '2026-01-01' as never })).toThrow()
    expect(trip.end?.toISOString().slice(0, 10)).toBe('2026-03-10')
  })

  it('sorted collection', () => {
    class Task extends ActiveModel {
      @ActiveField() id: number = 0
    }
    const tasks = Task.collection([{ id: 3 }, { id: 1 }], { sortBy: 'id', unique: 'id' })
    tasks.push({ id: 2 })
    expect(tasks.map((t) => t.id)).toEqual([1, 2, 3])
    expect(() => tasks.push({ id: 2 })).toThrow(ValidationError)
    tasks[0].id = 10
    expect(tasks.map((t) => t.id)).toEqual([2, 3, 10])
    expect(tasks.findByKey(3)?.id).toBe(3)
    expect(tasks.range(2, 5).map((t) => t.id)).toEqual([2, 3])
    expect(() => tasks.push(42 as never)).toThrow(TypeError)
  })

  it('transitions', () => {
    class Order extends ActiveModel {
      @ActiveField({ transitions: { new: ['paid', 'cancelled'], paid: ['shipped'], shipped: [], cancelled: [] } })
      status: string = 'new'
    }
    const order = Order.create({})
    order.status = 'paid'
    expect(() => { order.status = 'new' }).toThrow(ValidationError)
    expect((order as any).canTransition('status', 'shipped')).toBe(true)
  })

  it('events', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = ''
    }
    const audit = vi.fn()
    const enable = vi.fn()
    User.on(EventType.afterSetValue, ({ prop, value, oldValue }) => audit(prop, oldValue, value))
    const user = User.create({ name: 'Ann' })
    user.on(EventType.touched, enable)
    user.name = 'Bob'
    expect(audit).toHaveBeenCalledWith('name', 'Ann', 'Bob')
    expect(enable).toHaveBeenCalledTimes(1)
  })
})
