import { describe, it, expect } from 'vitest'
import { ActiveModel } from '../src/ActiveModel'
import { ActiveField } from '../src/decorators'
import { EventType } from '../src/types'
import { getValue, isComplexValue, isNull, isPOJOSSafetyValue, isPrimitiveValue, isSymbol, traverse } from '../src/utils'

/** Tests written from surviving mutants of the Stryker run: each one pins behavior nothing else did. */

describe('a model without any declared fields', () => {
  class Empty extends ActiveModel {}

  it('creates, fills and serializes without registries', () => {
    const empty = Empty.create({ a: 1 })
    expect(Object.keys(empty)).toEqual([])
    expect(empty.fill({ b: 2 })).toBe(empty)
    expect(empty.toJSON()).toEqual({})
    expect(Reflect.ownKeys(empty)).toEqual([])
  })

  it('create() and new Model() never adopt unknown keys; fill(force) does', () => {
    class Known extends ActiveModel {
      @ActiveField() a: number = 0
    }
    expect((Known.create({ a: 1, extra: 1 } as any) as any).extra).toBeUndefined()
    expect((new Known({ a: 1, extra: 1 } as any) as any).extra).toBeUndefined()
    expect((Known.create({}).fill({ extra: 1 } as any, true) as any).extra).toBe(1)
  })
})

describe('primitive source data', () => {
  class WithDefault extends ActiveModel {
    @ActiveField({ value: 'dflt' }) name: string = ''
  }

  it.each([['a string', 'text'], ['a number', 5], ['null', null], ['undefined', undefined], ['a boolean', true]])(
    'create() treats %s as empty data and still applies defaults',
    (_label, value) => {
      expect(WithDefault.create(value as any).name).toBe('dflt')
    }
  )

  it('new Model() does too', () => {
    expect(new WithDefault('text' as any).name).toBe('')
  })
})

describe('create variants: defaults and lazy sharing', () => {
  class Box extends ActiveModel {
    @ActiveField() tags: string[] = []
  }

  it('createLazy and createFromCollectionLazy keep references to the source data', () => {
    const one = { tags: ['a'] }
    Box.createLazy(one).tags.push('b')
    expect(one.tags).toEqual(['a', 'b'])

    const many = [{ tags: ['a'] }]
    Box.createFromCollectionLazy(many)[0].tags.push('b')
    expect(many[0].tags).toEqual(['a', 'b'])

    const asyncOne = { tags: ['a'] }
    return Box.asyncCreateLazy(Promise.resolve(asyncOne)).then((box) => {
      box.tags.push('b')
      expect(asyncOne.tags).toEqual(['a', 'b'])
    })
  })

  it('every non-lazy variant cuts references by default and rebuilds an existing instance', async () => {
    const existing = Box.create({ tags: ['a'] })
    const source = () => ({ tags: ['a'] })

    const s1 = source(); Box.createFromCollection([s1])[0].tags.push('x')
    const s2 = source(); (await Box.asyncCreate(Promise.resolve(s2))).tags.push('x')
    const s3 = source(); (await Box.asyncCreateFromCollection(Promise.resolve([s3])))[0].tags.push('x')
    expect([s1.tags, s2.tags, s3.tags]).toEqual([['a'], ['a'], ['a']])

    expect(await Box.asyncCreate(Promise.resolve(existing))).not.toBe(existing)
    expect((await Box.asyncCreateFromCollection(Promise.resolve([existing])))[0]).not.toBe(existing)
    expect(Box.createFromCollection([existing])[0]).not.toBe(existing)
  })

  it('asyncCreateLazy / asyncCreateFromCollectionLazy return existing instances untouched', async () => {
    const existing = Box.create({})
    expect(await Box.asyncCreateLazy(Promise.resolve(existing))).toBe(existing)
    expect((await Box.asyncCreateFromCollectionLazy(Promise.resolve([existing])))[0]).toBe(existing)
  })

  it('new Model(data) cuts references to the source', () => {
    class Bare extends ActiveModel {
      @ActiveField() tags!: string[]
    }
    const source = { tags: ['a'] }
    const bare = new Bare(source)
    bare.tags.push('b')
    expect(source.tags).toEqual(['a'])
    expect(bare.tags).toEqual(['a', 'b'])
  })
})

