import { describe, it, expect, vi } from 'vitest'
import {
  ActiveModel, ActiveField, ActiveFactory, EventType, GetterMethod, SetterMethod,
} from '../src'

describe('defaults are per instance', () => {
  class Bag extends ActiveModel {
    @ActiveField({ value: [] }) items: string[] = undefined as any
    @ActiveField({ value: { n: 0 } }) meta: { n: number } = undefined as any
    @ActiveField({ value: () => [] as string[] }) fresh: string[] = undefined as any
    @ActiveField({ value: 'x' }) label: string = ''
  }

  it('a plain object/array `value` is copied for every instance', () => {
    const a = Bag.create({})
    const b = Bag.create({})
    a.items.push('x')
    a.meta.n = 5
    expect(b.items).toEqual([])
    expect(b.meta.n).toBe(0)
    expect(a.items).not.toBe(b.items)
  })

  it('a factory default is invoked per instance', () => {
    expect(Bag.create({}).fresh).not.toBe(Bag.create({}).fresh)
  })

  it('a provided key (even undefined/null/falsy) is never replaced by the default', () => {
    expect(Bag.create({ label: '' }).label).toBe('')
    expect(Bag.create({ label: null as any }).label).toBeNull()
    expect(Bag.create({ label: undefined }).label).toBeUndefined()
    expect(Bag.create({ items: ['a'] }).items).toEqual(['a'])
  })
})

describe('touched', () => {
  class Child extends ActiveModel {
    @ActiveField() n: number = 0
  }
  class Parent extends ActiveModel {
    @ActiveField({ factory: Child }) child?: Child
    @ActiveField({ factory: [Child, () => []] }) kids: Child[] = []
    @ActiveField({ readonly: true }) id: string = ''
    @ActiveField({ fillable: false }) locked: string = 'l'
    @ActiveField({ validator: (_m, _p, v) => { if (v === 'bad') throw new Error('bad') } }) status: string = ''
  }
  const count = (m: ActiveModel) => {
    const seen = { n: 0 }
    m.on(EventType.touched, () => { seen.n++ })
    return seen
  }

  it('bubbles up from a nested model, and from items of a nested list', () => {
    const p = Parent.create({ child: { n: 1 }, kids: [{ n: 1 }, { n: 2 }] })
    const seen = count(p)
    p.child!.n = 2
    p.kids[1].n = 5
    expect(seen.n).toBe(2)
  })

  it('a replaced child no longer notifies the old parent', () => {
    const p = Parent.create({ child: { n: 1 } })
    const old = p.child!
    p.child = { n: 9 } as any
    const seen = count(p)
    old.n = 100
    expect(seen.n).toBe(0)
    p.child!.n = 3
    expect(seen.n).toBe(1)
  })

  it('assigning the same child repeatedly does not stack listeners', () => {
    const p = Parent.create({})
    const c = Child.create({})
    p.child = c
    p.child = { n: 1 } as any
    p.child = c as any
    const seen = count(p)
    c.n = 7
    expect(seen.n).toBe(1)
  })

  it('a clone bubbles independently of the original', () => {
    const p = Parent.create({ child: { n: 1 } })
    const copy = p.clone()
    const original = count(p)
    const clone = count(copy)
    copy.child!.n = 2
    expect(clone.n).toBe(1)
    expect(original.n).toBe(0)
  })

  it('survives a reference cycle without recursing forever', () => {
    class Node extends ActiveModel {
      @ActiveField() label: string = ''
      @ActiveField() peer?: Node
    }
    const a = Node.create({})
    const b = Node.create({})
    a.peer = b
    b.peer = a
    const seen = count(a)
    b.label = 'x'
    expect(seen.n).toBeGreaterThanOrEqual(1)
  })

  it('is emitted once per real change, after the value is written', () => {
    const p = Parent.create({})
    const order: string[] = []
    p.on(EventType.afterSetValue, () => order.push('after'))
    p.on(EventType.touched, ({ target }) => order.push(`touched:${(target as any).status}`))
    p.status = 'ok'
    p.status = 'ok'
    expect(order).toEqual(['after', 'touched:ok'])
  })

  it('is not emitted for rejected writes or non-field properties', () => {
    const p = Parent.create({ id: '1' })
    const seen = count(p)
    p.id = '2'
    expect(() => { p.locked = 'x' as any }).toThrow()
    expect(() => { p.status = 'bad' }).toThrow('bad')
    ;(p as any).plain = 1
    expect(seen.n).toBe(0)
  })
})

