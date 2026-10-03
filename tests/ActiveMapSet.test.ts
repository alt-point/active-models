import { describe, it, expect } from 'vitest'
import { ActiveModel } from '../src/ActiveModel'
import { ActiveField } from '../src/decorators'
import { EventType } from '../src/types'
import { ActiveCollection } from '../src/ActiveCollection'
import { ActiveMap } from '../src/ActiveMap'
import { ActiveSet } from '../src/ActiveSet'
import { isCollection } from '../src/collectionRegistry'
import { ValidationError } from '../src/pipeline'

class User extends ActiveModel {
  @ActiveField() id: number = 0
  @ActiveField() name: string = ''
  @ActiveField() email?: string
}
class Other extends ActiveModel {
  @ActiveField() id: number = 0
}

const issueOf = (fn: () => unknown) => {
  try { fn() } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    return (error as ValidationError).issues[0]
  }
  throw new Error('expected a ValidationError')
}

describe('ActiveCollection: unique', () => {
  const make = () => ActiveCollection.create(User, [{ id: 1, email: 'a' }, { id: 2, email: 'b' }], { unique: 'email' })

  it('refuses a duplicate key on every way in, atomically', () => {
    const users = make()
    expect(issueOf(() => users.push({ id: 3, email: 'a' }))).toEqual({
      path: '', code: 'unique', message: 'Duplicate key "a" in ActiveCollection<User>', value: 'a',
    })
    expect(() => users.push({ id: 4, email: 'c' }, { id: 5, email: 'c' })).toThrow(ValidationError)
    expect(() => users.unshift({ id: 6, email: 'b' })).toThrow(ValidationError)
    expect(() => users.splice(0, 0, { id: 7, email: 'b' })).toThrow(ValidationError)
    expect(() => { users[2] = { id: 8, email: 'a' } as any }).toThrow(ValidationError)
    expect(() => ActiveCollection.create(User, [{ email: 'x' }, { email: 'x' }], { unique: 'email' })).toThrow(ValidationError)
    expect(users.map((u) => u.email)).toEqual(['a', 'b'])
  })

  it('null and undefined keys are exempt; a key can be reused after the item left', () => {
    const users = make()
    users.push({ id: 3 }, { id: 4 })
    expect(users).toHaveLength(4)
    users.shift()
    users.push({ id: 9, email: 'a' })
    expect(users.map((u) => u.id)).toEqual([2, 3, 4, 9])
  })

  it('splice may replace an item with one that reuses its key', () => {
    const users = make()
    users.splice(0, 1, { id: 10, email: 'a' })
    expect(users.map((u) => u.id)).toEqual([10, 2])
    expect(() => users.splice(0, 1, { id: 11, email: 'b' })).toThrow(ValidationError)
    expect(users.map((u) => u.id)).toEqual([10, 2])
  })

  it('index replacement follows the same rules', () => {
    const users = make()
    users[0] = User.create({ id: 5, email: 'z' })
    expect(users.hasKey('a')).toBe(false)
    expect(users.hasKey('z')).toBe(true)
    const same = users[0]
    users[0] = same
    expect(() => { users[0] = User.create({ id: 6, email: 'b' }) }).toThrow(ValidationError)
    expect(users.map((u) => u.id)).toEqual([5, 2])
  })

  it('getByKey() and hasKey() are lookups by key, and need the option', () => {
    const users = make()
    expect(users.getByKey('b')!.id).toBe(2)
    expect(users.getByKey('zzz')).toBeUndefined()
    expect(users.hasKey('a')).toBe(true)
    expect(() => ActiveCollection.create(User).getByKey('a')).toThrow('need a collection created with unique')
    expect(() => ActiveCollection.create(User).hasKey('a')).toThrow(TypeError)
  })

  it('follows an item whose key changed, and releases keys on removal', () => {
    const users = make()
    users[0].email = 'renamed'
    expect(users.hasKey('a')).toBe(false)
    expect(users.getByKey('renamed')!.id).toBe(1)
    users.remove(users[0])
    expect(users.hasKey('renamed')).toBe(false)
    users.push({ id: 7, email: 'renamed' })
    expect(users.getByKey('renamed')!.id).toBe(7)
    users.clear()
    expect(users.hasKey('b')).toBe(false)
  })

  it('a key change onto a key another item holds is not prevented, and does not steal the entry', () => {
    const users = make()
    users[0].email = 'b'
    expect(users.getByKey('b')!.id).toBe(2)
    expect(users.hasKey('a')).toBe(false)
  })

  it('an unsorted unique collection refuses fill() and copyWithin(); works with sortBy and a function key', () => {
    const users = make()
    expect(() => users.fill(users[0])).toThrow('A unique ActiveCollection cannot be filled')
    expect(() => users.copyWithin(0, 1)).toThrow(/cannot be rearranged/)
    const sorted = ActiveCollection.create(User, [{ id: 2, name: 'B' }, { id: 1, name: 'A' }], { sortBy: 'id', unique: (u) => u.name.toLowerCase() })
    expect(() => sorted.push({ id: 3, name: 'a' })).toThrow(ValidationError)
    expect(sorted.map((u) => u.id)).toEqual([1, 2])
    expect(sorted.getByKey('b')!.id).toBe(2)
  })

  it('a clone keeps the unique option', () => {
    const copy = make().clone()
    expect(() => copy.push({ id: 9, email: 'a' })).toThrow(ValidationError)
  })
})