describe('fields registered by options alone', () => {
  it('a field with only fillable:false and protected:false is still an active field', () => {
    class Locked extends ActiveModel {
      @ActiveField({ fillable: false, protected: false }) v: number = 1
    }
    expect(Locked.create({ v: 2 }).v).toBe(1)
    expect(() => { Locked.create({}).v = 3 }).toThrow()
  })
})

describe('clone() keeps the locks', () => {
  class Doc extends ActiveModel {
    @ActiveField({ fillable: false }) locked: string = 'l'
    @ActiveField({ readonly: true }) id: string = ''
  }

  it('a clone still refuses writes to fillable:false and readonly fields', () => {
    const copy = Doc.create({ id: '1' }).clone()
    expect(() => { copy.locked = 'x' }).toThrow()
    copy.id = 'other'
    expect(copy.id).toBe('1')
  })
})

describe('touched bubbling payload', () => {
  it('a bubbled touched reports the parent as target', () => {
    class Child extends ActiveModel { @ActiveField() n: number = 0 }
    class Parent extends ActiveModel { @ActiveField({ factory: Child }) child?: Child }
    const parent = Parent.create({ child: { n: 1 } })
    const targets: unknown[] = []
    parent.on(EventType.touched, ({ target }) => targets.push(target))
    parent.child!.n = 2
    expect(targets).toEqual([parent])
    expect(targets[0]).toBe(parent)
  })
})

describe('getter-only fields', () => {
  it('are listed by Reflect.ownKeys even without a stored value', () => {
    class Person extends ActiveModel {
      @ActiveField() first: string = 'A'
      @ActiveField({ getter: (m) => `${Reflect.get(m, 'first')}!` }) shout?: string
    }
    expect(Reflect.ownKeys(Person.create({}))).toEqual(['first', 'shout'])
  })
})

describe('hidden fields and Proxy invariants', () => {
  class Vault extends ActiveModel {
    @ActiveField() name: string = 'n'
    @ActiveField({ hidden: true }) token: string = 't'
  }

  it('a non-extensible target cannot hide a property: `in` reports it instead of throwing', () => {
    const vault = Vault.create({})
    Object.preventExtensions(vault)
    expect(() => 'token' in vault).not.toThrow()
    expect('token' in vault).toBe(true)
  })

  it('a non-configurable hidden property is reported too', () => {
    const vault = Vault.create({})
    Object.defineProperty(vault, 'token', { value: 'fixed', configurable: false, writable: true })
    expect(() => 'token' in vault).not.toThrow()
    expect('token' in vault).toBe(true)
    expect(Object.getOwnPropertyDescriptor(vault, 'token')?.value).toBe('fixed')
  })
})

describe('the creating flag never leaks', () => {
  it('a subclass constructor that throws before super() does not leave later models raw', () => {
    class Broken extends ActiveModel {
      constructor () {
        if (Date.now() > 0) throw new Error('before super')
        super()
      }
    }
    class Fine extends ActiveModel {
      @ActiveField({ validator: (_m, _p, v) => { if (v === 'bad') throw new Error('checked') } }) v: string = ''
    }
    expect(() => Broken.create({})).toThrow('before super')
    expect(() => { new Fine({}).v = 'bad' }).toThrow('checked')
  })
})

describe('tracking snapshots do not freeze user functions', () => {
  it('a function value stays usable and unfrozen', () => {
    const callback = () => 1
    class Job extends ActiveModel {
      @ActiveField() run: () => number = callback
    }
    const job = Job.create({ run: callback }, { tracked: true })
    expect(Object.isFrozen(callback)).toBe(false)
    expect(job.run()).toBe(1)
  })
})

