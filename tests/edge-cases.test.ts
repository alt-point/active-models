import { describe, it, expect } from 'vitest'
import { ActiveModel } from '../src/ActiveModel'
import { ActiveField } from '../src/decorators'
import { EventType } from '../src/types'

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

  it('createFromCollection() skips only null/undefined items', () => {
    const cars = Car.createFromCollection([{ name: 'a' }, null as any, undefined as any, { name: 'b' }])
    expect(cars.map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('asyncCreateFromCollection() / asyncCreateFromCollectionLazy() await the promise', async () => {
    const eager = await Car.asyncCreateFromCollection(Promise.resolve([{ name: 'a' }, { name: 'b' }]))
    expect(eager).toHaveLength(2)

    const lazy = await Car.asyncCreateFromCollectionLazy(Promise.resolve([eager[0], { name: 'c' }]))
    expect(lazy[0]).toBe(eager[0])
    expect(lazy[1].name).toBe('c')
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

  it('class-level Parent.on() fires for subclass instances', () => {
    let hits = 0
    Base.on(EventType.afterSetValue, () => { hits++ })
    Child.create({}).id = 'changed'
    expect(hits).toBe(1)
  })

  it("a parent's @ActiveField({ on }) hook fires for subclass instances", () => {
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
  it('toJSON() keeps a Date as a Date/ISO string instead of collapsing it to {}', () => {
    class Event extends ActiveModel {
      @ActiveField() at: Date = new Date(0)
    }
    const json = JSON.stringify(Event.create({}))
    expect(json).toBe('{"at":"1970-01-01T00:00:00.000Z"}')
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
  it('clone() carries the tracking baseline over', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }
    const tracked = Counter.create({ value: 1 }, { tracked: true })
    const copy = tracked.clone()
    expect(copy.isTouched()).toBe(false)
    copy.value = 2
    expect(copy.isTouched()).toBe(true)
    expect(tracked.isTouched()).toBe(false)
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
  it('a throwing listener still lets the other listeners run, then the error propagates', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }
    const counter = Counter.create({})
    const seen: string[] = []
    counter.on(EventType.afterSetValue, () => { throw new Error('boom') })
    counter.on(EventType.afterSetValue, () => { seen.push('second') })

    expect(() => { counter.value = 5 }).toThrow('boom')
    expect(seen).toEqual(['second'])
    expect(counter.value).toBe(5)
  })

  it('several failing listeners are reported together in `errors`', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }
    const counter = Counter.create({})
    counter.on(EventType.afterSetValue, () => { throw new Error('a') })
    counter.on(EventType.afterSetValue, () => { throw new Error('b') })

    try {
      counter.value = 1
      expect.unreachable()
    } catch (error) {
      expect((error as { errors: Error[] }).errors.map((e) => e.message)).toEqual(['a', 'b'])
    }
  })
})

describe('creation never emits touched', () => {
  it('create() and new Model(data) do not fire touched for the initial fill', async () => {
    class Inner extends ActiveModel {
      @ActiveField() x: number = 0
    }
    class User extends ActiveModel {
      @ActiveField() name: string = ''
      @ActiveField({ factory: Inner }) inner?: Inner
    }
    let touched = 0
    User.on(EventType.touched, () => { touched++ })

    User.create({ name: 'a', inner: { x: 1 } })
    new User({ name: 'b' })
    await Promise.resolve()

    // create() emits nothing; new User() emits once, for its own `name` field initializer running after the constructor - see docs
    expect(touched).toBe(1)
    const user = User.create({})
    const before = touched
    user.name = 'changed'
    expect(touched).toBe(before + 1)
  })

  it('a failing create() does not leave the "creating" state stuck', () => {
    class Strict extends ActiveModel {
      @ActiveField({ validator: () => { throw new Error('nope') } }) x: string = ''
    }
    expect(() => Strict.create({ x: 'a' })).toThrow('nope')

    class Ok extends ActiveModel {
      @ActiveField() v: number = 0
    }
    let touched = 0
    Ok.on(EventType.touched, () => { touched++ })
    Ok.create({}).v = 1
    expect(touched).toBe(1)
  })
})

describe('event payloads', () => {
  it('created and touched carry { target } - the model instance itself', async () => {
    class Item extends ActiveModel {
      @ActiveField() id: string = ''
    }
    const created: unknown[] = []
    const touched: unknown[] = []
    Item.on(EventType.created, (p) => created.push(p.target))
    Item.on(EventType.touched, (p) => touched.push(p.target))

    const viaCreate = Item.create({ id: '1' })
    const viaNew = new Item({ id: '2' })
    await Promise.resolve()
    viaCreate.id = 'x'

    expect(created).toEqual([viaCreate, viaNew])
    expect(created[0]).toBe(viaCreate)
    // (new Item() also emits touched for its own field initializers, after the constructor returned)
    expect(touched).toEqual([viaNew, viaCreate])
  })
})

describe('clone()', () => {
  class Account extends ActiveModel {
    @ActiveField() name: string = ''
    @ActiveField({ hidden: true }) token: string = ''
    @ActiveField({ readonly: true }) id: string = ''
    @ActiveField({ validator: (_m, _p, v) => { if (v === 'bad') throw new Error('invalid') } }) status: string = ''
  }

  it('returns a working model: hidden values kept, validators and readonly still enforced', () => {
    const copy = Account.create({ name: 'n', token: 't', id: '1' }).clone()
    expect(copy).toBeInstanceOf(Account)
    expect(copy.token).toBe('t')
    expect(() => { copy.status = 'bad' }).toThrow('invalid')
    copy.id = 'other'
    expect(copy.id).toBe('1')
  })

  it('is independent of the original, including nested models', () => {
    class Line extends ActiveModel {
      @ActiveField({ hidden: true }) note: string = ''
      @ActiveField() qty: number = 0
    }
    class Cart extends ActiveModel {
      @ActiveField({ factory: Line }) line?: Line
    }
    const cart = Cart.create({ line: { note: 'n', qty: 1 } })
    const copy = cart.clone()
    copy.line!.qty = 5
    expect(cart.line!.qty).toBe(1)
    expect(copy.line!.note).toBe('n')
    expect(copy.line).not.toBe(cart.line)
  })

  it('does not copy instance listeners and emits no created event', () => {
    let created = 0
    Account.on(EventType.created, () => { created++ })
    const original = Account.create({})
    let own = 0
    original.on(EventType.afterSetValue, () => { own++ })
    const before = created
    const copy = original.clone()
    copy.name = 'x'
    expect(own).toBe(0)
    expect(created).toBe(before)
  })
})

describe('hidden fields and reflection', () => {
  class Secret extends ActiveModel {
    @ActiveField() name: string = ''
    @ActiveField({ hidden: true }) token: string = 't'
  }

  it('are concealed from `in` and getOwnPropertyDescriptor, but readable directly', () => {
    const secret = Secret.create({})
    expect('token' in secret).toBe(false)
    expect(Object.getOwnPropertyDescriptor(secret, 'token')).toBeUndefined()
    expect('name' in secret).toBe(true)
    expect(secret.token).toBe('t')
  })

  it('stay usable after makeFreeze() (proxy invariants are respected)', () => {
    const frozen = Secret.create({}).makeFreeze()
    expect(frozen.token).toBe('t')
    expect(Object.keys(frozen)).toEqual(['name'])
  })
})

describe('makeFreeze() errors', () => {
  it('throws a clear TypeError on write and delete', () => {
    class Box extends ActiveModel {
      @ActiveField({ protected: false }) v: number = 1
    }
    const frozen = Box.create({}).makeFreeze()
    expect(() => { (frozen as any).v = 2 }).toThrow(/frozen/)
    expect(() => { delete (frozen as any).v }).toThrow(/frozen/)
  })
})

describe('create() input validation', () => {
  it('throws a helpful error for an array instead of silently building an empty model', () => {
    class Item extends ActiveModel {
      @ActiveField() id: string = ''
    }
    expect(() => Item.create([{ id: '1' }] as any)).toThrow(/createFromCollection/)
  })
})

describe('toJSON() special values', () => {
  it('serializes Set as an array and Map as an object, at any depth', () => {
    class Bag extends ActiveModel {
      @ActiveField() tags: any = new Set(['a', 'b'])
      @ActiveField() meta: any = new Map([['k', 1]])
      @ActiveField() nested: any = { when: new Date(0), list: [new Set([1])] }
    }
    expect(Bag.create({}).toJSON()).toEqual({
      tags: ['a', 'b'],
      meta: { k: 1 },
      nested: { when: '1970-01-01T00:00:00.000Z', list: [[1]] },
    })
  })
})

describe('create() vs instance fill()', () => {
  class Profile extends ActiveModel {
    @ActiveField({ value: 'guest' }) role: string = ''
    @ActiveField({ fillable: false }) createdBy: string = 'system'
    @ActiveField() name: string = ''
  }

  it('create() applies `value` defaults for absent keys, fill() never re-applies them', () => {
    const profile = Profile.create({ name: 'a' })
    expect(profile.role).toBe('guest')
    profile.role = 'admin'
    profile.fill({ name: 'b' })
    expect(profile.role).toBe('admin')
  })

  it('both silently ignore fillable:false keys from data', () => {
    const profile = Profile.create({ createdBy: 'attacker' })
    expect(profile.createdBy).toBe('system')
    profile.fill({ createdBy: 'attacker' })
    expect(profile.createdBy).toBe('system')
  })

  it('fill() deep-copies its input (sanitize), so later mutation of the source does not leak in', () => {
    class Doc extends ActiveModel {
      @ActiveField() tags: string[] = []
    }
    const source = { tags: ['a'] }
    const doc = Doc.create({}).fill(source)
    source.tags.push('b')
    expect(doc.tags).toEqual(['a'])
  })
})
