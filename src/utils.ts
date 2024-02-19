import { ActiveModel } from "./ActiveModel"

export function getValue<T> (data?: () => T | T): T | undefined {
  if (typeof data === "function") {
    return data();
  }
  return data;
}

export type primitiveType = string | boolean | null | symbol | number | undefined | bigint

export function checkComplexValue (value: unknown): value is {} {
  return Boolean(value && Object(value) === value);
}

export function checkPrimitiveValue (
  value: unknown
): value is primitiveType {
  return !checkComplexValue(value);
}
export function traverse (root: any, action: (data: {}) => void) {
  if (!root) return

  const nodes = [] as Array<{}>
  let current: undefined | {[k: string | number]: any} = root

  while (current) {
    action(current)

    Object.keys(current).forEach(key => {
      if (checkComplexValue(current![key])) {
        nodes.push(current![key])
      }
    })

    current = nodes.pop()
  }
}

export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends Record<any, any>? RecursivePartial<T[P]> : T[P]
}

export type StaticContainers = '__getters__' | '__setters__' | '__attributes__' | '__validators__' | '__fillable__' | '__protected__' | '__readonly__' | '__hidden__' | '__activeFields__'
export type BaseMethods = 'clone' | 'clone' | 'emit' | 'fill' | 'isTouched' | 'makeFreeze' | 'on' | 'once' | 'startTracking' | 'toJSON' | 'emitter'
export type ProtectedFields = StaticContainers | BaseMethods
export type ModelProperties<T extends typeof ActiveModel> = Omit<InstanceType<T>, ProtectedFields>

export type RecursivePartialActiveModel<T> = {
  [P in keyof T]?: T[P] extends ActiveModel? RecursivePartialActiveModel<Omit<T[P], ProtectedFields>> : T[P]
}