describe('ActiveMap', () => {
  const make = (items: unknown[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]) => ActiveMap.create(User, { key: 'id' }, items)

  it('stores instances under their own key, coerces plain data, and is a real Map', () => {
    const users = make()
    expect(users).toBeInstanceOf(Map)
    expect(isCollection(users)).toBe(true)
    expect(users.size).toBe(2)
    expect(users.get(1)).toBeInstanceOf(User)
    expect(users.get(1)!.name).toBe('a')
    expect(users.has(2)).toBe(true)
    expect(Array.from(users.keys())).toEqual([1, 2])
    expect(users.model).toBe(User)
    expect(Array.from(users, ([key, user]) => `${key}:${user.name}`)).toEqual(['1:a', '2:b'])
  })

  it('needs a model class and a key option', () => {
    expect(() => ActiveMap.create(class Plain {} as any, { key: 'id' })).toThrow('needs a class extending ActiveModel')
    expect(() => ActiveMap.create(User, {} as any)).toThrow('needs options.key')
    expect(() => ActiveMap.create(User, undefined as any)).toThrow(TypeError)
    expect(ActiveMap.create(User, { key: (u) => u.name }, [{ name: 'x' }]).has('x')).toBe(true)
  })

  it('set() checks the model and that the key is the item\'s own', () => {
    const users = make()
    users.set(3, { id: 3, name: 'c' })
    expect(users.get(3)!.name).toBe('c')
    expect(() => users.set(4, { id: 5 })).toThrow('key mismatch: stored under 4 but the item\'s key is 5')
    expect(() => users.set(9, 'x' as any)).toThrow('ActiveMap<User> accepts only User instances or plain objects, got string')
    expect(() => users.set(9, Other.create({ id: 9 }) as any)).toThrow(/got Other/)
    expect(users.size).toBe(3)
  })

  it('add() derives the key, is atomic, and refuses an item without a key', () => {
    const users = make()
    users.add({ id: 7 }, User.create({ id: 8 }))
    expect(Array.from(users.keys())).toEqual([1, 2, 7, 8])
    expect(() => users.add({ id: 9 }, 5 as any)).toThrow(TypeError)
    expect(users.has(9)).toBe(false)
    expect(() => ActiveMap.create(User, { key: 'email' }, [{ id: 1 }])).toThrow('needs a key for every item, got undefined')
  })

  it('setting a key that exists replaces the item and reports both', () => {
    const users = make()
    const old = users.get(1)!
    const events: string[] = []
    users.on(EventType.itemsRemoved, ({ items, keys }) => events.push(`-${(items as User[])[0].name}@${keys}`))
    users.on(EventType.itemsAdded, ({ items, keys }) => events.push(`+${(items as User[])[0].name}@${keys}`))
    users.set(1, { id: 1, name: 'new' })
    expect(events).toEqual(['-a@1', '+new@1'])
    old.name = 'ignored'
    users.set(1, users.get(1)!)
    expect(events).toHaveLength(2)
  })

  it('delete() and clear() report what left and return correctly', () => {
    const users = make()
    const events: string[] = []
    users.on(EventType.itemsRemoved, ({ items, keys }) => events.push(`${(items as User[]).map((u) => u.id)}|${keys}`))
    expect(users.delete(9)).toBe(false)
    expect(users.delete(1)).toBe(true)
    users.clear()
    users.clear()
    expect(events).toEqual(['1|1', '2|2'])
    expect(users.size).toBe(0)
  })

  it('an item that changes bubbles as touched, follows its key, and stops when removed', () => {
    const users = make()
    let touched = 0
    users.on(EventType.touched, ({ target }) => { if (target === users) touched++ })
    const first = users.get(1)!
    first.name = 'x'
    expect(touched).toBe(1)
    first.id = 10
    expect(users.has(1)).toBe(false)
    expect(users.get(10)).toBe(first)
    users.delete(10)
    const before = touched
    first.name = 'gone'
    expect(touched).toBe(before)
  })

  it('a key change onto an occupied key displaces the other item', () => {
    const users = make()
    const removed: number[] = []
    users.on(EventType.itemsRemoved, ({ items }) => removed.push(...(items as User[]).map((u) => u.id)))
    const first = users.get(1)!
    const second = users.get(2)!
    first.id = 2
    expect(users.get(2)).toBe(first)
    expect(users.size).toBe(1)
    expect(removed).toEqual([2])
    second.name = 'orphan'
  })

  it('a key changed to null leaves the map', () => {
    const users = ActiveMap.create(User, { key: 'email' }, [{ id: 1, email: 'a' }])
    users.get('a')!.email = undefined
    expect(users.size).toBe(0)
  })

  it('once(), unsubscribing and static on() work', () => {
    const users = make()
    let once = 0
    let off = 0
    users.once(EventType.itemsAdded, () => { once++ })
    const unsubscribe = users.on(EventType.itemsAdded, () => { off++ })
    unsubscribe()
    users.add({ id: 5 })
    users.add({ id: 6 })
    expect([once, off]).toEqual([1, 0])
    class Users extends ActiveMap<User> {}
    let seen = 0
    Users.on(EventType.itemsAdded, () => { seen++ })
    Users.once(EventType.touched, () => { seen += 10 })
    ;(ActiveMap.create as any).call(Users, User, { key: 'id' }, [{ id: 1 }])
    expect(seen).toBe(11)
  })

  it('clone() deep-copies items; toJSON() is an object keyed by the key', () => {
    const users = make()
    const copy = users.clone()
    expect(copy.get(1)).not.toBe(users.get(1))
    copy.get(1)!.name = 'changed'
    expect(users.get(1)!.name).toBe('a')
    expect(JSON.parse(JSON.stringify(users))).toEqual({ 1: { id: 1, name: 'a' }, 2: { id: 2, name: 'b' } })
  })
})

