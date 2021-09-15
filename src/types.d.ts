import { ActiveModel } from './ActiveModel'

export type ActiveModelSource = undefined | object | null

export type EnumItemType = string | Symbol | null

export type AnyClassInstance = { new (...args: any[]): any } | {
  [key: string]: any
} | object | any

export type Getter<M extends ActiveModel | unknown = ActiveModel, R = any> = (model: M, prop: string, receiver?: any ) => R

export type Setter<M extends ActiveModel | unknown = ActiveModel, V = any> = (model: M, prop: string, value: V, receiver?: any ) => boolean | void

export type Validator<M extends ActiveModel | unknown = ActiveModel, V = any> = (model: M, prop: string, value: V) => boolean | void

export type ActiveFieldDescriptor = object & {
  setter?: Setter<any>
  getter?: Getter<any>
  validator?: Validator<any>
  readonly?: boolean
  hidden?: boolean
  fillable?: boolean
  protected?: boolean
  attribute?: any
  value?: any
}
