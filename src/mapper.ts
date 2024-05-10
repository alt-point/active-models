import { type  ActiveModel } from './ActiveModel'
import type { MapToMapper, MapSource, MapTarget, HandlerMapTo } from './types'

const MapperTo: MapToMapper = new WeakMap()

/**
 * Private module function for managing mapper
 * @param Ctor
 */
export const useMapper = <RT = unknown, T extends MapSource = typeof ActiveModel>(Ctor: T) => {
  if (!MapperTo.has(Ctor)) {
    MapperTo.set(Ctor, new Map())
  }
  
  const setMapTo = <RTL = RT>(target: MapTarget, handler: HandlerMapTo<T, RTL>) => {
    (<MapToMapper<HandlerMapTo<T, RTL>>> MapperTo).get(Ctor)!.set(target, handler)
  }
  
  const mapTo = (target: MapTarget) => {
    return MapperTo.get(Ctor)!.get(target)
  }
  
  const hasMapping = (target: MapTarget) => {
    return MapperTo.get(Ctor)!.has(target)
  }
  
  return {
    setMapTo,
    hasMapping,
    mapTo
  }
}
