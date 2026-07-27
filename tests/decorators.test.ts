import { describe, expect, it, vi } from 'vitest'
import { ActiveModel, ActiveField, EventType } from '../src'

describe('@ActiveField() defaults', () => {
  it('is fillable and protected (not deletable) by default', () => {
    class User extends ActiveModel {
      @ActiveField() name: string = ''
    }

    const user = User.create({ name: 'Alice' })
    expect(user.name).toBe('Alice')
    expect(() => { delete (user as any).name }).toThrow('Property "name" is protected!')
  })

  it('accepts a bare non-object value as a shorthand for `value`', () => {
    class User extends ActiveModel {
      @ActiveField('Guest') name?: string
    }

    expect(User.create({}).name).toBe('Guest')
  })
})

describe('hidden', () => {
  it('excludes the field from enumeration and serialization but not direct access', () => {
    class User extends ActiveModel {
      @ActiveField({ hidden: true }) secret: string = ''
    }

    const user = User.create({ secret: 'shh' })
    expect(Object.keys(user)).not.toContain('secret')
    expect(JSON.parse(JSON.stringify(user)).secret).toBeUndefined()
    expect(user.secret).toBe('shh')
  })
})

describe('protected', () => {
  it('prevents delete but still allows writes', () => {
    class User extends ActiveModel {
      @ActiveField({ protected: true }) role: string = 'user'
    }

    const user = User.create({ role: 'admin' })
    user.role = 'superadmin'
    expect(user.role).toBe('superadmin')
    expect(() => { delete (user as any).role }).toThrow('Property "role" is protected!')
  })

  it('does not affect serialization', () => {
    class User extends ActiveModel {
      @ActiveField({ protected: true }) role: string = 'user'
    }

    expect(JSON.parse(JSON.stringify(User.create({ role: 'admin' }))).role).toBe('admin')
  })
})

describe('fillable: false', () => {
  it('ignores the value passed to create()/fill() silently', () => {
    class Invoice extends ActiveModel {
      @ActiveField({ fillable: false }) number: string = 'INV-0001'
    }

    expect(Invoice.create({ number: 'HACKED' }).number).toBe('INV-0001')
  })

  it('throws on direct assignment', () => {
    class Invoice extends ActiveModel {
      @ActiveField({ fillable: false }) number: string = 'INV-0001'
    }

    const invoice = Invoice.create({})
    expect(() => { invoice.number = 'HACKED' }).toThrow()
    expect(invoice.number).toBe('INV-0001')
  })

  it('does not crash new Model(data) when the field has its own class-field initializer', () => {
    // Regression test: the field's own initializer runs *after* super(data)
    // returns, against the now-proxy-bound `this` - i.e. as a second write to
    // the same prop. Blocking that write must not throw, or construction itself
    // would fail.
    class Invoice extends ActiveModel {
      @ActiveField({ fillable: false }) number: string = 'INV-0001'
    }

    expect(() => new Invoice({ number: 'spoofed' } as any)).not.toThrow()
    expect(new Invoice({ number: 'spoofed' } as any).number).toBe('INV-0001')
  })
})