describe('option inheritance', () => {
  class Base extends ActiveModel {
    @ActiveField({ hidden: true }) secret: string = 's'
    @ActiveField({ readonly: true }) id: string = ''
    @ActiveField({ protected: false }) free: string = 'f'
    @ActiveField({ fillable: false }) fixed: string = 'k'
    @ActiveField({ value: 'dflt' }) withDefault: string = ''
    @ActiveField({ validator: (_m, _p, v) => { if (v === 'bad') throw new Error('bad') } }) checked: string = ''
    @ActiveField({ setter: (m, p, v) => Reflect.set(m, p, String(v).toUpperCase()) }) shout: string = ''
    @ActiveField({ getter: (m, p) => `<${Reflect.get(m, p)}>` }) tagged: string = 't'
  }
  class Derived extends Base {
    @ActiveField() extra: string = ''
    @ActiveField({ hidden: true }) derivedSecret: string = 'd'
  }

  it('a subclass keeps every parent option', () => {
    const d = Derived.create({ id: '1', fixed: 'x', checked: 'ok', shout: 'hi' })
    expect(Object.keys(d)).toEqual(expect.arrayContaining(['id', 'free', 'withDefault', 'checked', 'shout', 'tagged', 'extra']))
    expect(Object.keys(d)).not.toContain('secret')
    expect(Object.keys(d)).not.toContain('derivedSecret')
    d.id = 'z'
    expect(d.id).toBe('1')
    expect(d.fixed).toBe('k')
    expect(d.withDefault).toBe('dflt')
    expect(() => { d.checked = 'bad' }).toThrow('bad')
    expect(d.shout).toBe('HI')
    expect(d.tagged).toBe('<t>')
    delete (d as any).free
    expect(() => { delete (d as any).id }).toThrow(/protected/)
    expect(() => { (d as any).fixed = 'y' }).toThrow()
  })

  it("a subclass's own options do not leak into the parent", () => {
    Derived.create({})
    const b = Base.create({})
    expect(Object.keys(b)).not.toContain('extra')
    expect((b as any).derivedSecret).toBeUndefined()
    expect(Base.hasMapping(Derived)).toBe(false)
  })
})

describe('toJSON()', () => {
  it('keeps null, nested arrays and objects, and applies getters', () => {
    class Doc extends ActiveModel {
      @ActiveField() nothing: any = null
      @ActiveField() grid: any = [[1, 2], [3]]
      @ActiveField() deep: any = { a: { b: [{ c: 1 }] } }
      @ActiveField({ getter: (m, p) => `[${Reflect.get(m, p)}]` }) title: string = 't'
      @ActiveField() text: string = 'x'
    }
    expect(Doc.create({}).toJSON()).toEqual({
      nothing: null,
      grid: [[1, 2], [3]],
      deep: { a: { b: [{ c: 1 }] } },
      title: '[t]',
      text: 'x',
    })
  })

  it('primitives and null pass through the static helper unchanged', () => {
    expect(ActiveModel.toJSON(5 as any)).toBe(5)
    expect(ActiveModel.toJSON(null as any)).toBeNull()
  })
})

