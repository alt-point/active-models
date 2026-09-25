import { describe, it, expect } from 'vitest'
import { ActiveModel, ActiveField, ActiveCollection, EventType, ValidationError } from '../src'

const issuesOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    return (error as ValidationError).issues
  }
  throw new Error('expected a ValidationError')
}

describe('normalizers', () => {
  class User extends ActiveModel {
    @ActiveField({ trim: true, lowercase: true }) email: string = ''
    @ActiveField({ uppercase: true }) code: string = ''
    @ActiveField({ transform: [(v) => `${v}!`, (v) => `<${v}>`] }) shout: string = ''
    @ActiveField({ transform: (v, { model, prop }) => `${prop}:${(model as any).email}:${v}` }) ctx: string = ''
    @ActiveField({ trim: true }) note?: unknown
  }

  it('trim, lowercase and uppercase normalize strings', () => {
    const user = User.create({ email: '  Ann@Example.COM ', code: 'ab1' })
    expect(user.email).toBe('ann@example.com')
    expect(user.code).toBe('AB1')
    user.email = ' BOB@x.io\n'
    expect(user.email).toBe('bob@x.io')
  })

  it('custom transforms run in order and receive the model and the property name', () => {
    const user = User.create({ email: 'a@b.c', shout: 'hi', ctx: 'v' })
    expect(user.shout).toBe('<hi!>')
    expect(user.ctx).toBe('ctx:a@b.c:v')
  })

  it('leave non-strings and null/undefined alone', () => {
    const user = User.create({})
    user.note = 5
    expect(user.note).toBe(5)
    user.note = null
    expect(user.note).toBeNull()
    user.note = undefined
    expect(user.note).toBeUndefined()
  })

  it('events and touched see the normalized value, and a write that normalizes to the current value is a no-op', () => {
    const user = User.create({ email: 'a@b.c' })
    const seen: unknown[] = []
    user.on(EventType.afterSetValue, ({ value }) => seen.push(value))
    let touched = 0
    user.on(EventType.touched, () => { touched++ })
    user.email = '  A@B.C '
    expect(seen).toEqual([])
    expect(touched).toBe(0)
    user.email = ' New@B.C '
    expect(seen).toEqual(['new@b.c'])
    expect(touched).toBe(1)
  })
})

describe('coercion', () => {
  class Form extends ActiveModel {
    @ActiveField({ coerce: 'number' }) price: number = 0
    @ActiveField({ coerce: 'integer' }) qty: number = 0
    @ActiveField({ coerce: 'boolean' }) active: boolean = false
    @ActiveField({ coerce: 'date' }) when?: Date
    @ActiveField({ coerce: 'string' }) label?: string
  }

  it.each([
    ['price', '12.5', 12.5], ['price', ' 7 ', 7], ['price', true, 1], ['price', 3, 3],
    ['qty', '4', 4],
    ['active', 'true', true], ['active', 'TRUE', true], ['active', '1', true], ['active', 1, true],
    ['active', 'false', false], ['active', '0', false], ['active', 0, false], ['active', false, false],
    ['label', 42, '42'], ['label', false, 'false'],
  ])('%s: %j becomes %j', (prop, input, expected) => {
    const form = Form.create({ active: prop === 'active' ? !expected : false })
    ;(form as any)[prop] = input
    expect((form as any)[prop]).toBe(expected)
  })

  it('turns dates and date strings into Date, and a Date into an ISO string for string fields', () => {
    const form = Form.create({ when: '2026-01-02T03:04:05.000Z', label: new Date('2026-01-02T03:04:05.000Z') as any })
    expect(form.when).toBeInstanceOf(Date)
    expect(form.when!.toISOString()).toBe('2026-01-02T03:04:05.000Z')
    expect(form.label).toBe('2026-01-02T03:04:05.000Z')
    const date = new Date(0)
    form.when = date
    expect(form.when).toBe(date)
    form.when = 86_400_000 as any
    expect(form.when!.getTime()).toBe(86_400_000)
  })

  it('null and undefined pass through', () => {
    const form = Form.create({ price: 5 })
    form.price = null as any
    expect(form.price).toBeNull()
    form.price = undefined as any
    expect(form.price).toBeUndefined()
  })

  it.each([
    ['price', 'abc'], ['price', ''], ['price', {}], ['qty', 'x'], ['active', 'maybe'], ['active', {}],
    ['when', 'not a date'], ['when', {}], ['when', new Date('nope')], ['label', {}], ['label', []],
  ])('refuses %s = %j with a coerce issue', (prop, input) => {
    const form = Form.create({})
    const issues = issuesOf(() => { (form as any)[prop] = input })
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('coerce')
    expect(issues[0].path).toBe(prop)
  })

  it('an integer field refuses a fractional number', () => {
    const form = Form.create({})
    expect(issuesOf(() => { form.qty = '2.5' as any })[0].code).toBe('type')
    expect(form.qty).toBe(0)
  })
})

