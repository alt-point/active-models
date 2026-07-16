import { ActiveModel } from './ActiveModel'
import { type ActiveModelHookListener, EventType } from './types'

type ListenersContainer = Set<ActiveModelHookListener>
type EventsContainer = Map<EventType, ListenersContainer>
const Registry = new WeakMap<
  typeof ActiveModel | ActiveModel,
  EventsContainer
>()

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

const getOwnContainer = (target: typeof ActiveModel | ActiveModel): EventsContainer => {
  if (!Registry.has(target)) {
    Registry.set(target, makeContainer())
  }
  return Registry.get(target)!
}


/**
 * Helper for emitter
 * @param target
 */
export const useEmitter = (target: typeof ActiveModel | ActiveModel) => {
  const ownEvents = getOwnContainer(target)

  const isInstance = typeof target === 'object'
  const Ctor = isInstance ? (target.constructor as typeof ActiveModel) : undefined

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
   * @param eventName
   */
  const getListeners = (eventName: EventType): Iterable<ActiveModelHookListener> => {
    const own = ownEvents.get(eventName)!

    if (!Ctor) {
      return own
    }

    const ctorEvents = Registry.get(Ctor)
    const inherited = ctorEvents?.get(eventName)

    if (!inherited || inherited.size === 0) {
      return own
    }

    return (function* () {
      yield* inherited
      yield* own
    })()
  }

  return {
    addListener,
    getListeners,
    removeListener,
  }
}