describe('factory option pass-through', () => {
  class Car extends ActiveModel {
    @ActiveField() name: string = ''
  }

  it('tracked reaches the model through every factory variant', async () => {
    const opts = { tracked: true }
    expect(Car.create({}, opts).isTouched()).toBe(false)
    expect(Car.createLazy({}, opts).isTouched()).toBe(false)
    expect((await Car.asyncCreate(Promise.resolve({}), opts)).isTouched()).toBe(false)
    expect((await Car.asyncCreateLazy(Promise.resolve({}), opts)).isTouched()).toBe(false)
    expect(Car.createFromCollection([{}], opts)[0].isTouched()).toBe(false)
    expect(Car.createFromCollectionLazy([{}], opts)[0].isTouched()).toBe(false)
    expect((await Car.asyncCreateFromCollection(Promise.resolve([{}]), opts))[0].isTouched()).toBe(false)
    expect((await Car.asyncCreateFromCollectionLazy(Promise.resolve([{}]), opts))[0].isTouched()).toBe(false)
  })

  it('every variant is untracked by default', async () => {
    expect(Car.createLazy({}).isTouched()).toBeUndefined()
    expect((await Car.asyncCreate(Promise.resolve({}))).isTouched()).toBeUndefined()
    expect((await Car.asyncCreateLazy(Promise.resolve({}))).isTouched()).toBeUndefined()
    expect(Car.createFromCollection([{}])[0].isTouched()).toBeUndefined()
    expect(Car.createFromCollectionLazy([{}])[0].isTouched()).toBeUndefined()
    expect((await Car.asyncCreateFromCollection(Promise.resolve([{}])))[0].isTouched()).toBeUndefined()
    expect((await Car.asyncCreateFromCollectionLazy(Promise.resolve([{}])))[0].isTouched()).toBeUndefined()
  })

  it('a non-lazy create() of an existing model builds a new instance; lazy keeps it', () => {
    const existing = Car.create({ name: 'a' })
    const rebuilt = Car.create(existing)
    expect(rebuilt).not.toBe(existing)
    expect(rebuilt.name).toBe('a')
    expect(Car.createFromCollection([existing])[0]).not.toBe(existing)
    expect(Car.createFromCollectionLazy([existing])[0]).toBe(existing)
    expect(Car.create(existing, { lazy: true })).toBe(existing)
  })

  it('sanitize:false keeps references to the source, the default cuts them', () => {
    class Box extends ActiveModel {
      @ActiveField() tags: string[] = []
    }
    const source = { tags: ['a'] }
    Box.create(source, { sanitize: false }).tags.push('b')
    expect(source.tags).toEqual(['a', 'b'])

    const other = { tags: ['a'] }
    Box.create(other).tags.push('b')
    expect(other.tags).toEqual(['a'])
  })

  it('new Model(data) also cuts references to the source', () => {
    class Box extends ActiveModel {
      @ActiveField() tags: string[]
      constructor (data?: any) {
        super(data)
        this.tags = data.tags
      }
    }
    const source = { tags: ['a'] }
    new Box(source)
    expect(source.tags).toEqual(['a'])
  })
})

describe('tracking snapshot', () => {
  class Form extends ActiveModel {
    @ActiveField() tags: string[] = []
    @ActiveField() cfg: { deep: { n: number } } = { deep: { n: 0 } }
    @ActiveField() cb: () => number = () => 1
  }

  it('is independent of the source data and detects deep changes', () => {
    const source = { tags: ['a'], cfg: { deep: { n: 1 } } }
    const form = Form.create(source, { tracked: true })
    source.tags.push('b')
    source.cfg.deep.n = 99
    expect(form.isTouched()).toBe(false)

    form.cfg.deep.n = 2
    expect(form.isTouched()).toBe(true)
  })

  it('returns to untouched when a value is put back', () => {
    const form = Form.create({ tags: ['a'] }, { tracked: true })
    form.tags = ['b']
    expect(form.isTouched()).toBe(true)
    form.tags = ['a']
    expect(form.isTouched()).toBe(false)
  })
})

describe('creation internals', () => {
  it('a model built inside a field initializer during create() is a real (proxied) model', () => {
    class Inner extends ActiveModel {
      @ActiveField({ validator: (_m, _p, v) => { if (v === 'bad') throw new Error('inner') } }) v: string = ''
    }
    class Holder extends ActiveModel {
      inner: Inner = new Inner({ v: 'ok' })
    }
    const inner = Holder.create({}).inner
    expect(() => { inner.v = 'bad' }).toThrow('inner')
  })

  it('fill() reaches a fillable field that has no own value yet', () => {
    class Late extends ActiveModel {
      @ActiveField() maybe?: string
    }
    const late = Late.create({})
    expect(Object.keys(late)).not.toContain('maybe')
    late.fill({ maybe: 'now' })
    expect(late.maybe).toBe('now')
  })
})

