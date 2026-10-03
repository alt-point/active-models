import { describe, it, expect } from 'vitest'
import { deepEqual } from '../src/equal'

describe('deepEqual', () => {
  it('treats primitives, NaN and identical references', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual(1, 2)).toBe(false)
    expect(deepEqual(NaN, NaN)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual('a', 'a')).toBe(true)
    const shared = {}
    expect(deepEqual(shared, shared)).toBe(true)
  })

  it('compares objects and arrays deeply, and refuses different shapes or classes', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
    class A { x = 1 }
    class B { x = 1 }
    expect(deepEqual(new A(), new B())).toBe(false)
    expect(deepEqual(new A(), new A())).toBe(true)
  })

  it('compares Maps by key and by value content', () => {
    expect(deepEqual(new Map([[1, { a: 1 }]]), new Map([[1, { a: 1 }]]))).toBe(true)
    expect(deepEqual(new Map([[1, { a: 1 }]]), new Map([[1, { a: 2 }]]))).toBe(false)
    expect(deepEqual(new Map([[1, 1]]), new Map([[2, 1]]))).toBe(false)
    expect(deepEqual(new Map([[1, 1]]), new Map())).toBe(false)
  })

  it('compares Sets by content, whatever the order - not by identity', () => {
    expect(deepEqual(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 2 }, { a: 1 }]))).toBe(true)
    expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 2 }]))).toBe(false)
    expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true)
    expect(deepEqual(new Set([1]), new Set([1, 2]))).toBe(false)
    expect(deepEqual(new Set(), new Set())).toBe(true)
    const shared = { a: 1 }
    expect(deepEqual(new Set([shared, { b: 1 }]), new Set([shared, { b: 1 }]))).toBe(true)
    // each member pairs with only one partner
    expect(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]))).toBe(false)
  })

  it('compares typed arrays, RegExps, Dates and valueOf/toString objects', () => {
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(deepEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false)
    expect(deepEqual(/a/g, /a/g)).toBe(true)
    expect(deepEqual(/a/g, /a/i)).toBe(false)
    expect(deepEqual(new Date(5), new Date(5))).toBe(true)
    expect(deepEqual(new Date(5), new Date(6))).toBe(false)
    expect(deepEqual(new URL('https://a.b/'), new URL('https://a.b/'))).toBe(true)
    expect(deepEqual(new URL('https://a.b/'), new URL('https://a.c/'))).toBe(false)
  })
})

describe('DataView', () => {
  it('compares the covered bytes instead of looping forever', () => {
    const bytes = (...values: number[]) => new DataView(new Uint8Array(values).buffer)
    expect(deepEqual(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true)
    expect(deepEqual(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false)
    expect(deepEqual(bytes(1, 2, 3), bytes(1, 2))).toBe(false)
    const buffer = new Uint8Array([9, 1, 2, 9]).buffer
    expect(deepEqual(new DataView(buffer, 1, 2), bytes(1, 2))).toBe(true)
    expect(deepEqual(new DataView(buffer, 0, 2), bytes(1, 2))).toBe(false)
  })
})