describe('ActiveSet', () => {
  const make = (items: unknown[] = [{ id: 1 }, { id: 2 }], options = {}) => ActiveSet.create(User, items, options)

  it('holds instances of its model, coerces plain data, dedupes by identity', () => {
    const users = make()
    expect(users).toBeInstanceOf(Set)
    expect(isCollection(users)).toBe(true)
    expect(users.size).toBe(2)
    const first = Array.from(users)[0]
    users.add(first)
    expect(users.size).toBe(2)
    expect(users.has(first)).toBe(true)
    expect(users.model).toBe(User)
  })

  it('refuses anything else, atomically', () => {
    const users = make()
    expect(() => users.add(5 as any)).toThrow('ActiveSet<User> accepts only User instances or plain objects, got number')
    expect(() => users.add(Other.create({}) as any)).toThrow(/got Other/)
    expect(() => users.addAll([{ id: 8 }, 'x' as any])).toThrow(TypeError)
    expect(users.size).toBe(2)
    expect(() => ActiveSet.create(class Plain {} as any)).toThrow('needs a class extending ActiveModel')
    expect(ActiveSet.create(User).size).toBe(0)
    expect(() => make([{ id: 1 }], { coerce: false })).toThrow(TypeError)
  })

  it('add / delete / clear emit itemsAdded, itemsRemoved and touched, and only when something happened', () => {
    const users = make([])
    const log: string[] = []
    users.on(EventType.itemsAdded, ({ items }) => log.push(`+${(items as User[]).map((u) => u.id)}`))
    users.on(EventType.itemsRemoved, ({ items }) => log.push(`-${(items as User[]).map((u) => u.id)}`))
    users.on(EventType.touched, () => log.push('touched'))
    users.addAll([{ id: 1 }, { id: 2 }])
    const [first] = users
    users.add(first)
    users.addAll([])
    expect(users.delete(Other.create({}) as any)).toBe(false)
    users.delete(first)
    users.clear()
    users.clear()
    expect(log).toEqual(['+1,2', 'touched', '-1', 'touched', '-2', 'touched'])
  })

  it('unique refuses a second item with the same key, and offers lookups', () => {
    const users = make([{ id: 1, email: 'a' }, { id: 2, email: 'b' }], { unique: 'email' })
    expect(issueOf(() => users.add({ id: 3, email: 'a' }))).toMatchObject({ code: 'unique', message: 'Duplicate key "a" in ActiveSet<User>' })
    expect(() => users.addAll([{ id: 4, email: 'c' }, { id: 5, email: 'c' }])).toThrow(ValidationError)
    users.addAll([{ id: 6 }, { id: 7 }])
    expect(users.size).toBe(4)
    expect(users.getByKey('a')!.id).toBe(1)
    expect(users.hasKey('b')).toBe(true)
    users.delete(users.getByKey('a')!)
    expect(users.hasKey('a')).toBe(false)
    users.add({ id: 8, email: 'a' })
    users.getByKey('a')!.email = 'moved'
    expect(users.hasKey('a')).toBe(false)
    expect(users.hasKey('moved')).toBe(true)
    users.clear()
    expect(users.hasKey('moved')).toBe(false)
    expect(() => make().getByKey('x')).toThrow('need a set created with unique')
    expect(() => make().hasKey('x')).toThrow(TypeError)
  })

  it('an item that changes bubbles as touched and stops when it leaves', () => {
    const users = make()
    let touched = 0
    users.on(EventType.touched, () => { touched++ })
    const [first] = users
    first.name = 'x'
    expect(touched).toBe(1)
    users.delete(first)
    expect(touched).toBe(2)
    first.name = 'y'
    expect(touched).toBe(2)
  })

  it('a key change onto a taken key is not prevented and does not steal the entry', () => {
    const users = make([{ id: 1, email: 'a' }, { id: 2, email: 'b' }], { unique: 'email' })
    const [first] = users
    first.email = 'b'
    expect(users.getByKey('b')!.id).toBe(2)
    expect(users.hasKey('a')).toBe(false)
  })

  it('once(), unsubscribing and static on() work', () => {
    const users = make([])
    let once = 0
    let off = 0
    users.once(EventType.itemsAdded, () => { once++ })
    const unsubscribe = users.on(EventType.itemsAdded, () => { off++ })
    unsubscribe()
    users.add({ id: 1 })
    users.add({ id: 2 })
    expect([once, off]).toEqual([1, 0])
    class Users extends ActiveSet<User> {}
    let seen = 0
    Users.on(EventType.itemsAdded, () => { seen++ })
    Users.once(EventType.touched, () => { seen += 10 })
    ;(ActiveSet.create as any).call(Users, User, [{ id: 1 }])
    expect(seen).toBe(11)
  })

  it('clone() deep-copies and keeps the options; toJSON() is an array', () => {
    const users = make([{ id: 1, email: 'a' }], { unique: 'email' })
    const copy = users.clone()
    expect(Array.from(copy)[0]).not.toBe(Array.from(users)[0])
    expect(() => copy.add({ id: 2, email: 'a' })).toThrow(ValidationError)
    expect(JSON.parse(JSON.stringify(users))).toEqual([{ id: 1, name: '', email: 'a' }])
  })
})

