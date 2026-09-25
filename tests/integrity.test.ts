import { describe, it, expect } from 'vitest'
import { ActiveModel, ActiveField, ActiveCollection, EventType, InvariantMethod, ValidationError } from '../src'

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
      @ActiveField({ collection: Trip }) legs!: ActiveCollection<Trip>
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
      @ActiveField({ collection: Leg }) rest!: ActiveCollection<Leg>
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
})

describe('changes() / revert() / reset()', () => {
  class Profile extends ActiveModel {
    @ActiveField() name: string = 'n'
    @ActiveField({ hidden: true }) secret: string = 's'
    @ActiveField({ readonly: true }) id: string = ''
    @ActiveField({ collection: Trip }) trips!: ActiveCollection<Trip>
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
