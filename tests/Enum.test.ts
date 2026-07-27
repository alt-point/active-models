import { describe, expect, it } from 'vitest'
import { Enum } from '../src'

describe('Enum (deprecated)', () => {
  it('exposes the configured values and default', () => {
    const statuses = new Enum(['new', 'complete', 'shipping'], 'new')
    expect(statuses.values()).toEqual(['new', 'complete', 'shipping'])
    expect(statuses.default).toBe('new')
  })

  it('get() and has() look up entries by key', () => {
    const statuses = new Enum(['new', 'complete'])
    expect(statuses.has('new')).toBe(true)
    expect(statuses.has('missing')).toBe(false)
    expect(statuses.has(undefined)).toBe(false)
    expect(statuses.get('new')).toBe('new')
    expect(statuses.get('missing')).toBeUndefined()
  })

  it('keys() and entries() mirror the constructed values', () => {
    const statuses = new Enum(['a', 'b'])
    expect(statuses.keys()).toEqual(['a', 'b'])
    expect(statuses.entries()).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ])
  })

  it('validate() passes for a known value and throws for an unknown one', () => {
    const statuses = new Enum(['new', 'complete', 'shipping'])
    expect(statuses.validate('new')).toBe(true)
    expect(() => statuses.validate('bogus')).toThrow(/Value must be include one of type/)
  })

  it('validate() checks every item when given an array', () => {
    const statuses = new Enum(['a', 'b'])
    expect(statuses.validate(['a', 'b'])).toBe(true)
    expect(() => statuses.validate(['a', 'bogus'])).toThrow()
  })
})
