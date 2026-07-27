import { describe, expect, it } from 'vitest'
import { ActiveModel, ActiveField, EventType } from '../src'

describe('ActiveModel.create()', () => {
  it('fills provided data into fillable fields', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = 'Guest'
    }

    const user = User.create({ name: 'Alice' })
    expect(user.name).toBe('Alice')
  })

  it('applies attribute/value defaults when the field is absent from data', () => {
    class User extends ActiveModel {
      @ActiveField({ value: 'Guest' }) name?: string
    }

    const user = User.create({})
    expect(user.name).toBe('Guest')
  })

  it('is idempotent for a primitive/undefined source', () => {
    class Empty extends ActiveModel {
      @ActiveField() x: number = 0
    }

    expect(Empty.create().x).toBe(0)
    // @ts-expect-error primitive source is coerced to {}
    expect(Empty.create('not an object').x).toBe(0)
  })
})

describe('new Model(data) vs Model.create(data)', () => {
  it('create() correctly applies data even when the field has a class-field initializer', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = 'DEFAULT'
    }

    expect(User.create({ name: 'from-data' }).name).toBe('from-data')
  })

  it('new Model(data) is clobbered by the subclass field initializer (documented gotcha)', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = 'DEFAULT'
    }

    // The field initializer runs *after* super(data) returns and overwrites
    // whatever the base constructor already filled in from `data`.
    expect(new User({ name: 'from-data' }).name).toBe('DEFAULT')
  })

  it('documented workaround: explicit this.fill(data) after super(data) restores the data', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = 'DEFAULT'

      constructor (data?: any) {
        super(data)
        if (data) {
          this.fill(data)
        }
      }
    }

    expect(new User({ name: 'from-data' }).name).toBe('from-data')
  })
})

describe('fill()', () => {
  it('only fills already-declared or fillable keys without force', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = ''
    }

    const user = User.create({ name: 'Alice' })
    user.fill({ unknownField: 'x' } as any)
    expect((user as any).unknownField).toBeUndefined()
  })

  it('fills arbitrary keys when force=true', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = ''
    }

    const user = User.create({ name: 'Alice' })
    user.fill({ unknownField: 'x' } as any, true)
    expect((user as any).unknownField).toBe('x')
  })

  it('runs the beforeFill static hook before filling', () => {
    const calls: unknown[] = []
    class User extends ActiveModel {
      @ActiveField() name: string = ''
      static beforeFill (model: any, data: any) {
        calls.push(data)
      }
    }

    User.create({ name: 'Alice' })
    expect(calls).toHaveLength(1)
  })
})

describe('clone()', () => {
  it('produces a deep, unlinked copy', () => {
    class Item extends ActiveModel {
      @ActiveField() label: string = ''
    }
    class Order extends ActiveModel {
      @ActiveField() items: Item[] = []
    }

    const order = Order.create({ items: [Item.create({ label: 'a' })] })
    const cloned = order.clone()

    cloned.items[0].label = 'b'
    expect(order.items[0].label).toBe('a')
    expect(cloned).not.toBe(order)
    expect(cloned.items[0]).toBeInstanceOf(Item)
  })
})

describe('toJSON()', () => {
  it('excludes hidden fields, keeps protected/readonly fields, applies getters', () => {
    class User extends ActiveModel {
      @ActiveField() id: string = ''
      @ActiveField({ hidden: true }) passwordHash: string = ''
      @ActiveField({ protected: true }) role: string = 'user'
      // A getter-only field needs a real backing own-property (an initializer,
      // even `undefined`) to be enumerable at all - the ownKeys trap lists it,
      // but Object.keys()/JSON.stringify() also consult getOwnPropertyDescriptor,
      // which finds nothing for a property that was never actually assigned.
      @ActiveField({
        getter: (model: any) => model.firstName + ' ' + model.lastName,
      })
      fullName?: string = undefined
      @ActiveField() firstName: string = ''
      @ActiveField() lastName: string = ''
    }

    const user = User.create({
      id: '1',
      passwordHash: 'secret',
      role: 'admin',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })

    const json = JSON.parse(JSON.stringify(user))
    expect(json.passwordHash).toBeUndefined()
    expect(json.role).toBe('admin')
    expect(json.fullName).toBe('Ada Lovelace')
    expect(Object.keys(user)).not.toContain('passwordHash')
  })

  it('recurses into nested ActiveModel instances', () => {
    class Item extends ActiveModel {
      @ActiveField() label: string = ''
      @ActiveField({ hidden: true }) internalId: string = ''
    }
    class Order extends ActiveModel {
      @ActiveField() item?: Item
    }

    const order = Order.create({ item: Item.create({ label: 'a', internalId: 'x' }) })
    const json = JSON.parse(JSON.stringify(order))
    expect(json.item.label).toBe('a')
    expect(json.item.internalId).toBeUndefined()
  })
})

