import { describe, it, expect } from 'vitest'
import { ActiveModel } from '../src/ActiveModel'
import { ActiveField, InvariantMethod } from '../src/decorators'
import { EventType } from '../src/types'
import { ActiveCollection } from '../src/ActiveCollection'
import { ActiveMap } from '../src/ActiveMap'
import { ActiveSet } from '../src/ActiveSet'
import { ValidationError } from '../src/pipeline'

class Trip extends ActiveModel {
  @ActiveField({ coerce: 'date' }) start?: Date
  @ActiveField({ coerce: 'date' }) end?: Date
  @ActiveField({ min: 0 }) seats: number = 1
  @ActiveField({ transitions: { open: ['closed'], closed: [] } }) state?: string

  @InvariantMethod('end must not be before start')
  static endAfterStart (trip: Trip) {
    return !trip.start || !trip.end || trip.end >= trip.start
  }
}

const day = (n: number) => new Date(Date.UTC(2026, 4, n))

describe('invariants', () => {
  it('are checked by validate(), not on every write', () => {
    const trip = Trip.create({ start: day(10), end: day(20) })
    trip.end = day(5)                                   // allowed on its own...
    expect(trip.validate()).toEqual({
      valid: false,
      issues: [{ path: '', code: 'invariant', message: 'Invariant "end must not be before start" is violated' }],
    })
  })

  it('run after the field checks, report a returned message, and treat a throw as a violation', () => {
    class Doc extends ActiveModel {
      @ActiveField({ required: true }) title?: string
      @ActiveField() a: number = 0
    }
    Doc.defineInvariant('a positive', (m) => (m.a > 0 ? true : `a is ${m.a}, must be positive`))
    Doc.defineInvariant('boom', () => { throw new Error('exploded') })
    Doc.defineInvariant('fine', () => undefined)
    expect(Doc.create({}).validate().issues.map((i) => `${i.code}:${i.path}:${i.message}`)).toEqual([
      'required:title:"title" is required',
      'invariant::a is 0, must be positive',
      'invariant::exploded',
    ])
  })

  it('are inherited, and a subclass adds its own without touching the parent', () => {
    class Child extends Trip {}
    Child.defineInvariant('seats even', (m) => m.seats % 2 === 0)
    expect(Child.getInvariants()).toHaveLength(2)
    expect(Trip.getInvariants()).toHaveLength(1)
    expect(Child.create({ seats: 3 }).validate().issues.map((i) => i.message)).toEqual(['Invariant "seats even" is violated'])
    expect(Trip.create({ seats: 3 }).validate().valid).toBe(true)
  })

  it('a nested model reports its invariant under the path of the field that holds it', () => {
    class Booking extends ActiveModel {
      @ActiveField({ factory: Trip }) trip?: Trip
      @ActiveField({ container: ActiveCollection.field(Trip) }) legs!: ActiveCollection<Trip>
    }
    const booking = Booking.create({ trip: { start: day(9), end: day(1) }, legs: [{}, { start: day(9), end: day(1) }] })
    expect(booking.validate().issues.map((i) => i.path)).toEqual(['trip', 'legs[1]'])
  })

  it('create(data, { validate: true }) enforces them too', () => {
    expect(() => Trip.create({ start: day(9), end: day(1) }, { validate: true })).toThrow(ValidationError)
  })
})

