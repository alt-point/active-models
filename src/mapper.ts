import { type  ActiveModel } from './ActiveModel'
import { ConstructorType } from './types'

export type MapSource = ConstructorType | typeof ActiveModel
export type MapTarget = typeof ActiveModel | ActiveModel | symbol | string | null | object

export type HandlerMapTo<T extends MapSource, RT = any> = (source: InstanceType<T>) => RT

type MapToMapper<H = HandlerMapTo<MapSource>> = WeakMap<MapSource, Map<MapTarget, H>>

const MapperTo: MapToMapper = new WeakMap()

/**
 * Private module function for managing mapper
 * @param Ctor
 */
export const useMapper = <RT = any, T extends MapSource = typeof ActiveModel>(Ctor: T) => {
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
