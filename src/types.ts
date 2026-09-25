import { type ActiveModel } from './ActiveModel'
import { type ActiveCollection } from './ActiveCollection'

export type ConstructorType = abstract new (...args: any[]) => any
export type ActiveModelSource = undefined | object | null

export type EnumItemType = string | Symbol | null

export type AnyClassInstance =
  | { new(...args: any[]): any }
  | {
    [key: string]: any
  }
  | object
  | any

export type Getter<M extends ActiveModel = ActiveModel, R = unknown> = (
  model: M,
  prop: string,
  receiver?: any
) => R

export type Setter<M extends ActiveModel = ActiveModel, V = any> = (
  model: M,
  prop: string,
  value: V,
  receiver?: any
) => boolean

export type Validator<M extends ActiveModel = ActiveModel, V = any> = (
  model: M,
  prop: string,
  value: V
) => boolean | void

export type FactoryBase = typeof ActiveModel
export type FactoryConfig =
  | [
    Model: FactoryBase,
    DefaultData?: () => ((FactoryBase | Array<FactoryBase>) | any) | undefined
  ]
  | FactoryBase

export enum EventType {
  touched = 'touched',
  created = 'created',
  beforeSetValue = 'beforeSetValue',
  afterSetValue = 'afterSetValue',
  beforeDeletingAttribute = 'beforeDeletingAttribute',
  nulling = 'nulling',
  itemsAdded = 'itemsAdded',
  itemsRemoved = 'itemsRemoved',
}

export type PropEvent = Exclude<
  EventType,
  | EventType.touched
  | EventType.created
  | EventType.itemsAdded
  | EventType.itemsRemoved
>
export type ActiveModelHookListener = (model: any) => void

/** Payload of `beforeSetValue`, `afterSetValue` and `nulling` */
export type SetEventPayload = {
  /** raw (unproxied) instance - read only, do not write through it */
  target: ActiveModel
  prop: string | symbol
  value: unknown
  oldValue: unknown
}

/** Payload of `beforeDeletingAttribute` */
export type DeleteEventPayload = {
  target: ActiveModel
  prop: string | symbol
}

/** Payload of `created` and `touched`: `target` is the model (or collection) instance itself */
export type InstanceEventPayload = { target: ActiveModel | ActiveCollection<any> }

/** Payload of `itemsAdded` / `itemsRemoved` of an `ActiveCollection` */
export type CollectionEventPayload<T = any> = {
  target: ActiveCollection<any>
  /** the items that were added / removed */
  items: T[]
  /** position of the first affected item at the time of the change */
  index: number
}

export type EventPayloads = {
  [EventType.touched]: InstanceEventPayload
  [EventType.created]: InstanceEventPayload
  [EventType.beforeSetValue]: SetEventPayload
  [EventType.afterSetValue]: SetEventPayload
  [EventType.nulling]: SetEventPayload
  [EventType.beforeDeletingAttribute]: DeleteEventPayload
  [EventType.itemsAdded]: CollectionEventPayload
  [EventType.itemsRemoved]: CollectionEventPayload
}

/** Listener typed by the event it is subscribed to */
export type EventListener<E extends EventType = EventType> = (
  payload: EventPayloads[E]
) => void

type PrimitiveValue = string | number | null | undefined | boolean

/** A default for a field: a primitive, a plain object/array (copied per instance) or a `() => value` factory. */
export type AttributeValue = (() => any) | PrimitiveValue | object

/**
 * Options of an `ActiveCollection`.
 */
export type CollectionOptions<T = any> = {
  /**
   * Keep the collection sorted by this key: a field name or a `(item) => key` function.
   * `null`/`undefined` keys sort last.
   */
  sortBy?: (T extends object ? keyof T & string : string) | ((item: T) => unknown)
  /** Keep the collection sorted by a custom comparator (takes precedence over `sortBy`). */
  compare?: (a: T, b: T) => number
  /** Sort direction, `asc` by default. */
  order?: 'asc' | 'desc'
  /** Turn plain objects into model instances (`Model.createLazy`). `true` by default; `false` accepts instances only. */
  coerce?: boolean
}

/**
 * Options of the `@ActiveField()` decorator.
 */
export type ActiveFieldDescriptor<_T = unknown> = {
  /** Transform/intercept a write. Return `true` when the value was stored. */
  setter?: Setter<any>
  /** Compute the value returned on read. */
  getter?: Getter<any>
  /** Reject a value by throwing. Runs only when the value actually changes; the return value is ignored. */
  validator?: Validator<any>
  /** Can be set once at creation (factory or constructor); later writes are silently ignored. */
  readonly?: boolean
  /** Excluded from `Object.keys`, spread, `in`, `JSON.stringify` and `isTouched()`; still readable directly. */
  hidden?: boolean
  /** `false`: data can never set the field and direct assignment throws. Default `true`. */
  fillable?: boolean
  /** `true` (default): `delete model.field` throws. */
  protected?: boolean
  /** Default for a key absent from `create()` data (a value or a `() => value` factory). */
  attribute?: AttributeValue
  /** Alias for `attribute`. */
  value?: AttributeValue
  /** Wrap a nested object (or every array item) in this `ActiveModel`; `[Model, () => default]` adds a default. */
  factory?: FactoryConfig
  /**
   * Store an array of `Model` instances as an `ActiveCollection` that accepts nothing else;
   * `[Model, options]` also configures sorting. Defaults to an empty collection.
   */
  collection?: typeof ActiveModel | [Model: typeof ActiveModel, options?: CollectionOptions]
  /** Field-level hooks, shared by every instance of the class (and subclasses). */
  on?: Partial<Record<PropEvent, ActiveModelHookListener>>
  /** Like `on`, but each hook fires only once. */
  once?: Partial<Record<PropEvent, ActiveModelHookListener>>
}

/**
 * Options of `Model.create()`.
 */
export type FactoryOptions = {
  /** Return an existing instance of the model as-is instead of rebuilding it. */
  lazy?: boolean
  /** Deep-clone the input first so the model never shares references with it. Default `true`. */
  sanitize?: boolean
  /** Take the baseline snapshot used by `isTouched()`. */
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

// mapper types

export type MapSource = ConstructorType | typeof ActiveModel
export type MapTarget =
  | typeof ActiveModel
  | ActiveModel
  | symbol
  | string
  | null
  | object
  | unknown

export type HandlerMapTo<T extends MapSource, RT = unknown> = (
  source: InstanceType<T>,
  ...args: unknown[]
) => RT

export type MapToMapper<H = HandlerMapTo<MapSource>> = WeakMap<
  MapSource,
  Map<MapTarget, H>
>
