import ActiveModel from "./ActiveModel";

export type ActiveModelSource = undefined | object | null
export type EnumItemType = string | Symbol | null
export type AnyClassInstance = { new (...args: any[]): any } | {
  [key: string]: any
} | object | any

export type Getter<R> = (model: ActiveModel, prop: string | symbol, receiver?: any ) => R
export type Setter<V> = (model: ActiveModel, prop: string | symbol, value: V, receiver?: any ) => boolean | void
