/** Decides a pair of objects itself, or returns `undefined` to leave them to the generic comparison */
export type EqualityCustomizer = (a: object, b: object) => boolean | undefined

/**
 * Deep equality, adapted from `fast-deep-equal` (MIT, (c) 2017 Evgeny Poberezkin) with two changes:
 * the members of a `Set` are compared by content, not by identity (a set of models is never
 * identical to its clone, and `isTouched()` / `changes()` compare a model with a clone of itself),
 * and `custom` is asked about every pair of objects first.
 */
export const deepEqual = (a: any, b: any, custom?: EqualityCustomizer): boolean => {
  if (a === b) return true

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const verdict = custom?.(a, b)
    if (verdict !== undefined) return verdict
    if (a.constructor !== b.constructor) return false

    if (Array.isArray(a)) {
      if (a.length !== b.length) return false
      for (let i = a.length; i-- !== 0;) {
        if (!deepEqual(a[i], b[i], custom)) return false
      }
      return true
    }

    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false
      for (const key of a.keys()) {
        if (!b.has(key)) return false
      }
      for (const [key, value] of a) {
        if (!deepEqual(value, b.get(key), custom)) return false
      }
      return true
    }

    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false
      // members that are the very same object match at once; the rest are paired up by content
      const unmatched: unknown[] = []
      for (const member of b) {
        if (!a.has(member)) unmatched.push(member)
      }
      for (const member of a) {
        if (b.has(member)) continue
        const partner = unmatched.findIndex((candidate) => deepEqual(member, candidate, custom))
        if (partner < 0) return false
        unmatched.splice(partner, 1)
      }
      return true
    }

    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      // a DataView has no `length`: compare the bytes it covers
      const left = a instanceof DataView ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : (a as unknown as ArrayLike<unknown>)
      const right = b instanceof DataView ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : (b as unknown as ArrayLike<unknown>)
      if (left.length !== right.length) return false
      for (let i = left.length; i-- !== 0;) {
        if (left[i] !== right[i]) return false
      }
      return true
    }

    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf()
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString()

    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    for (let i = keys.length; i-- !== 0;) {
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false
    }
    for (let i = keys.length; i-- !== 0;) {
      if (!deepEqual(a[keys[i]], b[keys[i]], custom)) return false
    }
    return true
  }

  // true if both NaN, false otherwise
  return a !== a && b !== b
}
