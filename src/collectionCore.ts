/**
 * What `ActiveCollection`, `ActiveMap` and `ActiveSet` share: telling plain data from models,
 * turning input into instances of the declared model, and watching the items for changes.
 */
import { EventType, type KeyOf } from './types'
import type { ActiveModel } from './ActiveModel'

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** A short name for what was refused, for error messages */
export const describeValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'object') return (value as object).constructor?.name ?? 'object'
  return typeof value
}

/**
 * The one instance of `model` a container may hold for `item`: an instance passes as is, plain data becomes
 * one when `coerce` is on, anything else is refused.
 * @param label - names the container in the error, e.g. `ActiveCollection`
 */
export const normalizeItem = <T extends ActiveModel>(
  model: typeof ActiveModel,
  coerce: boolean,
  label: string,
  item: unknown
): T => {
  if (item instanceof model) {
    return item as T
  }
  if (coerce && isPlainObject(item)) {
    return model.createLazy(item as any) as T
  }
  throw new TypeError(
    `${label}<${model.name}> accepts only ${model.name} instances` +
    `${coerce ? ' or plain objects' : ''}, got ${describeValue(item)}`
  )
}

/** A key function from a field name or a function; `undefined` when neither was given */
export const keyFunction = <T>(option: KeyOf<T> | undefined): ((item: T) => unknown) | undefined => {
  if (typeof option === 'function') {
    return option as (item: T) => unknown
  }
  return typeof option === 'string' ? (item: any) => item[option] : undefined
}

export const isNilKey = (key: unknown): key is null | undefined => key === null || key === undefined

/** A container that keeps its items subscribed; `attached` counts how many slots hold each item */
export type Watching<T> = { attached: Map<T, { off: () => void, count: number }> }

/**
 * Subscribe `host` to `item`'s `touched`. The item outlives the container it sits in, so it must not keep
 * that container alive: the host is held weakly and the subscription removes itself once it was collected.
 */
export const attachItem = <T extends ActiveModel, H extends Watching<T>>(
  host: H,
  item: T,
  onTouched: (host: H, item: T) => void
) => {
  const known = host.attached.get(item)
  if (known) {
    known.count++
    return
  }
  const ref = new WeakRef(host)
  const off: () => void = item.on(EventType.touched, () => {
    const alive = ref.deref()
    if (alive) {
      onTouched(alive, item)
    // Stryker disable all: the dead-container branch needs a garbage collection to run - see the memory test in tests/perf
    } else {
      off()
    }
    // Stryker restore all
  })
  host.attached.set(item, { off, count: 1 })
}

export const detachItem = <T extends ActiveModel>(host: Watching<T>, item: T) => {
  const known = host.attached.get(item)
  if (!known) {
    return
  }
  if (--known.count === 0) {
    known.off()
    host.attached.delete(item)
  }
}
