import { type ActiveModelHookListener, EventType } from './types'

type ListenersContainer = Set<ActiveModelHookListener>
type EventsContainer = Map<EventType, ListenersContainer>
/** Anything that can own listeners: a model class/instance or a collection class/instance. */
type EmitterTarget = object

/** Filled by `addListener` only: a target that merely emits has no entry (and costs nothing). */
const Registry = new WeakMap<EmitterTarget, EventsContainer>()

/** Listeners registered on classes, per event: an event with none lets `emit()` skip the prototype walk */
const classListeners = new Map<EventType, number>()

const NONE: ListenersContainer = new Set()

const ownListeners = (target: EmitterTarget, eventName: EventType): ListenersContainer | undefined =>
  Registry.get(target)?.get(eventName)

const countClassListener = (target: EmitterTarget, eventName: EventType, delta: number) => {
  // Stryker disable next-line ConditionalExpression: counting instance listeners too only raises the count, which costs emit() the prototype walk, never a listener
  if (typeof target === 'function') {
    // Stryker disable next-line ArithmeticOperator: a negated count is zero exactly when the real one is, and emit() only tests it for zero
    classListeners.set(eventName, (classListeners.get(eventName) ?? 0) + delta)
  }
}

/**
 * All event listeners by event name.
 * Order: listeners registered on the ancestor classes (root first), then on
 * the instance's own class, then on the instance itself - so a hook declared
 * on a parent class also fires for instances of every subclass.
 */
const getListeners = (target: EmitterTarget, eventName: EventType): Iterable<ActiveModelHookListener> => {
  const own = ownListeners(target, eventName) ?? NONE

  // Stryker disable next-line all: class targets are only ever registered on, never emitted from
  if (typeof target !== 'object') {
    return own
  }

  const chain: Array<ListenersContainer> = []
  for (
    let current: unknown = target.constructor;
    // Stryker disable next-line ConditionalExpression: the second condition already ends the walk
    typeof current === 'function' && current !== Function.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    const listeners = Registry.get(current)?.get(eventName)
    // Stryker disable next-line ConditionalExpression,EqualityOperator: skipping empty containers is an optimisation
    if (listeners && listeners.size > 0) {
      chain.unshift(listeners)
    }
  }

  // Stryker disable next-line all: fast path, same result as the generator
  if (chain.length === 0) {
    return own
  }

  return (function* () {
    for (const listeners of chain) {
      yield* [...listeners]
    }
    yield* own
  })()
}

/**
 * Emit an event, synchronously invoking every listener registered for it.
 * A throwing listener does not stop the others: all of them run, then the
 * first error is rethrown (or, for several failures, an Error carrying them
 * all in `errors`).
 * @param target
 * @param eventName
 * @param payload
 */
export const emit = (target: EmitterTarget, eventName: EventType, payload?: unknown): void => {
  // the common case: nobody listens to this event, neither on the target nor on any class
  // Stryker disable next-line ConditionalExpression,BlockStatement: without the early return getListeners() finds the same (no) listeners
  if (!classListeners.get(eventName) && !ownListeners(target, eventName)?.size) {
    return
  }
  const errors: unknown[] = []
  for (const cb of getListeners(target, eventName)) {
    try {
      cb(payload)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) {
    throw errors[0]
  }
  // Stryker disable next-line EqualityOperator: the single-error case has already thrown above
  if (errors.length > 1) {
    throw Object.assign(
      new Error(`${errors.length} listeners of "${eventName}" failed`),
      { errors }
    )
  }
}

/**
 * Listener registration on one target
 * @param target
 */
export const useEmitter = (target: EmitterTarget) => {
  /**
   * remove listener
   * @param eventName
   * @param listener
   */
  const removeListener = (
    eventName: EventType,
    listener: ActiveModelHookListener
  ) => {
    // Stryker disable next-line BlockStatement: a count left too high only costs emit() the prototype walk, never a listener
    if (ownListeners(target, eventName)?.delete(listener)) {
      // Stryker disable next-line UnaryOperator,CallExpression: a count left too high only costs emit() the prototype walk, never a listener
      countClassListener(target, eventName, -1)
    }
  }

  /**
   * Add event listener by event type
   * @param eventName
   * @param listener
   * @param once
   */
  const addListener = (
    eventName: EventType,
    listener: ActiveModelHookListener,
    once = false
  ) => {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function!')
    }

    let events = Registry.get(target)
    if (!events) {
      events = new Map()
      Registry.set(target, events)
    }
    let container = events.get(eventName)
    if (!container) {
      container = new Set()
      events.set(eventName, container)
    }

    const entry: ActiveModelHookListener = once
      ? (payload) => {
        listener(payload)
        removeListener(eventName, entry)
      }
      : listener
    const before = container.size
    container.add(entry)
    // the same listener added twice is one entry
    // Stryker disable next-line ConditionalExpression,EqualityOperator: counting a duplicate only raises the count, which costs emit() the prototype walk, never a listener
    if (container.size > before) {
      countClassListener(target, eventName, 1)
    }
    return () => removeListener(eventName, entry)
  }

  return {
    addListener,
    removeListener,
  }
}
