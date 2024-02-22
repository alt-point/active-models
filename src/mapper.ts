import { ActiveModel } from './ActiveModel'

export type MapTarget = symbol | string | null | object | typeof ActiveModel | ActiveModel
export type MapSource = object | null | ActiveModel

export type HandlerMapFrom = (source: MapSource) => ActiveModel
export type HandlerMapTo = (source: ActiveModel) => MapTarget

const MapperTo = new WeakMap<typeof ActiveModel, Map<MapTarget, (target: ActiveModel) => MapTarget>>()

export const useMapper = (Ctor: typeof ActiveModel) => {
  if (!MapperTo.has(Ctor)) {
    MapperTo.set(Ctor, new Map())
  }
  
  
  const setMapTo = (target: MapTarget, handler: HandlerMapTo) => {
    MapperTo.get(Ctor)!.set(target, handler)
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