describe('decorators', () => {
  class Tag extends ActiveModel {
    @ActiveField() label: string = ''
  }

  it('a list factory falls back to its default for a falsy value and wraps a single object', () => {
    class Post extends ActiveModel {
      @ActiveFactory([Tag, () => []]) tags: Tag[] = []
      @ActiveFactory([Tag, () => ({ label: 'dflt' })]) one?: any
    }
    expect(Post.create({ tags: null as any }).tags).toEqual([])
    const post = Post.create({ one: { label: 'x' } })
    expect(post.one).toBeInstanceOf(Tag)
    expect(post.one.label).toBe('x')
    expect(Post.create({ one: null }).one).toEqual({ label: 'dflt' })
  })

  it('a missing factory model throws a ReferenceError naming the property', () => {
    expect(() => {
      class Bad extends ActiveModel {
        @ActiveFactory(undefined as any) x?: unknown
      }
      return Bad
    }).toThrow(ReferenceError)
    expect(() => {
      class Bad2 extends ActiveModel {
        @ActiveFactory([undefined as any]) y?: unknown
      }
      return Bad2
    }).toThrow(/"y"/)
  })

  it('a factory that is not an ActiveModel warns and throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => {
      class Bad extends ActiveModel {
        @ActiveField({ factory: class NotModel {} as any }) z?: unknown
      }
      return Bad
    }).toThrow(/"z"/)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('GetterMethod and SetterMethod each take effect on their own', () => {
    class Price extends ActiveModel {
      @ActiveField() stored: number = 0
      @ActiveField() shown: number = 1

      @SetterMethod('stored')
      static double (m: any, p: string, v: number) { return Reflect.set(m, p, v * 2) }

      @GetterMethod('shown')
      static plusOne (m: any, p: string) { return Reflect.get(m, p) + 1 }
    }
    const price = Price.create({})
    price.stored = 5
    expect(Reflect.get(price, 'stored')).toBe(10)
    expect(price.shown).toBe(2)
  })

  it('field hooks are filtered by property and honor once', () => {
    const seen: string[] = []
    class Hooked extends ActiveModel {
      @ActiveField({ on: { afterSetValue: ({ prop }) => seen.push(`a:${String(prop)}`) } }) a: number = 0
      @ActiveField({ once: { afterSetValue: ({ prop }) => seen.push(`b:${String(prop)}`) } }) b: number = 0
      @ActiveField() c: number = 0
    }
    const h = Hooked.create({})
    h.a = 1
    h.b = 1
    h.b = 2
    h.c = 1
    expect(seen).toEqual(['a:a', 'b:b'])
  })
})

describe('emitter', () => {
  class Thing extends ActiveModel {
    @ActiveField() v: number = 0
  }

  it('rejects a non-function listener', () => {
    const t = Thing.create({})
    expect(() => t.on(EventType.created, 'nope' as any)).toThrow('Listener must be a function!')
    expect(() => Thing.on(EventType.created, 42 as any)).toThrow('Listener must be a function!')
  })

  it('rethrows the very same error when exactly one listener fails', () => {
    const t = Thing.create({})
    const boom = new Error('boom')
    t.on(EventType.afterSetValue, () => { throw boom })
    let caught: unknown
    try { t.v = 1 } catch (e) { caught = e }
    expect(caught).toBe(boom)
  })

  it('names the event and the count when several listeners fail', () => {
    const t = Thing.create({})
    t.on(EventType.afterSetValue, () => { throw new Error('a') })
    t.on(EventType.afterSetValue, () => { throw new Error('b') })
    expect(() => { t.v = 1 }).toThrow('2 listeners of "afterSetValue" failed')
  })

  it('once() unsubscribes itself, and the returned function removes a listener early', () => {
    const t = Thing.create({})
    let once = 0
    let early = 0
    t.once(EventType.afterSetValue, () => { once++ })
    const off = t.on(EventType.afterSetValue, () => { early++ })
    off()
    t.v = 1
    t.v = 2
    expect(once).toBe(1)
    expect(early).toBe(0)
  })

  it('listeners run parents first, then the class, then the instance', () => {
    class Root extends ActiveModel { @ActiveField() v: number = 0 }
    class Mid extends Root {}
    class Leaf extends Mid {}
    const order: string[] = []
    Root.on(EventType.afterSetValue, () => order.push('root'))
    Leaf.on(EventType.afterSetValue, () => order.push('leaf'))
    const leaf = Leaf.create({})
    leaf.on(EventType.afterSetValue, () => order.push('instance'))
    leaf.v = 1
    expect(order).toEqual(['root', 'leaf', 'instance'])
  })
})

describe('mapping registry', () => {
  it('hasMapping works statically and on instances, per source class', () => {
    class A extends ActiveModel { @ActiveField() v: number = 0 }
    class B extends ActiveModel { @ActiveField() v: number = 0 }
    const target = Symbol('t')
    A.mapTo(target, () => 'mapped')
    expect(A.hasMapping(target)).toBe(true)
    expect(A.create({}).hasMapping(target)).toBe(true)
    expect(B.hasMapping(target)).toBe(false)
    expect(A.create({}).mapTo(target)).toBe('mapped')
  })

  it('forwards extra arguments to the handler', () => {
    class A extends ActiveModel { @ActiveField() v: number = 1 }
    const target = Symbol('args')
    A.mapTo(target, (m, ...args) => [m.v, ...args])
    expect(A.create({}).mapTo(target, true, 'x', 2)).toEqual([1, 'x', 2])
  })
})
