import { ActiveModel } from './ActiveModel'

export function getValue<T> (data?: T | (() => T) | undefined) {
  if (typeof data === 'function') {
    // @ts-ignore
    return data()
  }
  return data
}

export type primitiveType =
  | string
  | boolean
  | null
  | symbol
  | number
  | undefined
  | bigint

/**
 *
 * @param value
 */
export function isComplexValue (value: unknown): value is {} {
  return Boolean(value && Object(value) === value)
}

/**
 * checking whether the value is a primitive (no complex)
 * @param value
 */
export function isPrimitiveValue (value: unknown): value is primitiveType {
  return !isComplexValue(value)
}

export function traverse (root: any, action: (data: {}) => void) {
  if (!root) return

  const nodes = [] as Array<{}>
  let current: undefined | { [k: string | number]: any } = root

  while (current) {
    action(current)

    Object.keys(current).forEach((key) => {
      if (isComplexValue(current![key])) {
        nodes.push(current![key])
      }
    })

    current = nodes.pop()
  }
}

/**
 * checking whether the value is a Null
 * @param value
 */
export const isNull = (value: unknown) => {
  return value === null
}

/**
 * checking whether the value is a function
 * @param value
 */
export const isFunction = (value: unknown) => {
  return typeof value === 'function'
}

/**
 * checking whether the value is a symbol
 * @param value
 */
export const isSymbol = (value: unknown) => {
  return (
    typeof value === 'symbol' ||
    (typeof value === 'object' &&
      Object.prototype.toString.call(value) === '[object Symbol]')
  )
}

/**
 * checking whether the value is a POGOs safety data
 * @param value
 */
export const isPOJOSSafetyValue = (value: unknown) => {
  return !isFunction(value) && !isSymbol(value)
}

export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends Record<any, any> ? RecursivePartial<T[P]> : T[P]
}

export type StaticContainers =
  | '__getters__'
  | '__setters__'
  | '__attributes__'
  | '__validators__'
  | '__fillable__'
  | '__protected__'
  | '__readonly__'
  | '__hidden__'
  | '__activeFields__'
export type BaseMethods =
  | 'clone'
  | 'clone'
  | 'emit'
  | 'fill'
  | 'isTouched'
  | 'makeFreeze'
  | 'on'
  | 'once'
  | 'startTracking'
  | 'toJSON'
  | 'emitter'
  | 'hasMapping'
  | 'mapTo'
export type ProtectedFields = StaticContainers | BaseMethods
export type ModelProperties<T extends typeof ActiveModel> = Omit<
  InstanceType<T>,
  ProtectedFields
>

export type RecursivePartialActiveModel<T> = {
  [P in keyof T]?: T[P] extends ActiveModel
  ? RecursivePartialActiveModel<Omit<T[P], ProtectedFields>>
  : T[P]
}
