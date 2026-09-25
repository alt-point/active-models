import { ActiveModel } from './ActiveModel'
import deepEqual from 'fast-deep-equal/es6'
import cloneDeep from 'lodash-es/cloneDeep'
type State = {
  creating: boolean
  isDirty: boolean
  initialState?: ActiveModel | undefined
  raw?: any
}

/**
 * Depth of the currently running `create()` calls. `create()` is fully
 * synchronous, so a plain module-level counter is race-free - no
 * `AsyncLocalStorage` (which never worked in the ESM build anyway) needed.
 */
let creatingDepth = 0

/**
 * One-shot marker: set by `create()` right before `new this()`, consumed by the
 * base constructor, which then returns the raw (not yet proxied) instance.
 */
let rawConstruction = false

/**
 * Helper for check creating state
 */
export const isCreating = (): boolean => creatingDepth > 0

/**
 * Helper for check not creating
 */
export const isNotCreating = (): boolean => !isCreating()

/**
 * Run `fn` as part of model creation: `touched` is not emitted for the writes it performs.
 * The counter is restored even if `fn` throws.
 */
export const runInCreatingContext = <T>(fn: () => T): T => {
  creatingDepth++
  try {
    return fn()
  } finally {
    creatingDepth--
  }
}

/**
 * Run `fn` (the `new this()` call of `create()`) so that the base constructor
 * knows to return the raw instance instead of wrapping it.
 */
export const runRawConstruction = <T>(fn: () => T): T => {
  rawConstruction = true
  try {
    return fn()
  } finally {
    rawConstruction = false
  }
}

/**
 * Base-constructor side of `runRawConstruction`: returns `true` once, then
 * resets, so a model instantiated from a field initializer of the instance
 * being built is not mistaken for the raw one.
 */
export const consumeRawConstruction = (): boolean => {
  const value = rawConstruction
  rawConstruction = false
  return value
}

/**
 * Shared state of model, for use in life cycle
 */
const sharedState = new WeakMap<ActiveModel, State>()

/**
 * registry of sanitized values
 */
const sanitizedValues = new WeakSet()

/**
 * Mark value as sanitized
 * @param value
 */
export function markSanitized (value: object) {
  sanitizedValues.add(value)
}

/**
 * Unmark value as sanitized
 * @param value
 */
export function unmarkSanitized (value: object) {
  sanitizedValues.delete(value)
}

/**
 * Checking whether the value is sanitized
 * @param value
 */
export function isSanitized (value: unknown) {
  if (!value || typeof value !== 'object') return true
  return sanitizedValues.has(value)
}

/**
 * Upsert model state
 * @param instance
 * @param data
 */
const upsertState = (instance: ActiveModel, data: Partial<State>) => {
  if (!sharedState.has(instance)) {
    sharedState.set(instance, {
      creating: false,
      isDirty: false,
    })
  }
  const record = sharedState.get(instance)!
  for (const [p, v] of Object.entries(data) as [keyof State, any][]) {
    record[p] = v
  }
}

/**
 * Save initial state of model
 * @param instance
 * @param initialState
 */
export const saveInitialState = (
  instance: ActiveModel,
  initialState: ActiveModel
) => {
  initialState = deepFreeze(cloneDeep(initialState))
  upsertState(instance, { initialState })
}

/**
 * Carry the tracking baseline of `from` over to `to` (used by `clone()`).
 * The snapshot is already deep-frozen, so it is safe to share.
 */
export const copyTrackingState = (from: ActiveModel, to: ActiveModel) => {
  const meta = sharedState.get(from)
  if (meta?.initialState) {
    upsertState(to, { initialState: meta.initialState, raw: meta.raw })
  }
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

  const { initialState } = meta

  return !deepEqual(instance, initialState)
}

/**
 * Reqursive deep freaze object
 * @param value
 */
function deepFreeze (value: any) {
  if (!((value && typeof value === 'object') || typeof value === 'function')) {
    return value
  }
  const propNames = Reflect.ownKeys(value)

  for (const name of propNames) {
    const v = value[name]
    if ((v && typeof v === 'object') || typeof v === 'function') {
      deepFreeze(v)
    }
  }

  return Object.freeze(value)
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
 * Helper for use model meta-data
 * @param instance
 */
export const useMeta = (instance?: ActiveModel) => {
  let inst = instance
  return {
    setInstance: (instance: ActiveModel) => {
      inst = instance
    },
    isCreating,
    isNotCreating,
    runInCreatingContext,
    runRawConstruction,
    consumeRawConstruction,
    saveInitialState: (initialState: ActiveModel) =>
      saveInitialState(requiredInstance(inst), initialState),
    saveRaw: (raw: any) => saveRaw(requiredInstance(inst), raw),
    isTouched: () => isTouched(requiredInstance(inst)),
  }
}