describe('transaction()', () => {
  it('keeps the changes when the result is valid, and returns what fn returned', () => {
    const trip = Trip.create({ start: day(1), end: day(2) })
    const result = trip.transaction((t) => {
      t.start = day(3)
      t.end = day(9)
      return 'done'
    })
    expect(result).toBe('done')
    expect(trip.start).toEqual(day(3))
    expect(trip.end).toEqual(day(9))
  })

  it('rolls everything back when an invariant ends up violated, and throws a ValidationError', () => {
    const trip = Trip.create({ start: day(1), end: day(2), seats: 4 })
    let error: ValidationError | undefined
    try {
      trip.transaction((t) => {
        t.seats = 9
        t.start = day(20)
        t.end = day(5)
      })
    } catch (e) { error = e as ValidationError }
    expect(error).toBeInstanceOf(ValidationError)
    expect(error!.issues[0].code).toBe('invariant')
    expect(trip.seats).toBe(4)
    expect(trip.start).toEqual(day(1))
    expect(trip.end).toEqual(day(2))
  })

  it('rolls back when fn throws (a refused write in the middle included) and rethrows the same error', () => {
    const trip = Trip.create({ seats: 2 })
    const boom = new Error('boom')
    expect(() => trip.transaction((t) => { t.seats = 5; throw boom })).toThrow(boom)
    expect(trip.seats).toBe(2)
    expect(() => trip.transaction((t) => { t.seats = 7; t.seats = -1 })).toThrow(ValidationError)
    expect(trip.seats).toBe(2)
  })

  it('an async fn is awaited; rejection or an invalid result rolls back', async () => {
    const trip = Trip.create({ seats: 1, start: day(1), end: day(2) })
    const value = await trip.transaction(async (t) => { await Promise.resolve(); t.seats = 3; return 7 })
    expect(value).toBe(7)
    expect(trip.seats).toBe(3)

    await expect(trip.transaction(async (t) => { t.seats = 9; await Promise.resolve(); throw new Error('late') })).rejects.toThrow('late')
    expect(trip.seats).toBe(3)

    await expect(trip.transaction(async (t) => { t.end = day(0) })).rejects.toBeInstanceOf(ValidationError)
    expect(trip.end).toEqual(day(2))
  })

  it('restores nested models, collections, and fields bypassing transitions', () => {
    class Leg extends ActiveModel { @ActiveField() city: string = '' }
    class Route extends ActiveModel {
      @ActiveField({ factory: Leg }) first?: Leg
      @ActiveField({ container: ActiveCollection.field(Leg) }) rest!: ActiveCollection<Leg>
      @ActiveField({ transitions: { open: ['closed'], closed: [] } }) state?: string
    }
    const route = Route.create({ first: { city: 'A' }, rest: [{ city: 'B' }], state: 'open' })
    expect(() => route.transaction((r) => {
      r.first!.city = 'Z'
      r.rest.push({ city: 'C' })
      r.rest[0].city = 'Y'
      r.state = 'closed'
      throw new Error('abort')
    })).toThrow('abort')
    expect(route.first!.city).toBe('A')
    expect(route.rest.map((l) => l.city)).toEqual(['B'])
    expect(route.state).toBe('open')
    expect(route.state).toBe('open')
    route.state = 'closed'
    expect(route.state).toBe('closed')
  })

  it('restores nested models, containers and model lists in place, so references kept to them stay valid', () => {
    class Leg extends ActiveModel {
      @ActiveField() city: string = ''
      @ActiveField() back?: Route
    }
    class Route extends ActiveModel {
      @ActiveField({ factory: Leg }) first?: Leg
      @ActiveField({ factory: Leg, readonly: true }) origin?: Leg
      @ActiveField({ factory: Leg }) legs: Leg[] = []
      @ActiveField({ container: ActiveCollection.field(Leg, { sortBy: 'city', unique: 'city' }) }) rest!: ActiveCollection<Leg>
      @ActiveField({ container: ActiveMap.field(Leg, { key: 'city' }) }) byCity!: ActiveMap<Leg>
      @ActiveField({ container: ActiveSet.field(Leg) }) seen!: ActiveSet<Leg>
    }
    const route = Route.create({
      first: { city: 'A' }, origin: { city: 'O' }, legs: [{ city: 'L' }], rest: [{ city: 'C' }, { city: 'B' }], byCity: [{ city: 'M' }], seen: [{ city: 'S' }],
    })
    const { first, origin, legs, rest, byCity, seen } = route
    const [b, c] = rest
    const [leg] = legs
    const m = byCity.get('M')!
    const [s] = seen
    first!.back = route                                   // a reference cycle
    seen.add(b)                                           // one instance in two containers
    expect(() => route.transaction((r) => {
      r.first!.city = 'Z'
      r.first!.back!.origin!.city = 'Q'
      r.legs[0].city = 'LL'
      r.legs = [...r.legs, { city: 'X' }] as never
      r.rest.push({ city: 'D' })
      b.city = 'Y'
      r.rest = [{ city: 'E' }] as never
      r.byCity.add({ city: 'N' })
      m.city = 'MM'
      r.seen.add({ city: 'T' })
      r.seen.delete(s)
      r.first = { city: 'F' } as never
      throw new Error('abort')
    })).toThrow('abort')
    expect(route.first).toBe(first)
    expect(first!.city).toBe('A')
    expect(route.origin).toBe(origin)
    expect(origin!.city).toBe('O')
    expect(route.legs).toHaveLength(1)
    expect(route.legs[0]).toBe(leg)
    expect(leg.city).toBe('L')
    expect(route.rest).toBe(rest)
    expect([...rest]).toEqual([b, c])
    expect(b.city).toBe('B')
    expect(rest.getByKey('B')).toBe(b)
    expect(route.byCity).toBe(byCity)
    expect([...byCity.entries()]).toEqual([['M', m]])
    expect(m.city).toBe('M')
    expect(route.seen).toBe(seen)
    expect([...seen]).toEqual([s, b])
  })

  it('a sorted collection reversed inside a rolled-back transaction gets its direction back', () => {
    class Leg extends ActiveModel { @ActiveField() city: string = '' }
    class Route extends ActiveModel {
      @ActiveField({ container: ActiveCollection.field(Leg, { sortBy: 'city' }) }) rest!: ActiveCollection<Leg>
    }
    const route = Route.create({ rest: [{ city: 'B' }, { city: 'C' }] })
    expect(() => route.transaction((r) => { r.rest.reverse(); throw new Error('x') })).toThrow('x')
    route.rest.push({ city: 'A' })
    expect(route.rest.map((l) => l.city)).toEqual(['A', 'B', 'C'])
  })

  it('the rollback of a nested model emits on that model and bubbles up as touched', () => {
    class Leg extends ActiveModel { @ActiveField() city: string = '' }
    class Route extends ActiveModel { @ActiveField({ factory: Leg }) first?: Leg }
    const route = Route.create({ first: { city: 'A' } })
    const log: string[] = []
    route.first!.on(EventType.afterSetValue, ({ value }) => log.push(`city=${value}`))
    route.on(EventType.touched, () => log.push('touched'))
    expect(() => route.transaction((r) => { r.first!.city = 'Z'; throw new Error('x') })).toThrow('x')
    expect(log).toEqual(['city=Z', 'touched', 'city=A', 'touched'])
  })

  it('emits its own events for the fields it puts back, and nothing for untouched fields', () => {
    const trip = Trip.create({ seats: 1 })
    const log: string[] = []
    trip.on(EventType.afterSetValue, ({ prop, value }) => log.push(`${String(prop)}=${value}`))
    expect(() => trip.transaction((t) => { t.seats = 5; throw new Error('x') })).toThrow('x')
    expect(log).toEqual(['seats=5', 'seats=1'])
  })

  it('nested transactions each roll back to their own start', () => {
    const trip = Trip.create({ seats: 1 })
    trip.transaction((t) => {
      t.seats = 2
      expect(() => t.transaction((inner) => { inner.seats = 3; throw new Error('inner') })).toThrow('inner')
      expect(t.seats).toBe(2)
    })
    expect(trip.seats).toBe(2)
  })

  it('fill(data, { atomic: true }) is all-or-nothing, a plain fill is not', () => {
    const atomic = Trip.create({ seats: 1 })
    expect(() => atomic.fill({ seats: 5, start: day(9), end: day(1) }, { atomic: true })).toThrow(ValidationError)
    expect(atomic.seats).toBe(1)
    expect(atomic.start).toBeUndefined()

    const plain = Trip.create({ seats: 1 })
    expect(() => plain.fill({ seats: 5, state: 'open', end: 'nope' })).toThrow(ValidationError)
    expect(plain.seats).toBe(5)

    atomic.fill({ seats: 6 }, { atomic: true })
    expect(atomic.seats).toBe(6)
    atomic.fill({ seats: 7, notAField: 1 } as any, { force: true, atomic: true })
    expect(atomic.seats).toBe(7)
    expect((atomic as any).notAField).toBe(1)
  })

  class Row extends ActiveModel {
    @ActiveField() id: number = 0
  }
  class Table extends ActiveModel {
    @ActiveField({ container: ActiveCollection.field(Row) }) rows!: ActiveCollection<Row>
    @ActiveField({ container: ActiveCollection.field(Row, { sortBy: 'id', unique: 'id' }) }) sorted!: ActiveCollection<Row>
    @ActiveField({ container: ActiveMap.field(Row, { key: 'id' }) }) byId!: ActiveMap<Row>
    @ActiveField({ container: ActiveSet.field(Row) }) set!: ActiveSet<Row>
  }
  class Note extends ActiveModel {
    @ActiveField({ protected: false }) text?: string = 'n'
  }
  class Pad extends ActiveModel {
    @ActiveField({ factory: Note }) note?: Note
    @ActiveField({ container: ActiveCollection.field(Row) }) rows!: ActiveCollection<Row>
  }
  class Shelf extends ActiveModel {
    @ActiveField({ factory: Pad }) pad?: Pad
    @ActiveField() label: string = ''
  }
  const ids = (items: Iterable<Row>) => Array.from(items, (row) => row.id)
  const abort = new Error('abort')
  const attempt = (model: ActiveModel, fn: () => void) => {
    try {
      model.transaction(fn)
    } catch (e) {
      if (e !== abort) throw e
    }
  }

  it('rolls back every collection operation, keeping the items and the order', () => {
    const table = Table.create({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }], sorted: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const [a, b, c] = table.rows
    const [s1, s2, s3] = table.sorted

    attempt(table, () => {
      table.rows.push({ id: 4 }, { id: 5 })
      table.rows.unshift({ id: 0 })
      table.rows.splice(1, 2, { id: 9 })
      table.rows[0] = Row.create({ id: 8 })
      table.rows.sort((x, y) => y.id - x.id)
      table.rows.reverse()
      table.rows.fill(a, 1, 2)
      table.rows.copyWithin(0, 2)
      table.rows.pop()
      table.sorted.push({ id: 0 }, { id: 10 })
      table.sorted.remove(s2)
      s3.id = -1
      table.sorted.reverse()
      table.sorted.replaceAll([{ id: 7 }])
      throw abort
    })
    expect([...table.rows]).toEqual([a, b, c])
    expect([...table.sorted]).toEqual([s1, s2, s3])
    expect(s3.id).toBe(3)
    expect(table.sorted.getByKey(3)).toBe(s3)
    expect(table.sorted.hasKey(7)).toBe(false)
    table.sorted.push({ id: 0 })
    expect(ids(table.sorted)).toEqual([0, 1, 2, 3])
  })

  it('rolls back fill(), copyWithin(), an index write and a push of an item already held, each on its own', () => {
    const table = Table.create({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const [a] = table.rows
    const x = Row.create({ id: 9 })
    const touched: unknown[] = []
    table.rows.on(EventType.touched, (payload) => touched.push(payload))
    attempt(table, () => {
      table.rows.fill(x)
      throw abort
    })
    expect(ids(table.rows)).toEqual([1, 2, 3])
    expect(touched.at(-1)).toEqual({ target: table.rows })
    const count = touched.length
    x.id = 10 // x left with the rollback
    expect(touched).toHaveLength(count)
    a.id = 11 // the items put back notify again
    expect(touched).toHaveLength(count + 1)
    a.id = 1
    for (const change of [() => table.rows.copyWithin(0, 2), () => { table.rows[1] = x }, () => table.rows.push(a)]) {
      attempt(table, () => {
        change()
        throw abort
      })
      expect(ids(table.rows)).toEqual([1, 2, 3])
    }
  })

  it('rolls back ActiveMap and ActiveSet operations, including a key move that displaced an entry', () => {
    const table = Table.create({ byId: [{ id: 1 }, { id: 2 }, { id: 3 }], set: [{ id: 1 }, { id: 2 }] })
    const [m1, m2, m3] = table.byId.values()
    const [s1, s2] = table.set

    attempt(table, () => {
      table.byId.set(4, { id: 4 })
      table.byId.add({ id: 2 }) // replaces m2
      table.byId.delete(1)
      m3.id = 4 // displaces the item under 4
      table.byId.clear()
      table.set.add({ id: 3 })
      table.set.delete(s1)
      table.set.clear()
      throw abort
    })
    expect([...table.byId.entries()]).toEqual([[1, m1], [2, m2], [3, m3]])
    expect(m3.id).toBe(3)
    expect([...table.set]).toEqual([s1, s2])
  })

  it('rolls back an ActiveMap displacement, replacement and clear() to the very same instances', () => {
    const table = Table.create({ byId: [{ id: 1 }, { id: 2 }] })
    const [m1, m2] = table.byId.values()
    attempt(table, () => {
      m1.id = 2 // displaces m2
      throw abort
    })
    expect(table.byId.get(2)).toBe(m2)
    attempt(table, () => {
      table.byId.set(2, { id: 2 }) // replaces m2
      throw abort
    })
    expect(table.byId.get(2)).toBe(m2)
    attempt(table, () => {
      table.byId.clear()
      throw abort
    })
    expect([...table.byId.entries()]).toEqual([[1, m1], [2, m2]])
  })

  it('restores a model written after it left the collection inside the transaction', () => {
    const table = Table.create({ rows: [{ id: 1 }] })
    const row = table.rows[0]
    attempt(table, () => {
      table.rows.remove(row)
      row.id = 9
      throw abort
    })
    expect(table.rows[0]).toBe(row)
    expect(row.id).toBe(1)
  })

  it('a nested transaction rolled back inside an outer one is not undone twice', () => {
    const table = Table.create({ rows: [{ id: 1 }, { id: 2 }] })
    const [a, b] = table.rows
    attempt(table, () => {
      table.rows.push({ id: 3 })
      attempt(table, () => {
        table.rows.unshift({ id: 0 })
        a.id = 11
        throw abort
      })
      expect(ids(table.rows)).toEqual([1, 2, 3])
      b.id = 22
      throw abort
    })
    expect([...table.rows]).toEqual([a, b])
    expect([a.id, b.id]).toEqual([1, 2])
  })

  it('a transaction on a nested model rolls back writes below it and a deleted field, not a write outside it', () => {
    const shelf = Shelf.create({ pad: { note: {}, rows: [{ id: 1 }] } })
    const pad = shelf.pad!
    expect(() => pad.transaction(() => {
      pad.rows[0].id = 5
      pad.rows.push({ id: 2 })
      delete pad.note!.text
      shelf.label = 'outside'
      throw abort
    })).toThrow(abort)
    expect(pad.note!.text).toBe('n')
    expect(ids(pad.rows)).toEqual([1])
    expect(shelf.label).toBe('outside')
  })

  it('an enclosing transaction does not re-apply what a nested model\'s rolled-back transaction already undid', () => {
    const shelf = Shelf.create({ pad: { rows: [{ id: 1 }, { id: 2 }] } })
    const pad = shelf.pad!
    const [a, b] = pad.rows
    attempt(shelf, () => {
      shelf.label = 'x'
      attempt(pad, () => {
        pad.rows.unshift({ id: 0 })
        throw abort
      })
      expect([...pad.rows]).toEqual([a, b])
      throw abort
    })
    expect([...pad.rows]).toEqual([a, b])
    expect(shelf.label).toBe('')
  })
})

describe('changes() / revert() / reset()', () => {
  class Profile extends ActiveModel {
    @ActiveField() name: string = 'n'
    @ActiveField({ hidden: true }) secret: string = 's'
    @ActiveField({ readonly: true }) id: string = ''
    @ActiveField({ container: ActiveCollection.field(Trip) }) trips!: ActiveCollection<Trip>
    @ActiveField({ factory: Trip }) main?: Trip
    @ActiveField({ min: 3 }) score: number = 5
  }
  const make = () => Profile.create({ id: '1', trips: [{ seats: 1 }], main: { seats: 2 } }, { tracked: true })

  it('lists exactly what differs, hidden fields included, with copies as `from`', () => {
    const profile = make()
    expect(profile.changes()).toEqual({})
    expect(profile.dirtyFields()).toEqual([])

    profile.name = 'x'
    profile.secret = 't'
    profile.trips.push({ seats: 9 })
    profile.main!.seats = 4
    const changes = profile.changes()
    expect(Object.keys(changes)).toEqual(['name', 'secret', 'trips', 'main'])
    expect(changes.name).toEqual({ from: 'n', to: 'x' })
    expect((changes.trips.from as ActiveCollection<Trip>)).toHaveLength(1)
    expect(changes.trips.from).not.toBe(profile.trips)
    expect((changes.main.from as Trip).seats).toBe(2)
    expect(profile.isDirty('name')).toBe(true)
    expect(profile.isDirty('score')).toBe(false)
  })

  it('a change that is put back is no longer dirty', () => {
    const profile = make()
    profile.name = 'x'
    profile.name = 'n'
    expect(profile.changes()).toEqual({})
  })

  it('revert(prop) puts one field back, reset() all of them, bypassing rules', () => {
    const profile = make()
    profile.name = 'x'
    profile.score = 9
    profile.trips.push({})
    profile.main!.seats = 8
    expect(profile.revert('name')).toBe(profile)
    expect(profile.name).toBe('n')
    expect(profile.score).toBe(9)

    profile.reset()
    expect(profile.changes()).toEqual({})
    expect(profile.score).toBe(5)
    expect(profile.trips).toHaveLength(1)
    expect(profile.main!.seats).toBe(2)
    expect(profile.isTouched()).toBe(false)
  })

  it('a reverted nested model and collection are live models again', () => {
    const profile = make()
    profile.main!.seats = 8
    profile.trips.push({})
    profile.reset()
    let touched = 0
    profile.on(EventType.touched, () => { touched++ })
    profile.main!.seats = 3
    profile.trips[0].seats = 3
    expect(touched).toBe(2)
    expect(() => { profile.main!.seats = -1 }).toThrow(ValidationError)
  })

  it('revert() of an unknown field throws, an unchanged field is a no-op, and readonly stays put', () => {
    const profile = make()
    expect(() => profile.revert('nope')).toThrow('"nope" is not a field of Profile')
    profile.revert('name')
    profile.id = '2'
    expect(profile.changes()).toEqual({})
  })

  it('needs a tracked model', () => {
    const profile = Profile.create({})
    for (const call of [() => profile.changes(), () => profile.dirtyFields(), () => profile.revert(), () => profile.reset()]) {
      expect(call).toThrow('need a model created with create(data, { tracked: true })')
    }
  })

  it('a clone keeps the baseline and reverts independently', () => {
    const profile = make()
    profile.name = 'x'
    const copy = profile.clone()
    expect(copy.changes()).toEqual({ name: { from: 'n', to: 'x' } })
    copy.reset()
    expect(copy.name).toBe('n')
    expect(profile.name).toBe('x')
  })

  it('reset() emits the usual events', () => {
    const profile = make()
    profile.name = 'x'
    const log: string[] = []
    profile.on(EventType.afterSetValue, ({ prop, value }) => log.push(`${String(prop)}=${value}`))
    profile.reset()
    expect(log).toEqual(['name=n'])
  })

  const makeShallow = () => Profile.create({ id: '1', trips: [{ seats: 1 }], main: { seats: 2 } }, { tracked: 'shallow' })

  it("tracked: 'shallow' compares the fields by reference: a reassignment counts, an edit inside a value doesn't", () => {
    const profile = makeShallow()
    expect(profile.isTouched()).toBe(false)
    const trips = profile.trips
    const main = profile.main!
    profile.trips.push({ seats: 9 })
    profile.main!.seats = 4
    profile.secret = 't'
    expect(profile.isTouched()).toBe(false)         // hidden: isTouched() skips it, changes() lists it
    expect(profile.dirtyFields()).toEqual(['secret'])

    profile.name = 'x'
    profile.trips = [{ seats: 5 }] as any
    profile.main = Trip.create({ seats: 6 })
    expect(profile.isTouched()).toBe(true)
    expect(profile.dirtyFields()).toEqual(['name', 'secret', 'trips', 'main'])
    expect(profile.isDirty('score')).toBe(false)
    const changes = profile.changes()
    expect(changes.name).toEqual({ from: 'n', to: 'x' })
    // the baseline keeps the collection itself, pushes included; `from` is still a copy
    expect((changes.trips.from as ActiveCollection<Trip>).map((t) => t.seats)).toEqual([1, 9])
    expect(changes.trips.from).not.toBe(trips)

    profile.revert('trips')
    expect(profile.trips).toBe(trips)               // the kept instance comes back, not a copy
    expect(profile.isDirty('trips')).toBe(false)
    profile.reset()
    expect(profile.isTouched()).toBe(false)
    expect(profile.main).toBe(main)
    expect([profile.name, profile.secret]).toEqual(['n', 's'])
  })

  it('a clone of a shallow-tracked model keeps its dirty fields and tracks independently', () => {
    const profile = makeShallow()
    profile.name = 'x'
    const copy = profile.clone()
    expect(copy.isTouched()).toBe(true)
    expect(copy.dirtyFields()).toEqual(['name'])    // trips and main are fresh copies, yet not dirty
    copy.reset()
    expect(copy.isTouched()).toBe(false)
    expect([copy.name, profile.name]).toEqual(['n', 'x'])
    copy.trips = [] as any
    expect(copy.dirtyFields()).toEqual(['trips'])
    expect(profile.dirtyFields()).toEqual(['name'])
    expect(Profile.create({ id: '1' }).isTouched()).toBeUndefined()
  })
})

describe('undo() / redo()', () => {
  class Note extends ActiveModel {
    @ActiveField() text: string = ''
    @ActiveField({ min: 0 }) stars: number = 0
    @ActiveField({ transitions: { draft: ['final'], final: [] } }) state?: string
  }
  const make = (history: boolean | { limit?: number } = true) => Note.create({ text: 'a' }, { history })

  it('walks back and forth through the writes made after creation', () => {
    const note = make()
    expect(note.canUndo()).toBe(false)
    note.text = 'b'
    note.text = 'c'
    expect(note.canUndo()).toBe(true)
    expect(note.undo()).toBe(true)
    expect(note.text).toBe('b')
    expect(note.canRedo()).toBe(true)
    expect(note.undo()).toBe(true)
    expect(note.text).toBe('a')
    expect(note.undo()).toBe(false)
    expect(note.redo()).toBe(true)
    expect(note.redo()).toBe(true)
    expect(note.text).toBe('c')
    expect(note.redo()).toBe(false)
  })

  it('a new write clears the redo steps', () => {
    const note = make()
    note.text = 'b'
    note.undo()
    note.text = 'z'
    expect(note.canRedo()).toBe(false)
    expect(note.redo()).toBe(false)
  })

  it('records nothing during creation, for no-op writes or for a model without history', () => {
    const note = make()
    expect(note.canUndo()).toBe(false)
    note.text = 'a'
    expect(note.canUndo()).toBe(false)
    const plain = Note.create({})
    plain.text = 'x'
    expect(plain.canUndo()).toBe(false)
    expect(plain.undo()).toBe(false)
    expect(plain.redo()).toBe(false)
    expect(plain.text).toBe('x')
  })

  it('a rolled-back nested transaction leaves nothing in the enclosing step', () => {
    const note = make()
    note.transaction((n) => {
      n.text = 'b'
      expect(() => n.transaction((inner) => { inner.stars = 5; throw new Error('inner') })).toThrow('inner')
    })
    expect([note.text, note.stars]).toEqual(['b', 0])
    expect(note.undo()).toBe(true)
    expect([note.text, note.stars]).toEqual(['a', 0])
    expect(note.redo()).toBe(true)
    expect([note.text, note.stars]).toEqual(['b', 0])
  })

  it('keeps at most `limit` steps', () => {
    const note = make({ limit: 2 })
    for (const text of ['b', 'c', 'd']) note.text = text
    expect(note.undo()).toBe(true)
    expect(note.undo()).toBe(true)
    expect(note.undo()).toBe(false)
    expect(note.text).toBe('b')
  })

  it('undoing bypasses rules and transitions, and is not recorded as a new change', () => {
    const note = make()
    note.state = 'draft'
    note.state = 'final'
    expect(() => { note.state = 'draft' }).toThrow(ValidationError)
    note.undo()
    expect(note.state).toBe('draft')
    note.redo()
    expect(note.state).toBe('final')
    note.undo()
    note.undo()
    expect(note.state).toBeUndefined()
    expect(note.canRedo()).toBe(true)
  })

  it('a whole transaction is one step; a rolled-back one leaves none', () => {
    const note = make()
    note.transaction((n) => { n.text = 'b'; n.stars = 3 })
    expect(() => note.transaction((n) => { n.text = 'x'; throw new Error('no') })).toThrow('no')
    expect(note.text).toBe('b')
    note.undo()
    expect(note.text).toBe('a')
    expect(note.stars).toBe(0)
    expect(note.canUndo()).toBe(false)
    note.redo()
    expect([note.text, note.stars]).toEqual(['b', 3])
  })

  it('an atomic fill is one step as well', () => {
    const note = make()
    note.fill({ text: 'q', stars: 2 }, { atomic: true })
    note.undo()
    expect([note.text, note.stars]).toEqual(['a', 0])
  })

  it('clearHistory() forgets everything', () => {
    const note = make()
    note.text = 'b'
    note.undo()
    note.clearHistory()
    expect(note.canUndo()).toBe(false)
    expect(note.canRedo()).toBe(false)
  })

  it('emits the usual events for undo and redo', () => {
    const note = make()
    note.text = 'b'
    const log: string[] = []
    note.on(EventType.afterSetValue, ({ prop, value }) => log.push(`${String(prop)}=${value}`))
    note.undo()
    note.redo()
    expect(log).toEqual(['text=a', 'text=b'])
  })
})
