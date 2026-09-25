import { describe, it, expect } from 'vitest'
import { ActiveModel, ActiveField, EventType } from '../src'

/** The quick-start example from README.md, verified line by line. */
describe('README quick start', () => {
  it('behaves exactly as the README claims', () => {
    class Address extends ActiveModel {
      @ActiveField() city: string = ''
    }
    class User extends ActiveModel {
      @ActiveField({ readonly: true }) id: string = ''
      @ActiveField({ validator: (_m, prop, v) => { if (!v) throw new TypeError(`${prop} is required`) } })
      name: string = 'Guest'
      @ActiveField({ hidden: true }) passwordHash: string = ''
      @ActiveField({ factory: Address }) address?: Address
    }

    const audited: string[] = []
    User.on(EventType.created, ({ target }) => audited.push((target as User).id))

    const user = User.create({ id: '1', name: 'Ann', address: { city: 'Berlin' } }, { tracked: true })
    const log: string[] = []
    user.on(EventType.afterSetValue, ({ prop, value }) => log.push(`${String(prop)} → ${value}`))
    let bubbled = 0
    user.on(EventType.touched, () => { bubbled++ })

    user.name = 'Bob'
    expect(() => { user.name = '' }).toThrow('name is required')
    user.id = '2'
    user.address!.city = 'Munich'

    expect(log).toEqual(['name → Bob'])
    expect(user.id).toBe('1')
    expect(bubbled).toBe(2)
    expect(user.isTouched()).toBe(true)
    expect(JSON.stringify(user)).toBe('{"id":"1","name":"Bob","address":{"city":"Munich"}}')
    expect(audited).toEqual(['1'])
  })
})
