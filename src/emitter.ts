import { type ActiveModelHookListener, EventType } from './types'

type ListenersContainer = Set<ActiveModelHookListener>
type EventsContainer = Map<EventType, ListenersContainer>
/** Anything that can own listeners: a model class/instance or a collection class/instance. */
type EmitterTarget = object

const Registry = new WeakMap<EmitterTarget, EventsContainer>()

/**
 * Make events container
 */
const makeContainer = (): EventsContainer => {
  const map: EventsContainer = new Map()
  for (const eventName of Object.values(EventType) as EventType[]) {
    map.set(eventName as EventType, new Set())
  }
  return map
}

const getOwnContainer = (target: EmitterTarget): EventsContainer => {
  if (!Registry.has(target)) {
    Registry.set(target, makeContainer())
  }
  return Registry.get(target)!
}


/**
 * Helper for emitter
 * @param target
 */
export const useEmitter = (target: EmitterTarget) => {
  const ownEvents = getOwnContainer(target)

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
    ownEvents.get(eventName)!.delete(listener)
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

    const container = ownEvents.get(eventName)!

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
    const own = ownEvents.get(eventName)!

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