describe('toJSON() of plain structures', () => {
  it('serializes plain objects and arrays of them through the static helper', () => {
    expect(ActiveModel.toJSON({ a: 1, b: [{ c: null }] })).toEqual({ a: 1, b: [{ c: null }] })
    expect(ActiveModel.toJSON([{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('utils', () => {
  it('getValue() calls a function and passes anything else through', () => {
    expect(getValue(() => 5)).toBe(5)
    expect(getValue('x')).toBe('x')
    expect(getValue(undefined)).toBeUndefined()
  })

  it('isComplexValue / isPrimitiveValue / isNull classify values', () => {
    expect(isComplexValue({})).toBe(true)
    expect(isComplexValue([])).toBe(true)
    expect(isComplexValue('x')).toBe(false)
    expect(isComplexValue(null)).toBe(false)
    expect(isPrimitiveValue('x')).toBe(true)
    expect(isPrimitiveValue(null)).toBe(true)
    expect(isPrimitiveValue({})).toBe(false)
    expect(isNull(null)).toBe(true)
    expect(isNull(undefined)).toBe(false)
  })

  it('isSymbol() recognises boxed symbols too', () => {
    expect(isSymbol(Symbol('s'))).toBe(true)
    expect(isSymbol(Object(Symbol('s')))).toBe(true)
    expect(isSymbol({})).toBe(false)
    expect(isSymbol('s')).toBe(false)
    expect(isSymbol(null)).toBe(false)
  })

  it('isPOJOSSafetyValue() rejects only functions and symbols', () => {
    expect(isPOJOSSafetyValue(() => 1)).toBe(false)
    expect(isPOJOSSafetyValue(Symbol('s'))).toBe(false)
    expect(isPOJOSSafetyValue(0)).toBe(true)
    expect(isPOJOSSafetyValue(null)).toBe(true)
    expect(isPOJOSSafetyValue({})).toBe(true)
  })

  it('traverse() visits the root and every nested complex value, skips primitives', () => {
    const leaf = { z: 1 }
    const root = { a: { b: leaf }, list: [leaf, 'x', 5], n: 1 }
    const visited: unknown[] = []
    traverse(root, (node) => visited.push(node))
    expect(visited).toContain(root)
    expect(visited).toContain(root.a)
    expect(visited).toContain(root.list)
    expect(visited.filter((v) => v === leaf).length).toBeGreaterThanOrEqual(1)
    expect(visited.every((v) => typeof v === 'object')).toBe(true)
    expect(() => traverse(null, () => { throw new Error('never') })).not.toThrow()
  })
})

describe('emitter details', () => {
  class Thing extends ActiveModel {
    @ActiveField() v: number = 0
  }

  it('the function returned by once() unsubscribes before it ever fires', () => {
    const thing = Thing.create({})
    let calls = 0
    const off = thing.once(EventType.afterSetValue, () => { calls++ })
    off()
    thing.v = 1
    expect(calls).toBe(0)
  })
})

describe('decorator misconfiguration messages', () => {
  it('a non-ActiveModel factory names the property in the error', () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(() => {
        class Bad extends ActiveModel {
          @ActiveField({ factory: class NotModel {} as any }) z?: unknown
        }
        return Bad
      }).toThrow('Model factory for prop "z" must be instanceof ActiveModel!')
    } finally {
      console.warn = warn
    }
  })

  it('a list factory with a missing model throws a ReferenceError from @ActiveField too', () => {
    expect(() => {
      class Bad extends ActiveModel {
        @ActiveField({ factory: [undefined as any] }) list?: unknown
      }
      return Bad
    }).toThrow('Missing required factory model for prop "list"!')
  })

  it('an undefined hook in on{} is ignored instead of throwing', () => {
    class Quiet extends ActiveModel {
      @ActiveField({ on: { afterSetValue: undefined } }) v: number = 0
    }
    expect(() => { Quiet.create({}).v = 1 }).not.toThrow()
  })
})