describe('rules', () => {
  class Person extends ActiveModel {
    @ActiveField({ required: true }) name: string = 'x'
    @ActiveField({ min: 0, max: 150 }) age?: number
    @ActiveField({ minLength: 2, maxLength: 4 }) tag?: string
    @ActiveField({ minLength: 1, maxLength: 2 }) list?: string[]
    @ActiveField({ pattern: /^[a-z]+$/g }) slug?: string
    @ActiveField({ oneOf: ['a', 'b'] }) letter?: string
    @ActiveField({ type: 'string' }) text?: unknown
    @ActiveField({ type: 'array' }) arr?: unknown
    @ActiveField({ type: 'object' }) obj?: unknown
    @ActiveField({ type: 'boolean' }) flag?: unknown
    @ActiveField({ type: 'date', min: new Date('2020-01-01'), max: new Date('2030-01-01') }) at?: unknown
  }

  it('required refuses null, undefined and the empty string on write', () => {
    const person = Person.create({})
    for (const empty of [null, undefined, '']) {
      const issues = issuesOf(() => { person.name = empty as any })
      expect(issues).toEqual([{ path: 'name', code: 'required', message: '"name" is required', value: empty }])
    }
    expect(person.name).toBe('x')
  })

  it('min and max bound numbers and dates', () => {
    const person = Person.create({})
    person.age = 0
    person.age = 150
    expect(issuesOf(() => { person.age = -1 })[0]).toMatchObject({ code: 'min', message: '"age" must be at least 0' })
    expect(issuesOf(() => { person.age = 151 })[0]).toMatchObject({ code: 'max', message: '"age" must be at most 150' })
    person.at = new Date('2025-06-01')
    expect(issuesOf(() => { person.at = new Date('2019-12-31') })[0].code).toBe('min')
    expect(issuesOf(() => { person.at = new Date('2031-01-01') })[0].code).toBe('max')
    expect(issuesOf(() => { person.at = new Date('2019-12-31') })[0].message).toContain('2020-01-01T00:00:00.000Z')
  })

  it('minLength and maxLength bound strings and arrays', () => {
    const person = Person.create({})
    person.tag = 'ab'
    person.tag = 'abcd'
    expect(issuesOf(() => { person.tag = 'a' })[0]).toMatchObject({ code: 'minLength', message: '"tag" must have at least 2 characters/items, has 1' })
    expect(issuesOf(() => { person.tag = 'abcde' })[0].code).toBe('maxLength')
    person.list = ['x']
    expect(issuesOf(() => { person.list = [] })[0].code).toBe('minLength')
    expect(issuesOf(() => { person.list = ['a', 'b', 'c'] })[0].code).toBe('maxLength')
  })

  it('pattern tests strings (a /g flag does not make it stateful) and oneOf checks membership', () => {
    const person = Person.create({})
    person.slug = 'abc'
    person.slug = 'def'
    person.slug = 'ghi'
    expect(issuesOf(() => { person.slug = 'ABC' })[0]).toMatchObject({ code: 'pattern', message: '"slug" does not match /^[a-z]+$/g' })
    person.letter = 'a'
    expect(issuesOf(() => { person.letter = 'c' })[0].message).toBe('"letter" must be one of "a", "b", got "c"')
  })

  it('type checks each runtime type', () => {
    const person = Person.create({})
    person.text = 's'; person.arr = []; person.obj = {}; person.flag = false; person.at = new Date()
    for (const [prop, bad, type] of [
      ['text', 1, 'string'], ['arr', {}, 'array'], ['obj', [], 'object'], ['obj', null, 'object'], ['flag', 0, 'boolean'], ['at', 'x', 'date'], ['at', new Date('nope'), 'date'],
    ] as const) {
      if (bad === null) continue
      expect(issuesOf(() => { (person as any)[prop] = bad })[0]).toMatchObject({ code: 'type', path: prop })
      expect(issuesOf(() => { (person as any)[prop] = bad })[0].message).toContain(`must be a ${type}`)
    }
  })

  it('optional fields are not checked while null/undefined; an empty string is a value like any other', () => {
    const person = Person.create({})
    person.age = null as any
    person.tag = undefined
    person.text = ''
    expect(person.text).toBe('')
    expect(issuesOf(() => { person.tag = '' })[0].code).toBe('minLength')
  })

  it('rules run on creation too', () => {
    expect(issuesOf(() => Person.create({ age: -5 }))[0].code).toBe('min')
  })

  it('oneOf accepts a TypeScript enum, string or numeric', () => {
    enum Level { Low = 'low', High = 'high' }
    enum Num { A, B }
    class Alert extends ActiveModel {
      @ActiveField({ oneOf: Level }) level?: Level
      @ActiveField({ oneOf: Num }) num?: Num
    }
    const alert = Alert.create({ level: Level.Low, num: Num.B })
    expect(issuesOf(() => { alert.level = 'mid' as any })[0].message).toContain('"low", "high"')
    expect(issuesOf(() => { alert.num = 'A' as any })[0].code).toBe('oneOf')
    expect(issuesOf(() => { alert.num = 7 as any })[0].message).toContain('0, 1')
    alert.num = Num.A
    expect(alert.num).toBe(0)
  })

  it('a rejected first write does not lock a readonly field', () => {
    class Doc extends ActiveModel {
      @ActiveField({ readonly: true, min: 5 }) version?: number
    }
    const doc = Doc.create({})
    expect(issuesOf(() => { doc.version = 1 })[0].code).toBe('min')
    doc.version = 10
    expect(doc.version).toBe(10)
    doc.version = 20
    expect(doc.version).toBe(10)
  })

  it('ValidationError is an Error with a readable message', () => {
    const error = new ValidationError([
      { path: 'a', code: 'required', message: 'a is required' },
      { path: 'b', code: 'min', message: 'b too small' },
    ])
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ValidationError')
    expect(error.message).toBe('2 validation errors: a is required; b too small')
    expect(new ValidationError([{ path: 'a', code: 'required', message: 'only' }]).message).toBe('only')
  })
})

