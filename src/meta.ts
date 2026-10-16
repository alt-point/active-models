import { ActiveModel } from './ActiveModel'
import { cloneDeep } from './clone'
type State = {
  raw?: any
  /**
   * What `isTouched()` / `changes()` compare to and `revert()` restores from: a pristine copy of the model taken right
   * after creation, or with `tracked: 'shallow'` a plain object holding the field values as they were
   */
  baseline?: object
  /** `tracked: 'shallow'`: `baseline` holds the values by reference and they are compared with `Object.is` */
  shallow?: boolean
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
 * Depth of the operations that put values back (rollback, undo, revert): they bypass
 * normalizers, rules, transitions and validators - the values were valid when they were taken.
 */
let restoringDepth = 0

export const isRestoring = (): boolean => restoringDepth > 0

export const runRestoring = <T>(fn: () => T): T => {
  restoringDepth++
  try {
    return fn()
  } finally {
    restoringDepth--
  }
}

/**
 * Helper for check creating state
 */
export const isCreating = (): boolean => creatingDepth > 0

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

// Stryker disable all: the sanitized marks only save a redundant deep clone, they change no observable result
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
// Stryker restore all

/**
 * Upsert model state
 * @param instance
 * @param data
 */
const upsertState = (instance: ActiveModel, data: Partial<State>) => {
  if (!sharedState.has(instance)) {
    sharedState.set(instance, {})
  }
  const record = sharedState.get(instance)!
  for (const [p, v] of Object.entries(data) as [keyof State, any][]) {
    record[p] = v
  }
}

/**
 * Carry the tracking baseline of `from` over to `to` (used by `clone()`).
 * The baseline is never written to, so it is safe to share.
 */
export const copyTrackingState = (from: ActiveModel, to: ActiveModel) => {
  const meta = sharedState.get(from)
  if (meta?.baseline) {
    upsertState(to, { raw: meta.raw, baseline: meta.baseline, shallow: meta.shallow })
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
 * The deep-frozen source data saved by `saveRaw`, or `undefined` if the model was never tracked
 * @param instance
 */
export const getRaw = (instance: ActiveModel) => sharedState.get(instance)?.raw

/** Keep the baseline of a tracked model (see `State.baseline`) */
export const saveBaseline = (instance: ActiveModel, baseline: object, shallow = false) => {
  upsertState(instance, { baseline, shallow })
}

export const getBaseline = (instance: ActiveModel) => sharedState.get(instance)?.baseline

/** Whether `instance` was created with `tracked: 'shallow'` */
export const isShallow = (instance: ActiveModel) => sharedState.get(instance)?.shallow === true

/**
 * Reqursive deep freaze object
 * @param value
 */
function deepFreeze (value: any) {
  // functions are left alone: they are the caller's own objects, not snapshot data
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }

  // frozen before its children so that a circular reference stops at the `isFrozen` check above
  Object.freeze(value)
  for (const name of Reflect.ownKeys(value)) {
    deepFreeze(value[name])
  }

  return value
}
