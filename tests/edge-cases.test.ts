import { describe, it, expect } from 'vitest'
import { ActiveModel, ActiveField, EventType } from '../src'

describe('factory variants', () => {
  class Car extends ActiveModel {
    @ActiveField() name: string = ''
  }

  it('asyncCreate() awaits the promise and builds the model', async () => {
    const car = await Car.asyncCreate(Promise.resolve({ name: 'Tesla' }))
    expect(car).toBeInstanceOf(Car)
    expect(car.name).toBe('Tesla')
  })

  it('asyncCreateLazy() returns the very same instance when given a model', async () => {
    const existing = Car.create({ name: 'Audi' })
    expect(await Car.asyncCreateLazy(Promise.resolve(existing))).toBe(existing)
  })

  it('createLazy() short-circuits on an existing instance but builds from plain data', () => {
    const existing = Car.create({ name: 'Audi' })
    expect(Car.createLazy(existing)).toBe(existing)
    expect(Car.createLazy({ name: 'BMW' })).not.toBe(existing)
  })

  it('createFromCollection() silently drops falsy items instead of throwing', () => {
    const cars = Car.createFromCollection([{ name: 'a' }, null as any, undefined as any, { name: 'b' }])
    // known typing gap: createFromCollection() is typed as ActiveModel[], not Car[]
    expect(cars.map((c) => (c as Car).name)).toEqual(['a', 'b'])
  })

  it('asyncCreateFromCollection() / asyncCreateFromCollectionLazy() await the promise', async () => {
    const eager = await Car.asyncCreateFromCollection(Promise.resolve([{ name: 'a' }, { name: 'b' }]))
    expect(eager).toHaveLength(2)

    const lazy = await Car.asyncCreateFromCollectionLazy(Promise.resolve([eager[0], { name: 'c' }]))
    expect(lazy[0]).toBe(eager[0])
    expect((lazy[1] as Car).name).toBe('c')
  })

  it('create() unlinks nested references from the source data by default (sanitize)', () => {
    class Box extends ActiveModel {
      @ActiveField() tags: string[] = []
    }
    const source = { tags: ['a'] }
    const box = Box.create(source)
    box.tags.push('b')
    expect(source.tags).toEqual(['a'])
  })
})

describe('makeFreeze()', () => {
  it('blocks further writes', () => {
    class Car extends ActiveModel {
      @ActiveField() name: string = 'x'
    }
    const frozen = Car.create({ name: 'a' }).makeFreeze()
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(() => { (frozen as any).name = 'b' }).toThrow()
    expect(frozen.name).toBe('a')
  })
})

describe('inheritance', () => {
  class Base extends ActiveModel {
    @ActiveField() id: string = ''
  }
  class Child extends Base {
    @ActiveField({ hidden: true }) secret: string = 's'
    @ActiveField() extra: string = ''
  }

  it('a subclass inherits the parent fields, and its own decorators do not leak back into the parent', () => {
    const child = Child.create({ id: '1', extra: 'e', secret: 'x' })
    expect(Object.keys(child)).toEqual(['id', 'extra'])
    expect(child.secret).toBe('x')
    expect(Object.keys(Base.create({ id: '1' }))).toEqual(['id'])
  })

  // Known bug: listeners are stored per constructor and looked up only for
  // `instance.constructor`, so anything registered on a parent class -
  // Parent.on(...) and the parent's own @ActiveField({ on }) hooks - never fires
  // for subclass instances. Flip to `it` once fixed.
  it.fails('class-level Parent.on() fires for subclass instances', () => {
    let hits = 0
    Base.on(EventType.afterSetValue, () => { hits++ })
    Child.create({}).id = 'changed'
    expect(hits).toBe(1)
  })

  it.fails("a parent's @ActiveField({ on }) hook fires for subclass instances", () => {
    let hits = 0
    class P extends ActiveModel {
      @ActiveField({ on: { afterSetValue: () => { hits++ } } }) v: number = 0
    }
    class C extends P {}
    C.create({}).v = 1
    expect(hits).toBe(1)
  })
})

describe('serialization edge cases', () => {
  // Known bug: toJSON() recurses into every object via Object.keys(), so
  // values with their own serialization (Date, Map, Set...) collapse to {}.
  it.fails('toJSON() keeps a Date as a Date/ISO string instead of collapsing it to {}', () => {
    class Event extends ActiveModel {
      @ActiveField() at: Date = new Date(0)
    }
    const json = JSON.stringify(Event.create({}))
    expect(json).toContain('1970-01-01T00:00:00.000Z')
  })

  it('toJSON() drops functions and undefined, keeps null and nested arrays', () => {
    class Mixed extends ActiveModel {
      @ActiveField() fn: any = () => 1
      @ActiveField() u: any = undefined
      @ActiveField() n: any = null
      @ActiveField() arr: any = [1, { x: 1 }]
    }
    expect(Mixed.create({}).toJSON()).toEqual({ n: null, arr: [1, { x: 1 }] })
  })
})

describe('tracking limits', () => {
  it('clone() does not carry the tracking baseline over', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }
    const tracked = Counter.create({ value: 1 }, { tracked: true })
    expect(tracked.clone().isTouched()).toBeUndefined()
  })

  it('an in-place array mutation flips isTouched() but emits no touched event', () => {
    class List extends ActiveModel {
      @ActiveField() items: string[] = []
    }
    const list = List.create({}, { tracked: true })
    let touchedEvents = 0
    list.on(EventType.touched, () => { touchedEvents++ })

    list.items.push('a')

    expect(list.isTouched()).toBe(true)
    expect(touchedEvents).toBe(0)
  })
})

describe('listener errors', () => {
  it('a throwing listener propagates to the assignment, after the value was already written', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }
    const counter = Counter.create({})
    counter.on(EventType.afterSetValue, () => { throw new Error('boom') })

    expect(() => { counter.value = 5 }).toThrow('boom')
    expect(counter.value).toBe(5)
  })
})