describe('containers on a model', () => {
  class Team extends ActiveModel {
    @ActiveField() name: string = ''
    @ActiveField({ container: ActiveMap.field(User, { key: 'id' }) }) byId!: ActiveMap<User>
    @ActiveField({ container: ActiveSet.field(User) }) members!: ActiveSet<User>
    @ActiveField({ container: ActiveSet.field(User, { unique: 'email' }) }) unique!: ActiveSet<User>
    @ActiveField({ container: ActiveCollection.field(User, { unique: 'email' }) }) list!: ActiveCollection<User>
  }

  it('converts arrays (and Maps, objects, Sets), defaults to empty ones, and treats null as empty', () => {
    const team = Team.create({
      byId: [{ id: 1 }],
      members: [{ id: 2 }],
    })
    expect(team.byId).toBeInstanceOf(ActiveMap)
    expect(team.byId.get(1)).toBeInstanceOf(User)
    expect(team.members).toBeInstanceOf(ActiveSet)
    expect(team.unique.size).toBe(0)
    expect(team.list).toHaveLength(0)
    team.byId = new Map([[5, { id: 5 }]]) as any
    expect(Array.from(team.byId.keys())).toEqual([5])
    team.byId = { a: { id: 6 }, b: { id: 7 } } as any
    expect(Array.from(team.byId.keys())).toEqual([6, 7])
    team.byId = null as any
    expect(team.byId.size).toBe(0)
    team.members = new Set([{ id: 9 }]) as any
    expect(Array.from(team.members)[0].id).toBe(9)
    expect(() => { team.byId = 5 as any }).toThrow('A map of User expects an array, a Map or an object, got number')
    expect(() => { team.members = 5 as any }).toThrow('A set of User expects an array, got number')
  })

  it('keeps a container of the same kind and model as is, refuses a foreign one', () => {
    const team = Team.create({})
    const ready = ActiveMap.create(User, { key: 'id' }, [{ id: 1 }])
    team.byId = ready
    expect(team.byId).toBe(ready)
    const set = ActiveSet.create(User)
    team.members = set
    expect(team.members).toBe(set)
    expect(() => { team.byId = ActiveMap.create(Other, { key: 'id' }, [{ id: 2 }]) as any }).toThrow(TypeError)
    expect(() => { team.members = ActiveSet.create(Other, [{ id: 2 }]) as any }).toThrow(TypeError)
    expect(team.byId).toBe(ready)
  })

  it('a change anywhere inside bubbles up as the team touched', () => {
    const team = Team.create({ byId: [{ id: 1 }], members: [{ id: 2 }], list: [{ id: 3 }] })
    let touched = 0
    team.on(EventType.touched, () => { touched++ })
    team.byId.get(1)!.name = 'x'
    Array.from(team.members)[0].name = 'y'
    team.list[0].name = 'z'
    team.byId.add({ id: 4 })
    team.members.add({ id: 5 })
    team.list.push({ id: 6 })
    expect(touched).toBe(6)
  })

  it('serializes, clones and tracks like nested models', () => {
    const team = Team.create({ name: 't', byId: [{ id: 1 }], members: [{ id: 2 }] }, { tracked: true })
    expect(JSON.parse(JSON.stringify(team))).toEqual({
      name: 't',
      byId: { 1: { id: 1, name: '' } },
      members: [{ id: 2, name: '' }],
      unique: [],
      list: [],
    })
    expect(team.isTouched()).toBe(false)
    team.byId.add({ id: 9 })
    expect(team.isTouched()).toBe(true)
    expect(Object.keys(team.changes())).toEqual(['byId'])

    const copy = team.clone()
    expect(copy.byId).not.toBe(team.byId)
    expect(copy.byId.get(1)).not.toBe(team.byId.get(1))
    let touched = 0
    copy.on(EventType.touched, () => { touched++ })
    copy.byId.get(1)!.name = 'c'
    copy.members.add({ id: 3 })
    expect(touched).toBe(2)
    expect(team.members.size).toBe(1)

    team.revert('byId')
    expect(team.byId.size).toBe(1)
    expect(team.isTouched()).toBe(false)
  })

  it('validate() recurses into the items of a map and a set', () => {
    class Item extends ActiveModel { @ActiveField({ required: true }) label?: string }
    class Bag extends ActiveModel {
      @ActiveField({ container: ActiveMap.field(Item, { key: 'label' }) }) items!: ActiveMap<Item>
    }
    expect(Bag.create({}).validate().valid).toBe(true)
  })

  it('cannot combine a container with factory on one field, and refuses a foreign descriptor', () => {
    expect(() => {
      class Bad extends ActiveModel {
        @ActiveField({ factory: User, container: ActiveMap.field(User, { key: 'id' }) }) x?: unknown
      }
      return Bad
    }).toThrow('Field "x": use either factory or container, not both')
    expect(() => {
      class Bad extends ActiveModel {
        @ActiveField({ container: User as never }) x?: unknown
      }
      return Bad
    }).toThrow('Field "x": container must come from ActiveCollection.field(), ActiveMap.field() or ActiveSet.field()')
  })
})