describe('readonly', () => {
  it('can be set once via create(data)', () => {
    class Order extends ActiveModel {
      @ActiveField({ readonly: true }) id: string = 'CLASS_DEFAULT'
    }

    expect(Order.create({ id: 'FROM_DATA' }).id).toBe('FROM_DATA')
    expect(Order.create({}).id).toBe('CLASS_DEFAULT')
  })

  it('can be set once via new Model(data), winning over the field initializer', () => {
    class Order extends ActiveModel {
      @ActiveField({ readonly: true }) id: string = 'CLASS_DEFAULT'
    }

    expect(new Order({ id: 'FROM_CTOR_DATA' }).id).toBe('FROM_CTOR_DATA')
    expect(new Order({}).id).toBe('CLASS_DEFAULT')
  })

  it('silently ignores further writes after the first one (fill, force, or direct assignment)', () => {
    class Order extends ActiveModel {
      @ActiveField({ readonly: true }) id: string = ''
    }

    const order = Order.create({ id: 'ORIGINAL' })

    order.id = 'CHANGED'
    expect(order.id).toBe('ORIGINAL')

    order.fill({ id: 'HACKED' } as any)
    expect(order.id).toBe('ORIGINAL')

    order.fill({ id: 'HACKED' } as any, true)
    expect(order.id).toBe('ORIGINAL')
  })

  it('remains open for one write later if never set at creation (documented edge case)', () => {
    class Order extends ActiveModel {
      @ActiveField({ readonly: true }) id?: string = undefined
    }

    const order = Order.create({})
    expect(order.id).toBeUndefined()

    order.fill({ id: 'SET_LATER' } as any)
    expect(order.id).toBe('SET_LATER')

    order.fill({ id: 'SET_AGAIN' } as any)
    expect(order.id).toBe('SET_LATER')
  })

  it('combined with fillable:false, fully ignores data - only the class default applies', () => {
    class Task extends ActiveModel {
      @ActiveField({ readonly: true, fillable: false }) id: string = 'SERVER_ID'
    }

    expect(Task.create({ id: 'spoofed' } as any).id).toBe('SERVER_ID')
    expect(new Task({ id: 'spoofed' } as any).id).toBe('SERVER_ID')

    const task = Task.create({})
    expect(() => { task.id = 'HACKED' }).toThrow()
    expect(task.id).toBe('SERVER_ID')
  })
})

describe('validator', () => {
  it('rejects a value only by throwing - a falsy return value has no effect', () => {
    class Product extends ActiveModel {
      @ActiveField({
        validator (model, prop, value) {
          return value > 0 // returning false must NOT block the write
        },
      })
      qty: number = 1
    }

    const product = Product.create({ qty: 5 })
    product.qty = -10
    expect(product.qty).toBe(-10)
  })

  it('blocks the write when it throws', () => {
    class Product extends ActiveModel {
      @ActiveField({
        validator (model, prop, value) {
          if (value <= 0) throw new TypeError('qty must be positive')
        },
      })
      qty: number = 1
    }

    const product = Product.create({ qty: 5 })
    expect(() => { product.qty = -10 }).toThrow('qty must be positive')
    expect(product.qty).toBe(5)
  })

  it('does not run for a key absent from data, nor for a value equal to the current one', () => {
    const validator = vi.fn((model, prop, value) => {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError('required')
    })
    class Task extends ActiveModel {
      @ActiveField({ validator }) title: string = ''
    }

    expect(() => Task.create({})).not.toThrow()
    expect(validator).not.toHaveBeenCalled()

    expect(() => Task.create({ title: '' })).not.toThrow()
    expect(validator).not.toHaveBeenCalled()

    expect(() => Task.create({ title: 123 as any })).toThrow()
    expect(validator).toHaveBeenCalledTimes(1)
  })
})

describe('setter / getter', () => {
  it('setter intercepts the assignment', () => {
    class Money extends ActiveModel {
      @ActiveField({
        setter (model: any, prop: string, value: number) {
          return Reflect.set(model, prop, Math.round(value * 100))
        },
      })
      cents: number = 0
    }

    const money = Money.create({ cents: 19.999 })
    expect(money.cents).toBe(2000)
  })

  it('getter transforms the read value without changing storage', () => {
    class User extends ActiveModel {
      @ActiveField({
        getter: (model: any) => String(model.age).padStart(3, '0'),
      })
      age: number = 5
    }

    const user = User.create({ age: 7 })
    expect(user.age).toBe('007')
  })
})