describe('isTouched() / startTracking()', () => {
  it('is false immediately after a tracked create() and true after a real change', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }

    const counter = Counter.create({ value: 1 }, { tracked: true })
    expect(counter.isTouched()).toBe(false)

    counter.value = 2
    expect(counter.isTouched()).toBe(true)
  })

  it('returns undefined when the model was never tracked', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }

    const counter = Counter.create({ value: 1 })
    expect(counter.isTouched()).toBeUndefined()
  })

  it('startTracking() establishes a new baseline', () => {
    class Counter extends ActiveModel {
      @ActiveField() value: number = 0
    }

    const counter = Counter.create({ value: 1 })
    counter.value = 2
    counter.startTracking()
    expect(counter.isTouched()).toBe(false)
    counter.value = 3
    expect(counter.isTouched()).toBe(true)
  })
})

describe('mapTo() / hasMapping()', () => {
  class Order extends ActiveModel {
    @ActiveField() id: string = ''
    @ActiveField() total: number = 0
  }
  class OrderPayload {
    constructor (public orderId: string, public amountCents: number) {}
  }
  class Unmapped {}

  it('reports hasMapping correctly before and after registration', () => {
    class LocalOrder extends ActiveModel {
      @ActiveField() id: string = ''
    }
    expect(LocalOrder.hasMapping(OrderPayload)).toBe(false)
    LocalOrder.mapTo(OrderPayload, (o: any) => new OrderPayload(o.id, 0))
    expect(LocalOrder.hasMapping(OrderPayload)).toBe(true)
  })

  it('maps an instance using the registered handler', () => {
    Order.mapTo(OrderPayload, (order) => new OrderPayload(order.id, Math.round(order.total * 100)))
    const order = Order.create({ id: '42', total: 19.99 })
    const payload = order.mapTo(OrderPayload) as OrderPayload
    expect(payload).toBeInstanceOf(OrderPayload)
    expect(payload.orderId).toBe('42')
    expect(payload.amountCents).toBe(1999)
  })

  it('lazily returns a clone for an unmapped target by default', () => {
    const order = Order.create({ id: '1', total: 1 })
    const result = order.mapTo(Unmapped)
    expect(result).toBeInstanceOf(Order)
    expect(result).not.toBe(order)
  })

  it('throws for an unmapped target when lazy=false', () => {
    const order = Order.create({ id: '1', total: 1 })
    expect(() => order.mapTo(Unmapped, false)).toThrow('Mapping for target not found')
  })
})

describe('EventType.created', () => {
  // created fires at the very end of create(), synchronously, before create()
  // returns the instance - so a listener attached *after* the call can never
  // catch it. beforeFill(model, data) runs during construction and receives
  // the real (already-wrapped) instance, so it's the one hook early enough to
  // attach a listener before the event fires later in the same create() call.

  it('fires exactly once for a plain create()', () => {
    let count = 0
    class User extends ActiveModel {
      @ActiveField() name: string = ''
      static beforeFill (model: any) {
        model.emitter.on(EventType.created, () => { count++ })
      }
    }
    User.create({ name: 'Alice' })
    expect(count).toBe(1)
  })

  it('does not fire for new Model(data) - construction is not actually complete when the base constructor returns', () => {
    let fired = false
    class User extends ActiveModel {
      @ActiveField() name: string = ''
      static beforeFill (model: any) {
        model.emitter.on(EventType.created, () => { fired = true })
      }
    }
    new User({ name: 'Alice' })
    expect(fired).toBe(false)
  })

  it('bubbles up from nested factory models: child created fires before parent created', () => {
    const order: string[] = []
    class Child extends ActiveModel {
      @ActiveField() label: string = ''
      static beforeFill (model: any) {
        model.emitter.on(EventType.created, () => { order.push('child') })
      }
    }
    class Parent extends ActiveModel {
      @ActiveField({ factory: Child }) child?: Child
      static beforeFill (model: any) {
        model.emitter.on(EventType.created, () => { order.push('parent') })
      }
    }

    const parent = Parent.create({ child: { label: 'a' } })
    expect(order).toEqual(['child', 'parent'])
    expect(parent.child).toBeInstanceOf(Child)
  })

  it('fires once per instance for createFromCollection', () => {
    let count = 0
    class Item extends ActiveModel {
      @ActiveField() v: number = 0
      static beforeFill (model: any) {
        model.emitter.on(EventType.created, () => { count++ })
      }
    }
    Item.createFromCollection([{ v: 1 }, { v: 2 }, { v: 3 }])
    expect(count).toBe(3)
  })

  it('does not re-fire when createLazy short-circuits on an existing instance', () => {
    const order: string[] = []
    class L extends ActiveModel {
      @ActiveField() v: number = 0
      static beforeFill (model: any) {
        model.emitter.on(EventType.created, () => { order.push('created') })
      }
    }
    const l1 = L.create({ v: 1 })
    order.length = 0
    const l2 = L.createLazy(l1)
    expect(l2).toBe(l1)
    expect(order).toEqual([])
  })
})
