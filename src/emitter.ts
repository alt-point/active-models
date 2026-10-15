import { type ActiveModelHookListener, EventType } from './types'

type ListenersContainer = Set<ActiveModelHookListener>
type EventsContainer = Map<EventType, ListenersContainer>
/** Anything that can own listeners: a model class/instance or a collection class/instance. */
type EmitterTarget = object

/** Filled by `addListener` only: a target that merely emits has no entry (and costs nothing). */
const Registry = new WeakMap<EmitterTarget, EventsContainer>()

const NONE: ListenersContainer = new Set()

const ownListeners = (target: EmitterTarget, eventName: EventType): ListenersContainer | undefined =>
  Registry.get(target)?.get(eventName)

/**
 * Helper for emitter
 * @param target
 */
export const useEmitter = (target: EmitterTarget) => {
  // Stryker disable next-line ConditionalExpression: class targets are only ever registered on, never emitted from
  const isInstance = typeof target === 'object'
  const Ctor = isInstance ? target.constructor : undefined

  /**
   * remove listener
   * @param eventName
   * @param listener
   */
  const removeListener = (
    eventName: EventType,
    listener: ActiveModelHookListener
  ) => {
    ownListeners(target, eventName)?.delete(listener)
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

    if (once) {
      const closure: ActiveModelHookListener = (payload) => {
        listener(payload)
        removeListener(eventName, closure)
      }
      container.add(closure)
      return () => removeListener(eventName, closure)
    }

    container.add(listener)
    return () => removeListener(eventName, listener)
  }

  /**
   * Get all event listeners by event name.
   * Order: listeners registered on the ancestor classes (root first), then on
   * the instance's own class, then on the instance itself - so a hook declared
   * on a parent class also fires for instances of every subclass.
   * @param eventName
   */
  const getListeners = (eventName: EventType): Iterable<ActiveModelHookListener> => {
    const own = ownListeners(target, eventName) ?? NONE

    // Stryker disable next-line all: class targets are only ever registered on, never emitted from
    if (!Ctor) {
      return own
    }

    const chain: Array<ListenersContainer> = []
    for (
      let current: unknown = Ctor;
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
   * @param eventName
   * @param payload
   */
  const emit = (eventName: EventType, payload?: unknown) => {
    const errors: unknown[] = []
    for (const cb of getListeners(eventName)) {
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

  return {
    addListener,
    getListeners,
    removeListener,
    emit,
  }
}
