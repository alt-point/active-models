import 'reflect-metadata'
import type { Getter, Setter } from "./types";

export function Getter<T>() {
  return function (target: T, prop: string | symbol, descriptor: TypedPropertyDescriptor<any>) {
    //console.log('call getter', target, prop, descriptor)
  }
}

export function Setter(property: string) {
  return function (target: any, prop: string | symbol, descriptor: TypedPropertyDescriptor<any>) {
    target.defineSetter(property, descriptor.value)
  }
}

export function activeModel<T extends { new (...args: any[]): {} }>(constructor: T) {
  return class extends constructor {

  }
}
