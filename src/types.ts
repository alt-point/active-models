import { ActiveModel } from './ActiveModel'

export type ActiveModelSource = undefined | object | null

export type EnumItemType = string | Symbol | null

export type AnyClassInstance = { new (...args: any[]): any } | {
  [key: string]: any
} | object | any

export type Getter<M extends ActiveModel = ActiveModel, R = unknown> = (model: M, prop: string, receiver?: any ) => R

export type Setter<M extends ActiveModel = ActiveModel, V = any> = (model: M, prop: string, value: V, receiver?: any ) => boolean

export type Validator<M extends ActiveModel = ActiveModel, V = any> = (model: M, prop: string, value: V) => boolean | void

export type FactoryConfig = [Model: typeof ActiveModel, DefaultData?: any] |  typeof ActiveModel

export enum EventType {
  touched = 'touched',
  created = 'created',
  beforeSetValue = 'beforeSetValue',
  afterSetValue = 'afterSetValue',
  beforeDeletingAttribute = 'beforeDeletingAttribute',
  nulling = 'nulling'
}

export type PropEvent = Exclude<EventType, EventType.touched | EventType.created>
export type ActiveModelHookListener = (model: any) => void

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
  factory?: FactoryConfig,
  on?: Partial<Record<PropEvent, ActiveModelHookListener>>,
  once?: Partial<Record<PropEvent, ActiveModelHookListener>>
}



export type FactoryOptions = {
  lazy?: boolean
  sanitize?: boolean
  tracked?: boolean
}

export enum StaticContainers {
  __getters__ = '__getters__',
  __setters__ = '__setters__',
  __attributes__ = '__attributes__',
  __validators__ = '__validators__',
  __fillable__ = '__fillable__',
  __protected__ = '__protected__',
  __readonly__ = '__readonly__',
  __hidden__ = '__hidden__',
  __activeFields__ = '__activeFields__',
}