describe('validate()', () => {
  class Address extends ActiveModel {
    @ActiveField({ required: true }) city?: string
  }
  class Order extends ActiveModel {
    @ActiveField({ required: true }) id?: string
    @ActiveField({ min: 1 }) qty: number = 1
    @ActiveField({ validator: (_m, prop, v) => { if (v === 'bad') throw new Error(`${prop} is bad`) } }) note?: string
    @ActiveField({ factory: Address }) address?: Address
    @ActiveField({ collection: Address }) history!: ActiveCollection<Address>
    @ActiveField({ factory: [Address, () => []] }) plain: Address[] = []
  }

  it('reports every problem at once, with paths through nested models, collections and arrays', () => {
    const order = Order.create({
      qty: 3,
      address: {},
      history: [{ city: 'A' }, {}],
      plain: [{}, { city: 'B' }],
    })
    order.note = 'fine'
    const { valid, issues } = order.validate()
    expect(valid).toBe(false)
    expect(issues.map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      'id:required',
      'address.city:required',
      'history[1].city:required',
      'plain[0].city:required',
    ])
  })

  it('a good model is valid with no issues', () => {
    const order = Order.create({ id: '1', address: { city: 'X' } })
    expect(order.validate()).toEqual({ valid: true, issues: [] })
  })

  it('checks the stored value with rules and validators (which run only for values that are set)', () => {
    class Legacy extends ActiveModel {
      @ActiveField({ min: 5, validator: (_m, prop, v) => { if (v === 'bad') throw new Error(`${prop} is bad`) } }) v: any = 1
    }
    const legacy = Legacy.create({})
    const { issues } = legacy.validate()
    expect(issues).toEqual([{ path: 'v', code: 'min', message: '"v" must be at least 5', value: 1 }])
    const raw = Object.create(Legacy.prototype)
    raw.v = 'bad'
    expect(Legacy.prototype.validate.call(raw).issues).toEqual([{ path: 'v', code: 'validator', message: 'v is bad', value: 'bad' }])
    const unset = Object.create(Legacy.prototype)
    expect(Legacy.prototype.validate.call(unset).issues).toEqual([])
  })

  it('survives reference cycles', () => {
    class Node extends ActiveModel {
      @ActiveField({ required: true }) label?: string
      @ActiveField() peer?: Node
    }
    const a = Node.create({})
    const b = Node.create({ label: 'b' })
    a.peer = b
    b.peer = a
    expect(a.validate().issues.map((i) => i.path)).toEqual(['label'])
  })

  it('assertValid() throws with every issue and returns the model when fine', () => {
    const bad = Order.create({ history: [{}] })
    let error: ValidationError | undefined
    try { bad.assertValid() } catch (e) { error = e as ValidationError }
    expect(error).toBeInstanceOf(ValidationError)
    expect(error!.issues.map((i) => i.path)).toEqual(['id', 'history[0].city'])
    const good = Order.create({ id: '1', address: { city: 'X' } })
    expect(good.assertValid()).toBe(good)
  })

  it('create(data, { validate: true }) throws instead of returning an invalid model, and never announces created', () => {
    let created = 0
    Order.on(EventType.created, () => { created++ })
    expect(issuesOf(() => Order.create({}, { validate: true })).map((i) => i.code)).toEqual(['required'])
    expect(created).toBe(0)
    expect(Order.create({ id: '1', address: { city: 'X' } }, { validate: true }).id).toBe('1')
    expect(created).toBe(1)
  })
})