describe('factory', () => {
  it('wraps a single object value using the given ActiveModel factory', () => {
    class Address extends ActiveModel {
      @ActiveField() city: string = ''
    }
    class User extends ActiveModel {
      @ActiveField({ factory: Address }) address?: Address
    }

    const user = User.create({ address: { city: 'Berlin' } })
    expect(user.address).toBeInstanceOf(Address)
    expect(user.address?.city).toBe('Berlin')
  })

  it('wraps each item of an array value using [Model, defaultFactory]', () => {
    class Item extends ActiveModel {
      @ActiveField() label: string = ''
    }
    class Order extends ActiveModel {
      @ActiveField({ factory: [Item, () => []] }) items: Item[] = []
    }

    const order = Order.create({ items: [{ label: 'a' }, { label: 'b' }] })
    expect(order.items).toHaveLength(2)
    expect(order.items[0]).toBeInstanceOf(Item)
    expect(order.items[1].label).toBe('b')
  })
})

describe('on / once hooks', () => {
  it('decorator-level on{} fires per property, shared across all instances of the class', () => {
    const calls: unknown[] = []
    class Order extends ActiveModel {
      @ActiveField({
        on: {
          afterSetValue ({ prop, value }: any) {
            calls.push([prop, value])
          },
        },
      })
      status: string = 'new'
      @ActiveField() note: string = ''
    }

    const a = Order.create({})
    const b = Order.create({})

    a.status = 'paid'
    a.note = 'not tracked' // undecorated prop, should not trigger the hook
    b.status = 'shipped'

    expect(calls).toEqual([
      ['status', 'paid'],
      ['status', 'shipped'],
    ])
  })

  it('fires beforeSetValue, afterSetValue, and nulling with correct payloads', () => {
    const events: string[] = []
    class Order extends ActiveModel {
      @ActiveField({
        on: {
          beforeSetValue: () => { events.push('before') },
          afterSetValue: () => { events.push('after') },
          nulling: () => { events.push('nulling') },
        },
      })
      value: unknown = 'something'
    }

    const order = Order.create({})
    order.value = undefined
    expect(events).toEqual(['before', 'after']) // no nulling: old->undefined isn't null

    events.length = 0
    order.value = null
    expect(events).toEqual(['before', 'after', 'nulling']) // undefined -> null fires nulling

    events.length = 0
    order.value = null // no change at all (Object.is equal) -> nothing fires
    expect(events).toEqual([])
  })

  it('beforeDeletingAttribute fires on delete of a non-protected field', () => {
    const events: string[] = []
    class Order extends ActiveModel {
      // protected: true is the default for @ActiveField() - opt out explicitly
      // so delete actually reaches the trap instead of throwing first.
      @ActiveField({
        protected: false,
        on: { beforeDeletingAttribute: () => { events.push('beforeDelete') } },
      })
      note: string = ''
    }

    const order = Order.create({})
    delete (order as any).note
    expect(events).toEqual(['beforeDelete'])
  })

  it('once{} on the decorator fires only a single time', () => {
    let count = 0
    class Order extends ActiveModel {
      @ActiveField({
        once: { afterSetValue: () => { count++ } },
      })
      status: string = 'new'
    }

    const order = Order.create({})
    order.status = 'paid'
    order.status = 'shipped'
    expect(count).toBe(1)
  })

  it('instance-level emitter.on() fires for any active field, unfiltered by prop', () => {
    class Order extends ActiveModel {
      @ActiveField() a: string = ''
      @ActiveField() b: string = ''
    }

    const order = Order.create({})
    const seen: string[] = []
    order.emitter.on(EventType.afterSetValue, (payload: any) => { seen.push(payload.prop) })

    order.a = '1'
    order.b = '2'
    expect(seen).toEqual(['a', 'b'])
  })

  it('instance-level emitter.on() unsubscribes via its returned function', () => {
    class Order extends ActiveModel {
      @ActiveField() a: string = ''
    }

    const order = Order.create({})
    let count = 0
    const off = order.emitter.on(EventType.afterSetValue, () => { count++ })
    order.a = '1'
    off()
    order.a = '2'
    expect(count).toBe(1)
  })

  it('instance-level emitter.once() fires exactly once', () => {
    class Order extends ActiveModel {
      @ActiveField() a: string = ''
    }

    const order = Order.create({})
    let count = 0
    order.emitter.once(EventType.afterSetValue, () => { count++ })
    order.a = '1'
    order.a = '2'
    expect(count).toBe(1)
  })
})
