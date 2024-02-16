import { ActiveModel } from "./ActiveModel";
import { ActiveModelHookListener, EventType } from "./types";

type ListenersContainer = Set<ActiveModelHookListener>

type EventsContainer = Map<EventType, ListenersContainer>

const Registry = new WeakMap<typeof ActiveModel | ActiveModel, EventsContainer>()

const makeContainer = (): EventsContainer => {
  const map: EventsContainer = new Map()
  
  for (const eventName of Object.values(EventType) as EventType[]) {
    map.set(eventName as EventType, new Set())
  }
  
  return map
  
}


export const useEmitter = (target: typeof ActiveModel | ActiveModel) => {
  if (!Registry.has(target)) {
    Registry.set(target, makeContainer())
  }
  
  const events = Registry.get(target)!
  
  // check exist listeners by constructor
  if (typeof target === 'object' && Registry.has(target?.constructor as typeof ActiveModel)) {
    const eventsByConstructor = Registry.get(target?.constructor as typeof ActiveModel)!
    for (const [eventName, listeners] of eventsByConstructor.entries()) {
      const container = events.get(eventName)!
      for (const listener of listeners) {
        container.add(listener)
      }
      
    }
  }
  
  const addListener = (eventName: EventType, listener: ActiveModelHookListener, once = false) => {
    
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function!', listener)
    }
    
    const container = events.get(eventName)!
    
    if (once) {
      let unbind
      const closure = (payload?: any) => {
        listener(payload)
        unbind = () => removeListener(eventName, listener)
        unbind()
        return unbind
      }
      container.add(closure)
      
      return unbind
    }
    
    const unbind = () => removeListener(eventName, listener)
    
    container.add(listener)
    
    return unbind
    
  }
  
  const getListeners = (eventName: EventType): ListenersContainer => {
    return events.get(eventName)!
  }
  
  const removeListener = (eventName: EventType, listener: ActiveModelHookListener) => {
    getListeners(eventName)!.delete(listener)
  }
  
  return {
    addListener,
    getListeners,
    removeListener
  }
}