describe('transitions', () => {
  class Order extends ActiveModel {
    @ActiveField({ transitions: { new: ['paid', 'cancelled'], paid: ['shipped'], shipped: [] } }) status?: string
  }

  it('allows the listed changes and refuses the rest, with the values in the message', () => {
    const order = Order.create({ status: 'new' })
    order.status = 'paid'
    const issues = issuesOf(() => { order.status = 'new' })
    expect(issues[0]).toMatchObject({ code: 'transition', path: 'status', message: '"status" cannot change from "paid" to "new"' })
    order.status = 'shipped'
    expect(issuesOf(() => { order.status = 'paid' })[0].code).toBe('transition')
    expect(order.status).toBe('shipped')
  })

  it('a state with no entry is terminal, and writing the same state is a no-op', () => {
    const order = Order.create({ status: 'cancelled' })
    expect(issuesOf(() => { order.status = 'new' })[0].code).toBe('transition')
    order.status = 'cancelled'
    expect(order.status).toBe('cancelled')
  })

  it('the first value and creation from stored data are unrestricted', () => {
    expect(Order.create({}).status).toBeUndefined()
    const order = Order.create({})
    order.status = 'shipped'
    expect(order.status).toBe('shipped')
    expect(Order.create({ status: 'shipped' }).status).toBe('shipped')
  })

  it('canTransition() and allowedTransitions() tell what is possible now', () => {
    const order = Order.create({ status: 'new' })
    expect(order.canTransition('status', 'paid')).toBe(true)
    expect(order.canTransition('status', 'shipped')).toBe(false)
    expect(order.allowedTransitions('status')).toEqual(['paid', 'cancelled'])
    order.status = 'paid'
    expect(order.allowedTransitions('status')).toEqual(['shipped'])
    order.status = 'shipped'
    expect(order.allowedTransitions('status')).toEqual([])
    expect(Order.create({}).allowedTransitions('status')).toEqual(['new', 'paid', 'shipped', 'cancelled'])
    expect(order.canTransition('nothing', 1)).toBe(true)
    expect(order.allowedTransitions('nothing')).toEqual([])
  })
})

describe('strict models', () => {
  class Loose extends ActiveModel {
    @ActiveField() a: number = 1
  }
  class Strict extends ActiveModel {
    static strict = true
    @ActiveField() a: number = 1
    helper = 'h'
  }

  it('a loose model quietly accepts any property', () => {
    const loose = Loose.create({})
    ;(loose as any).typo = 1
    expect((loose as any).typo).toBe(1)
  })

  it('a strict model refuses unknown properties, but not declared fields, existing properties or symbols', () => {
    const strict = Strict.create({})
    expect(() => { (strict as any).typo = 1 }).toThrow('Unknown property "typo" on Strict')
    strict.a = 2
    strict.helper = 'changed'
    ;(strict as any)[Symbol.for('meta')] = 1
    expect(strict.a).toBe(2)
    expect(strict.helper).toBe('changed')
    expect(() => Object.assign(strict, { nope: 1 })).toThrow(/Unknown property "nope"/)
  })

  it('strictness is inherited by subclasses', () => {
    class Child extends Strict {}
    expect(() => { (Child.create({}) as any).x = 1 }).toThrow(/Unknown property/)
  })
})
