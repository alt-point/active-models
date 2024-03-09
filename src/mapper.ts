import { type  ActiveModel } from './ActiveModel'

export type MapTarget = typeof ActiveModel | ActiveModel | symbol | string | null | object

export type HandlerMapTo<T extends typeof ActiveModel, RT = any> = (source: InstanceType<T>) => RT

type MapToMapper<H = HandlerMapTo<typeof ActiveModel>> = WeakMap<typeof ActiveModel, Map<MapTarget, H>>

const MapperTo: MapToMapper = new WeakMap()

export const useMapper = <RT = any, T extends typeof ActiveModel = typeof ActiveModel>(Ctor: T) => {
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
