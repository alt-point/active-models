import { ActiveModel } from './ActiveModel'
import deepEqual from 'fast-deep-equal/es6'
import { cloneDeep } from "lodash"
type State = {
  creating: boolean
  isDirty: boolean
  initialState?: ActiveModel | undefined
  raw?: any,
}

/**
 * Shared state of model, for use in life cycle
 */
const sharedState = new WeakMap<ActiveModel,State>()

/**
 * registry of sanitized values
 */
export const sanitizedValues = new WeakSet()

let creating = false

/**
 * Mark value as sanitized
 * @param value
 */
export function markSanitized (value: {}) {
  sanitizedValues.add(value)
}

/**
 * Unmark value as sanitized
 * @param value
 */
export function unmarkSanitized (value: {}) {
  sanitizedValues.delete(value)
}

/**
 * Checking whether the value is sanitized
 * @param value
 */
export function isSanitized (value: {}) {
  if (!value || typeof value !== 'object') return true
  return sanitizedValues.has(value)
}

/**
 * Upsert model state
 * @param instance
 * @param data
 */
const upsertState = (instance: ActiveModel, data: Partial<State>) => {
  if(!sharedState.has(instance)) {
    sharedState.set(instance, {
      creating: false,
      isDirty: false
    })
  }
  const record = sharedState.get(instance)!
  for (const [p, v] of Object.entries(data) as [keyof State, any][]) {
    record[p] = v
  }
}

/**
 * A hook notifying that the creation process has begun
 */
export const startCreating = () => {
  creating = true
}

/**
 * a hook notifying that the creation process has completed
 */
export const endCreating = () => {
  creating = false
}

/**
 * Helper for check creating state
 */
export const isCreating = (): boolean => {
  return creating
}

/**
 * Helper for check not creating
 */
export const isNotCreating = (): boolean => {
  return !creating
}

/**
 * Save initial state of model
 * @param instance
 * @param initialState
 */
export const saveInitialState = (instance: ActiveModel, initialState: ActiveModel) => {
  initialState = deepFreeze(cloneDeep(initialState))
  upsertState(instance, { initialState })
}

/**
 * Save row initial data of model source
 * @param instance
 * @param raw
 */
export const saveRaw = (instance: ActiveModel, raw: any) => {
  raw = deepFreeze(cloneDeep(raw))
  upsertState(instance, { raw })
}

/**
 * Checking whatever instance is touched
 * @param instance
 */
export const isTouched = (instance: ActiveModel) => {
  const meta = sharedState.get(instance)
  if (!meta) {
    return undefined
  }
  
  const { initialState} = meta
  
  return deepEqual(instance, initialState)
}

/**
 * Reqursive deep freaze object
 * @param value
 */
function deepFreeze(value: any) {
  if (!((value && typeof value === "object") || typeof value === "function")) {
    return value
  }
  const propNames = Reflect.ownKeys(value);
  
  for (const name of propNames) {
    const v = value[name]
    if ((v && typeof value === "object") || typeof v === "function") {
      deepFreeze(v);
    }
  }
  
  return Object.freeze(value);
}

/**
 * checks for mandatory availability instance
 * @param instance
 */
const requiredInstance = (instance?: ActiveModel) => {
  if (!instance) {
    throw new Error(`Instance extends ActiveModel is required for this method!`)
  }
  
  return instance
}


/**
 * Helper for use model meta data
 * @param instance
 */
export const useMeta = (instance?: ActiveModel) => {
  let inst = instance
  return {
    setInstance: (instance: ActiveModel) => {
      inst = instance
    },
    startCreating,
    endCreating,
    isCreating,
    isNotCreating,
    saveInitialState: (initialState: ActiveModel) =>  saveInitialState(requiredInstance(inst), initialState),
    saveRaw: (raw: any) => saveRaw(requiredInstance(inst), raw),
    isTouched: () => isTouched(requiredInstance(inst))
  }
}

