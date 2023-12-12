import { ActiveModel } from './ActiveModel'

export type ActiveModelSource = undefined | object | null

export type EnumItemType = string | Symbol | null

export type AnyClassInstance = { new (...args: any[]): any } | {
  [key: string]: any
} | object | any

export type Getter<M extends ActiveModel = ActiveModel, R = unknown> = (model: M, prop: string, receiver?: any ) => R

export type Setter<M extends ActiveModel = ActiveModel, V = any> = (model: M, prop: string, value: V, receiver?: any ) => boolean

export type Validator<M extends ActiveModel = ActiveModel, V = any> = (model: M, prop: string, value: V) => boolean | void

export type FactoryConfig = [M: typeof ActiveModel, D?: any] |  typeof ActiveModel
export type ActiveFieldDescriptor<T = unknown> = {
  setter?: Setter<any>
  getter?: Getter<any>
  validator?: Validator<any>
  readonly?: boolean
  hidden?: boolean
  fillable?: boolean
  protected?: boolean
  attribute?: any
  value?: any
  factory?: FactoryConfig
  
}
