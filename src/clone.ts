/**
 * Deep clone with a customizer - the two lodash functions this library used (`cloneDeep`, `cloneDeepWith`),
 * without the 14 KB of lodash internals. Same rules: prototypes, own enumerable string and symbol keys, `Date`,
 * `RegExp`, `Map`, `Set`, typed arrays and boxed primitives are copied, circular references are kept, anything
 * that cannot be copied (functions, errors, `WeakMap`, promises...) is shared by reference.
 */

/** Return anything but `undefined` to use it instead of the default copy; `parent` is `undefined` for the root. */
export type CloneCustomizer = (value: any, key: any, parent: unknown) => unknown

const toTag = (value: object): string => Object.prototype.toString.call(value)

const ownEnumerableKeys = (value: object): Array<string | symbol> =>
  Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key))

const assign = (target: object, key: string | symbol, value: unknown) => {
  // Stryker disable next-line ConditionalExpression: defining a normal key with defineProperty gives the same property as assigning it
  if (key === '__proto__') {
    Object.defineProperty(target, key, { configurable: true, enumerable: true, value, writable: true })
  } else {
    (target as Record<string | symbol, unknown>)[key] = value
  }
}

const copyBuffer = (buffer: ArrayBuffer): ArrayBuffer => buffer.slice(0)

const cloneNode = (
  value: any,
  key: unknown,
  parent: unknown,
  customizer: CloneCustomizer | undefined,
  seen: WeakMap<object, unknown>
): unknown => {
  if (customizer) {
    const custom = customizer(value, key, parent)
    if (custom !== undefined) {
      return custom
    }
  }
  // Stryker disable next-line ConditionalExpression: without the `null` test, null falls through to the default case and is returned as is
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if (seen.has(value)) {
    return seen.get(value)
  }
  const visit = (child: unknown, childKey: unknown) => cloneNode(child, childKey, value, customizer, seen)

  if (Array.isArray(value)) {
    const result = new (value.constructor as ArrayConstructor)(value.length)
    seen.set(value, result)
    for (let i = 0; i < value.length; i++) {
      result[i] = visit(value[i], i)
    }
    return result
  }

  const tag = toTag(value)
  switch (tag) {
    case '[object Date]':
      return new value.constructor(value.getTime())
    case '[object RegExp]': {
      const result = new value.constructor(value.source, value.flags)
      result.lastIndex = value.lastIndex
      return result
    }
    case '[object Boolean]':
    case '[object Number]':
    case '[object String]':
      return new value.constructor(value.valueOf())
    case '[object Symbol]':
      return Object(Symbol.prototype.valueOf.call(value))
    case '[object ArrayBuffer]':
      return copyBuffer(value)
    case '[object DataView]':
      return new DataView(copyBuffer(value.buffer), value.byteOffset, value.byteLength)
    case '[object Map]': {
      const result = new value.constructor()
      seen.set(value, result)
      value.forEach((child: unknown, childKey: unknown) => result.set(childKey, visit(child, childKey)))
      return result
    }
    case '[object Set]': {
      const result = new value.constructor()
      seen.set(value, result)
      value.forEach((child: unknown) => result.add(visit(child, child)))
      return result
    }
    case '[object Object]':
    case '[object Arguments]':
      break
    default:
      if (ArrayBuffer.isView(value)) {
        return new (value.constructor as new (buffer: ArrayBuffer, offset: number, length: number) => unknown)(
          copyBuffer(value.buffer as ArrayBuffer), value.byteOffset, (value as unknown as ArrayLike<unknown>).length
        )
      }
      // functions, errors, WeakMap, promises...: not copyable
      return value
  }

  const result = Object.create(Object.getPrototypeOf(value))
  seen.set(value, result)
  for (const own of ownEnumerableKeys(value)) {
    assign(result, own, visit(value[own], own))
  }
  return result
}

/** A deep copy of `value`; `customizer` may take over any node (see {@link CloneCustomizer}). */
export const cloneDeepWith = <T>(value: T, customizer?: CloneCustomizer): T =>
  cloneNode(value, undefined, undefined, customizer, new WeakMap()) as T

export const cloneDeep = <T>(value: T): T => cloneDeepWith(value)
