import {
  type ActiveModelSource,
  type AnyClassInstance,
  type FactoryOptions,
  type Getter,
  type Setter,
  StaticContainers as SC,
  type Validator,
  EventType,
  type ActiveModelHookListener,
  type EventListener,
  type ConstructorType,
  type HandlerMapTo,
  type MapTarget,
} from './types'
import cloneDeep from 'lodash-es/cloneDeep'
import cloneDeepWith from 'lodash-es/cloneDeepWith'
import { copyTrackingState, isSanitized, markSanitized, unmarkSanitized, useMeta } from './meta'
import {
  type ModelProperties,
  type RecursivePartialActiveModel,
  isComplexValue,
  isPrimitiveValue,
  getValue,
  traverse,
  isNull,
  isPOJOSSafetyValue,
} from './utils'
import { useEmitter } from './emitter'
import { useMapper } from './mapper'

/**
 * proxy -> raw instance. Instance methods run with `this === proxy`, but state
 * that must include `hidden` fields (clone) has to be read from the raw object.
 */
const rawOf = new WeakMap<object, ActiveModel>()

/**
 * Instances frozen by `makeFreeze()`; checked by the traps for a clear error.
 */
const frozenModels = new WeakSet<object>()

/**
 * Per parent instance: prop -> unsubscribe functions of the `touched`
 * listeners it holds on its nested models. Lets a replaced child stop
 * notifying the parent, and keeps repeated assignments from stacking listeners.
 */
const childSubscriptions = new WeakMap<object, Map<string | symbol, Array<() => void>>>()

/** Parents currently re-emitting a bubbled `touched` (guards against reference cycles). */
const bubbling = new WeakSet<object>()

const makeWrittenTracker = () => {
  const registry = new WeakMap<ActiveModel, Set<string | symbol>>()
  return (target: ActiveModel): Set<string | symbol> => {
    let written = registry.get(target)
    if (!written) {
      written = new Set()
      registry.set(target, written)
    }
    return written
  }
}


/**
 * Tracks which `readonly` fields have already received their one-time value,
 * per raw instance. A `readonly` field may be set exactly once — via the
 * `create()` factory or via `new Model(data)` — after that, any further
 * write (through `fill()` or direct assignment) is silently ignored.
 */
const getReadonlyWritten = makeWrittenTracker()

/**
 * Tracks which `fillable: false` fields have already received their one
 * (and only intended) write — the class-field initializer's own default,
 * which `new Model(data)` routes through this same proxy after `super()`
 * returns (see the `set` trap below). Any further write is blocked with a
 * throw, same as before this tracking existed — `create()`/`new Model(data)`
 * never let data claim this slot: non-fillable keys are stripped from the
 * incoming data before `fill()` ever sees them (see `stripNonFillable`).
 */
const getFillableWritten = makeWrittenTracker()

/**
 * Class ActiveModel
 */
export class ActiveModel {
  /**
   * Subscribe to a lifecycle/field event on this instance. Implemented as a
   * getter (not a plain method) so that accessing it through the proxy - via
   * `Ctor.getter()`'s `Reflect.get(target, prop, target)` below - resolves
   * `this` to the raw target. That keeps the returned closure's `addListener`
   * keyed by the same raw object the `set`/`deleteProperty` traps use to
   * `emit()` (see the internal-only `useEmitter()` calls throughout this
   * file) - a plain prototype method would instead bind `this` to the proxy
   * at call time (`model.on(...)` calls with `this === model`), which is a
   * *different* WeakMap key and would silently never see trap-emitted events.
   */
  get on () {
    const { addListener } = useEmitter(this)
    return <E extends EventType>(event: E, cb: EventListener<E>) => addListener(event, cb as ActiveModelHookListener)
  }

  /**
   * Same as `on`, but the listener is removed after firing once.
   * @see on
   */
  get once () {
    const { addListener } = useEmitter(this)
    return <E extends EventType>(event: E, cb: EventListener<E>) => addListener(event, cb as ActiveModelHookListener, true)
  }

  /**
   * Subscribe to a lifecycle/field event for *every* instance of this class
   * (subclasses' instances included), not just one. Registered against the
   * constructor itself, which `useEmitter()`'s `getListeners()` merges in as
   * "inherited" listeners for any instance of this class - the same
   * mechanism `@ActiveField({ on: {...} })` already uses internally.
   */
  static on<E extends EventType> (event: E, cb: EventListener<E>) {
    const { addListener } = useEmitter(this)
    return addListener(event, cb as ActiveModelHookListener)
  }

  /**
   * Same as `on`, but the listener is removed after firing once.
   * @see on
   */
  static once<E extends EventType> (event: E, cb: EventListener<E>) {
    const { addListener } = useEmitter(this)
    return addListener(event, cb as ActiveModelHookListener, true)
  }

  protected static defineStaticProperty (
    propertyName: SC,
    fallback: () => unknown
  ) {
    // @ts-ignore
    this[propertyName] = Object.prototype.hasOwnProperty.call(this, propertyName)
      ? this[propertyName]!
      : fallback()
    return this
  }

  protected static setDefaultAttributes (
    data: AnyClassInstance
  ): Partial<InstanceType<typeof this>> {
    const attributes: Record<string, unknown> = this[SC.__attributes__]
      ? Object.fromEntries(this[SC.__attributes__]?.entries() || [])
      : {}
    for (const prop in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, prop)) {
        if (Reflect.has(data, prop)) {
          continue
        }

        const declared = attributes?.[prop]
        let value = getValue(declared)
        if (typeof declared !== 'function' && isComplexValue(value)) {
          // a plain `value: []` is one shared object - give every instance its own copy
          value = value instanceof ActiveModel ? value.clone() : cloneDeep(value)
        }
        if (isComplexValue(value)) {
          markSanitized(value)
        }
        data[prop] = value
      }
    }
    return data
  }

  /**
   * Remove keys for `fillable: false` fields from incoming data before it
   * ever reaches `fill()`. Without this, a `fillable: false` field's ONLY
   * legitimate write - its own class-field initializer's default, which
   * `new Model(data)` routes through this proxy after `super()` returns -
   * would lose a race against attacker-supplied `data`, since the data-fill
   * always runs first (see the `set` trap's fillable-tracking comment).
   */
  protected static stripNonFillable (
    data: AnyClassInstance
  ): Partial<InstanceType<typeof this>> {
    for (const prop in data) {
      if (this.isActiveField(prop) && !this.fieldIsFillable(prop)) {
        delete data[prop]
      }
    }
    return data
  }

  /**
   * `create()` constructs the raw instance *before* wrapping it in a proxy
   * (see `create()` below), specifically so class-field initializers run
   * unintercepted. That means a `fillable: false` field's default is
   * established here, outside the proxy - the `set` trap's write-once
   * tracking never sees it happen and would otherwise treat a later direct
   * assignment as the still-open "first" write. Mark every non-fillable
   * field as already-written right after raw construction so the trap
   * correctly blocks any write to it from this point on.
   */
  protected static sealNonFillable (instance: InstanceType<typeof this>): void {
    const activeFields = this[SC.__activeFields__]
    if (!activeFields) {
      return
    }
    const written = getFillableWritten(instance)
    for (const prop of activeFields) {
      if (!this.fieldIsFillable(prop)) {
        written.add(prop)
      }
    }
  }

  protected static fieldIsReadOnly (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__readonly__]?.has(prop) ?? false
  }

  protected static fieldIsHidden (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__hidden__]?.has(prop) ?? false
  }

  protected static fieldIsFillable (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__fillable__]?.has(prop) ?? false
  }

  protected static fieldIsProtected (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__protected__]?.has(prop) ?? false
  }

  protected static getter<Result = unknown> (
    target: ActiveModel,
    prop: string | keyof InstanceType<typeof this> | symbol,
    receiver?: ActiveModel
  ): Result {
    const Ctor = <typeof ActiveModel>target.constructor
    const resolvedGetter = Ctor?.resolveGetter?.(prop)
    return (
      resolvedGetter?.(target, prop as string, receiver) ??
      // Bind the receiver to `target` (not the proxy) so that accessing
      // built-in getters (e.g. `on`/`once`) through the proxy resolves `this`
      // to the same raw instance the internal set/delete traps use to emit
      // events (via the internal-only `useEmitter(target)`). Otherwise
      // `model.on(...)` would register against the proxy while trap code
      // emits against the raw target, and the listener would never see it.
      Reflect.get(target, prop, target)
    )
  }

  protected static [SC.__getters__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    Getter<InstanceType<typeof this>>
  >
  protected static [SC.__setters__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    Setter<InstanceType<typeof this>>
  >
  protected static [SC.__attributes__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    any
  >
  protected static [SC.__validators__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    Validator<any>
  >
  protected static [SC.__fillable__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__protected__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__readonly__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__hidden__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__activeFields__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >

  /**
   * Add field name to hidden scope
   * @param prop
   */
  static addToHidden (
    ...prop: Array<string | keyof InstanceType<typeof this> | symbol>
  ): void {
    this.defineStaticProperty(
      SC.__hidden__,
      () => new Set(this[SC.__hidden__] || [])
    )
    prop.forEach((p) => this[SC.__hidden__]!.add(p))
  }

  /**
   * add properties to fields
   * @param prop
   */
  static addToFields (
    ...prop: Array<string | keyof InstanceType<typeof this> | symbol>
  ): void {
    this.defineStaticProperty(
      SC.__activeFields__,
      () => new Set(this[SC.__activeFields__] || [])
    )
    prop.forEach((p) => this[SC.__activeFields__]!.add(p))
  }

  /**
   * check property is active field
   * @param prop
   * @protected
   */
  protected static isActiveField (
    prop: string | keyof InstanceType<typeof this> | symbol
  ) {
    return this?.__activeFields__?.has(prop) ?? false
  }

  /**
   *  Add field name to readonly scope
   * @param prop
   */
  static addToReadonly (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__readonly__,
      () => new Set(this[SC.__readonly__] || [])
    )
    this.__readonly__!.add(prop)
  }

  /**
   * Add field name to protected scope
   * @param prop
   */
  static addToProtected (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__protected__,
      () => new Set(this[SC.__protected__] || [])
    )
    this[SC.__protected__]!.add(prop)
  }

  /**
   * Add field name to fillable scope
   * @param prop
   */
  static addToFillable (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__fillable__,
      () => new Set(this[SC.__fillable__] || [])
    )
    this[SC.__fillable__]!.add(prop)
  }

  /**
   * define getter
   * @param prop
   * @param handler
   */
  static defineGetter (
    prop: string | keyof InstanceType<typeof this> | symbol,
    handler: Getter<any>
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__getters__,
      () => new Map(this[SC.__getters__] || [])
    )
    this[SC.__getters__]!.set(prop, handler)
  }

  /**
   * resolve getter
   * @param prop
   */
  static resolveGetter (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): Getter<any> | undefined {
    const getter = this[SC.__getters__]?.get(prop)
    return getter?.bind(this)
  }

  /**
   * define setter for field by name
   * @param prop
   * @param handler
   */
  static defineSetter (
    prop: string | keyof InstanceType<typeof this> | symbol,
    handler: Setter<any>
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__setters__,
      () => new Map(this[SC.__setters__] || [])
    )
    this[SC.__setters__]!.set(prop, handler)
  }

  /**
   * resolve setter for field by name
   * @param prop
   */
  protected static resolveSetter (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): Setter<any> | undefined {
    const setter = this[SC.__setters__]?.get(prop)
    return setter?.bind(this)
  }

  /**
   *  Define validator for field by name
   * @param prop
   * @param handler
   */
  static defineValidator (
    prop: string | keyof InstanceType<typeof this> | symbol,
    handler: Validator<any>
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__validators__,
      () => new Map(this[SC.__validators__] || [])
    )
    this[SC.__validators__]!.set(prop, handler)
  }

  /**
   * Resolve validator for field by name
   * @param prop
   */
  static resolveValidator (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): Validator<any> | undefined {
    const validator = this[SC.__validators__]?.get(prop)
    return validator?.bind(this)
  }

  /**
   * Define attribute (default value) for field by name
   * @param prop
   * @param value
   */
  static defineAttribute (
    prop: string | keyof InstanceType<typeof this> | symbol,
    value: any
  ): void {
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__attributes__,
      () => new Map(this[SC.__attributes__] || [])
    )
    this[SC.__attributes__]!.set(prop, value)
  }

  /**
   * Static method for converting to JSON
   */
  static toJSON (
    instance: object | object[] | ActiveModel | ActiveModel[]
  ): object | object[] {
    if (typeof instance !== 'object' || instance === null) {
      return instance
    }

    if (!(instance instanceof ActiveModel)) {
      // values that know how to serialize themselves (Date, URL, Buffer, ...)
      if (typeof (instance as { toJSON?: unknown }).toJSON === 'function') {
        return (instance as { toJSON: () => object }).toJSON()
      }
      if (instance instanceof Set) {
        return this.toJSON([...instance])
      }
      if (instance instanceof Map) {
        return this.toJSON(Object.fromEntries(instance))
      }
    }

    return Array.isArray(instance)
      ? instance.map((i) => this.toJSON(i))
      : Object.keys(instance).reduce(
        (a: { [key: string]: unknown }, b: string) => {
          // getters receive the raw instance, exactly like on a regular read
          const source = rawOf.get(instance) ?? instance
          // @ts-ignore
          const value =
            (<typeof ActiveModel>instance.constructor)?.getter?.(
              source as ActiveModel,
              b
            ) ?? Reflect.get(source, b)
          if (!isPOJOSSafetyValue(value)) {
            return a
          }
          a[b] = value
          if (
            (typeof a[b] === 'object' && a[b] !== null) ||
            Array.isArray(a[b])
          ) {
            a[b] = this.toJSON(a[b] as object)
          }
          return a
        },
        {}
      )
  }

  /**
   * Convert current instance to JSON structure
   */
  toJSON () {
    return (<typeof ActiveModel>this.constructor).toJSON(this)
  }

  /**
   * Shallow-freeze the model: any later write, delete or defineProperty throws a TypeError.
   * Implemented by guarding the proxy traps rather than `Object.freeze()` - a
   * truly frozen target forces `ownKeys` to list every key, which would expose
   * `hidden` fields - so `Object.isFrozen(model)` still reports `false`.
   * Nested models/arrays are not frozen.
   * @return {Readonly<this>}
   */
  makeFreeze (): Readonly<this> {
    frozenModels.add(rawOf.get(this) ?? this)
    return this
  }

  /**
   * Sanitize input data
   * @param data
   * @return {*}
   */
  static sanitize (
    data: object | ActiveModel
  ): Partial<InstanceType<typeof this>> {
    const cloned = cloneDeepWith(data, this.cloneCustomizer.bind(this))

    traverse(cloned, (node) => {
      markSanitized(node)
    })

    return cloned
  }

  /**
   * Factory method for create new instance
   * @param data - source of creating
   * @param opts - options
   * @param {boolean} opts.lazy - without forced creating complex values; including current data
   * @param {boolean} opts.tracked - tracking model touched
   * @param {boolean} opts.sanitize - unlink all references to the model and complex values in its properties
   *
   * @example Basic usage
   *
   * ```typescript
   *
   * import { ActiveField, ActiveModel } from '@alt-point/active-models/src'
   *
   * class Car extends ActiveModel {
   *
   *    @ActiveField()
   *    chassis?: string = undefined
   *
   *    @ActiveField('Ivan')
   *    driver: string = 'Ivan'
   * }
   *
   * Car.create({ chassis: 'Porche' })
   *
   * ```
   */
  static create<T extends typeof ActiveModel> (
    this: T,
    data:
      | RecursivePartialActiveModel<ModelProperties<T>>
      | ActiveModelSource = {} as any,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): InstanceType<T> {
    if (data instanceof this && opts.lazy) {
      return data as InstanceType<T>
    }

    if (isPrimitiveValue(data)) {
      data = {}
    }

    if (Array.isArray(data)) {
      throw new TypeError(
        `${this.name}.create() expects an object, got an array - use ${this.name}.createFromCollection()`
      )
    }

    const {
      saveInitialState,
      setInstance,
      saveRaw,
      runInCreatingContext,
      runRawConstruction
    } = useMeta()

    return runInCreatingContext(() => {
      if ((opts.sanitize ?? true) && !isSanitized(data)) {
        data = this.sanitize(data as object)
      }
      // The raw instance is built *before* it is wrapped in the proxy, so
      // class-field initializers run unintercepted, ahead of fill().
      const raw = runRawConstruction(() => new this())
      this.sealNonFillable(raw)
      const model = this.wrap(raw)

      setInstance(model)

      this.fill(model, this.stripNonFillable(this.setDefaultAttributes(data)))

      if (opts.tracked) {
        saveRaw(data)
        saveInitialState(model)
      }

      unmarkSanitized(data as object)

      // Fires exactly once, synchronously, after this model - and,
      // transitively, every nested model a `factory` field created along the
      // way - is fully built. Nested factory fields are constructed
      // synchronously inside fill() above via their own create() call, so
      // their `created` has already fired: children emit before their parent,
      // purely from the order of a synchronous call stack. Emitted keyed by
      // `raw` - the same key every `on()`/`once()` subscription and every
      // trap-emitted event uses (see `Ctor.getter()`).
      useEmitter(raw).emit(EventType.created, { target: model })

      return model as InstanceType<T>
    })
  }

  /**
   * Create model from promise
   * @see create
   * @param {Promise<RecursivePartialActiveModel<ModelProperties<T>>} data
   * @param opts
   *
   * @example
   *
   * ```TypeScript
   * const carModel = await Car.asyncCreate( CarService.findOne(carId) )
   * ```
   */
  static async asyncCreate<T extends typeof ActiveModel> (
    this: T,
    data: Promise<
      RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource
    > = Promise.resolve({}) as any,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): Promise<InstanceType<T>> {
    return this.create(await data, opts)
  }

  /**
   * Call create with options.lazy = true
   * @see create
   * @param data
   * @param opts
   */
  static createLazy<T extends typeof ActiveModel> (
    this: T,
    data:
      | RecursivePartialActiveModel<ModelProperties<T>>
      | ActiveModelSource = {},
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): InstanceType<T> {
    return this.create<T>(data, {
      lazy: true,
      tracked: opts.tracked,
      sanitize: false,
    })
  }

  /**
   * Call create by awaited data result with options.lazy = true
   * @see create
   * @param data
   * @param opts
   */
  static async asyncCreateLazy<T extends typeof ActiveModel> (
    this: T,
    data: Promise<
      RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource
    > = Promise.resolve({}) as any,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Promise<InstanceType<T>> {
    return this.createLazy(await data, opts)
  }

  /**
   * Batch factory for creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollection<T extends typeof ActiveModel> (
    this: T,
    data: Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): Array<InstanceType<T>> {
    // only null/undefined items are skipped; every other item goes through create()
    return data
      .filter((item) => item !== null && item !== undefined)
      .map((item) => this.create(item as any, opts))
  }

  /**
   * Batch factory for lazy creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollectionLazy<T extends typeof ActiveModel> (
    this: T,
    data: Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Array<InstanceType<T>> {
    return this.createFromCollection(data, {
      lazy: true,
      tracked: opts.tracked,
      sanitize: false,
    })
  }

  /**
   * Async batch factory for lazy creating instance collection by promise result
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollection<T extends typeof ActiveModel> (
    this: T,
    data: Promise<Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>>,
    opts: FactoryOptions = { lazy: false, tracked: false }
  ): Promise<Array<InstanceType<T>>> {
    return this.createFromCollection<T>(await data, opts)
  }

  /**
   * Async lazy creating collection of current model instance
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollectionLazy<T extends typeof ActiveModel> (
    this: T,
    data: Promise<Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>>,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Promise<Array<InstanceType<T>>> {
    return this.createFromCollectionLazy<T>(await data, opts)
  }

  /**
   * Filling data to **only own fields**
   * @param data
   * @param force
   */
  fill (data: ActiveModelSource, force = false): this {
    const Ctor = <typeof ActiveModel>this.constructor
    Ctor.fill(this, Ctor.sanitize(data || {}), force)
    return this
  }

  /**
   * Filling data to **only own fields** of instance
   * @param model
   * @param data
   * @param force - if need note detect property is fillable
   * @protected
   */
  protected static fill (
    model: InstanceType<typeof this>,
    data: Partial<InstanceType<typeof this>>,
    force = false
  ): InstanceType<typeof this> {
    this.beforeFill(model, data)
    const ownFields = new Set([
      ...Reflect.ownKeys(model),
      ...(this?.__fillable__ || []),
    ])
    for (const prop in data) {
      if (!ownFields.has(prop) && !force) {
        continue
      }
      Reflect.set(model, prop, Reflect.get(data, prop))
    }
    return model
  }

  /**
   * static hook then calling before fill
   * @param _model
   * @param _data
   */
  static beforeFill (
    _model: InstanceType<typeof this>,
    _data: Partial<InstanceType<typeof this>>
  ) {
    //
  }

  /**
   * Clone current instance with unlinked references. The clone is a fully
   * working model (proxied, `hidden` fields included, `readonly`/`fillable: false`
   * locks and the `isTouched()` baseline carried over); instance-level
   * listeners are not copied and no `created` event is emitted for it.
   */
  clone (): this {
    const Ctor = <typeof ActiveModel>this.constructor
    const source = rawOf.get(this) ?? this
    const copy = cloneDeepWith(source, Ctor.cloneCustomizer.bind(Ctor))
    for (const p of getReadonlyWritten(source)) getReadonlyWritten(copy).add(p)
    for (const p of getFillableWritten(source)) getFillableWritten(copy).add(p)
    const model = Ctor.wrap(copy)
    copyTrackingState(this, model)
    Ctor.bindNestedModels(copy, model)
    return model
  }

  /**
   * Re-subscribe `target` to the `touched` of the model(s) now stored under `prop`,
   * so a change deep inside a nested model bubbles up as a `touched` of the parent.
   */
  protected static bindChildren (target: ActiveModel, prop: string | symbol, receiver: unknown) {
    let byProp = childSubscriptions.get(target)
    if (!byProp) {
      byProp = new Map()
      childSubscriptions.set(target, byProp)
    }
    byProp.get(prop)?.forEach((off) => off())
    byProp.delete(prop)

    const stored = Reflect.get(target, prop)
    const children = (Array.isArray(stored) ? stored : [stored]).filter(
      (child): child is ActiveModel => child instanceof ActiveModel
    )
    if (children.length === 0) {
      return
    }
    byProp.set(prop, children.map((child) => child.on(EventType.touched, () => {
      if (bubbling.has(target)) {
        return
      }
      bubbling.add(target)
      try {
        useEmitter(target).emit(EventType.touched, { target: receiver })
      } finally {
        bubbling.delete(target)
      }
    })))
  }

  /** Subscribe a freshly cloned instance to the `touched` of its (already cloned) nested models. */
  protected static bindNestedModels (raw: ActiveModel, model: ActiveModel) {
    for (const prop of Reflect.ownKeys(raw)) {
      if (this.isActiveField(prop)) {
        this.bindChildren(raw, prop, model)
      }
    }
  }

  protected static cloneCustomizer (
    value: object | ActiveModel,
    _key: number | string | undefined,
    parent: unknown
  ): unknown {
    if (value instanceof ActiveModel && Boolean(parent)) {
      return value.clone()
    }
  }

  /**
   * Get registered getters of current model
   */
  static getGetters (): Array<
    string | keyof InstanceType<typeof this> | symbol
  > {
    return [...(this?.__getters__?.keys() ?? [])]
  }

  /**
   * Wrap an instance in a proxy for traps to work
   * @param { ActiveModel } instance Instance for wrapping
   */
  protected static wrap<RType extends ActiveModel> (instance: RType): RType {
    /**
     * `hidden` fields are concealed from `in` and descriptor lookups too - unless
     * the Proxy invariants forbid lying (non-configurable property / non-extensible
     * target, e.g. after makeFreeze()).
     */
    const isHiddenAndConcealable = (target: ActiveModel, prop: string | symbol): boolean => {
      if (!(<typeof ActiveModel>target.constructor).fieldIsHidden(prop as string)) {
        return false
      }
      if (!Object.isExtensible(target)) {
        return false
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(target, prop)
      return descriptor === undefined || descriptor.configurable === true
    }

    const proxy = new Proxy(instance, {
      get (target, prop, receiver) {
        return (<typeof ActiveModel>target.constructor).getter(
          target,
          prop,
          receiver
        )
      },
      set (target, prop, value, receiver) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot assign to "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        const { isNotCreating } = useMeta()
        const isActiveField = (<typeof ActiveModel>(
          target.constructor
        )).isActiveField(prop)
        const oldValue = Reflect.get(target, prop, receiver)

        const isEqual = Object.is(oldValue, value)

        if (isEqual || !isActiveField) {
          // if value for current property is equal previews value or property is not ActiveField → eager return with delegate set value to property
          return Reflect.set(target, prop, value, receiver)
        }

        const Ctor: typeof ActiveModel = <typeof ActiveModel>target.constructor

        if (!Ctor.fieldIsFillable(prop)) {
          const written = getFillableWritten(target)
          if (written.has(prop)) {
            // A real, later write attempt (data can never reach here - see
            // stripNonFillable) - block it loudly, same as always.
            return false
          }
          // The one legitimate write: the class-field initializer's own default,
          // routed through this proxy by `new Model(data)` after `super()` returns.
          // Record it (so nothing can write this field again) and fall through to
          // the normal set pipeline below.
          written.add(prop)
        }

        if (Ctor.fieldIsReadOnly(prop)) {
          const written = getReadonlyWritten(target)
          if (written.has(prop)) {
            // Already set once (at creation, via factory or constructor) — locked.
            // Returning `true` (not `false`) is deliberate: `new Model(data)` wraps
            // `this` in the proxy and fills it *before* the subclass's own class-field
            // initializers run (they execute after `super()` returns, against the
            // now-proxy-bound `this`) — so the initializer's default-value assignment
            // lands here as a second write to the same prop. If this returned `false`,
            // that assignment (`this.id = <default>`) would throw under strict-mode
            // Proxy invariants and the constructor call would blow up. Silently
            // discarding the value instead lets construction complete normally while
            // still preserving the value written the first time.
            return true
          }
          // this is the one allowed write; fall through and let it happen
          written.add(prop)
        }
        // validate value

        Ctor.resolveValidator(prop)?.(target, prop as string, value)

        useEmitter(target).emit(EventType.beforeSetValue, {
          target,
          prop,
          value,
          oldValue,
        })

        const result =
          Ctor.resolveSetter(prop)?.(target, prop as string, value, receiver) ??
          Reflect.set(target, prop, value, receiver)
        useEmitter(target).emit(EventType.afterSetValue, {
          target,
          prop,
          value,
          oldValue,
        })

        // nullabling definition
        if (!isNull(oldValue) && isNull(value)) {
          useEmitter(target).emit(EventType.nulling, {
            target,
            prop,
            value,
            oldValue,
          })
        }

        // only a write that actually went through counts as a change
        Ctor.bindChildren(target, prop, receiver)
        if (isNotCreating()) {
          useEmitter(target).emit(EventType.touched, { target: receiver })
        }
        return result
      },
      apply (target, thisArg, argumentsList) {
        return Reflect.apply(
          target as unknown as Function,
          thisArg,
          argumentsList
        )
      },
      deleteProperty (target, prop: string | symbol) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot delete "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        if ((<typeof ActiveModel>target.constructor).fieldIsProtected(prop)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }

        useEmitter(target).emit(EventType.beforeDeletingAttribute, { target, prop })

        return Reflect.deleteProperty(target, prop)
      },
      defineProperty (target, prop, descriptor) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot define "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        return Reflect.defineProperty(target, prop, descriptor)
      },
      has (target, prop: string | symbol) {
        return !isHiddenAndConcealable(target, prop) && Reflect.has(target, prop)
      },
      getOwnPropertyDescriptor (target, prop) {
        return isHiddenAndConcealable(target, prop)
          ? undefined
          : Reflect.getOwnPropertyDescriptor(target, prop)
      },
      ownKeys (target) {
        const Ctor = <typeof ActiveModel>target.constructor
        const getters = Ctor.getGetters() as Array<string | symbol>
        return Array.from(
          new Set(Reflect.ownKeys(target).concat(getters))
        ).filter((property) => !Ctor.fieldIsHidden(property as string))
      },
    }) as RType
    rawOf.set(proxy, instance)
    return proxy
  }

  /**
   *  Return touched state of model
   */
  isTouched () {
    const { isTouched } = useMeta(this)
    return isTouched()
  }

  constructor (data: ActiveModelSource = {}) {
    const { consumeRawConstruction, runInCreatingContext } = useMeta()
    const Ctor = <typeof ActiveModel>this.constructor
    if (consumeRawConstruction()) {
      return this
    }

    if (isPrimitiveValue(data)) {
      data = {}
    }

    if (!isSanitized(data)) {
      data = Ctor.sanitize(data)
    }

    const model = Ctor.wrap(this)
    const filled = runInCreatingContext(() =>
      Ctor.fill(model, Ctor.stripNonFillable(Ctor.setDefaultAttributes(data)))
    )

    // Deferred, unlike create()'s synchronous emit: at this point in the
    // constructor, the subclass's own class-field initializers (e.g.
    // `prop: T = value`) have NOT run yet - per JS semantics, since this
    // constructor returns a different object (the proxy), they run *after*
    // this constructor body finishes, against the returned `filled`. A
    // microtask is the only point that's reliably after ALL of that
    // synchronous construction (constructor + every field initializer up the
    // prototype chain) has finished, since nothing here ever awaits -
    // firing synchronously here would be honest about "fill() is done" but
    // not about "this model is fully built".
    queueMicrotask(() => {
      // Keyed by the constructor's own raw `this`, not `filled`/the proxy -
      // see the comment on `Ctor.getter()` for why the two are different
      // WeakMap keys and only the raw one matches what `on()`/`once()` and
      // the traps use.
      useEmitter(this).emit(EventType.created, { target: filled })
    })

    return filled
  }

  /**
   * Define mapping handler for current model to target
   * @param target
   * @param handler
   */
  static mapTo<
    RT extends ConstructorType | unknown = unknown,
    T extends typeof ActiveModel = typeof ActiveModel
  > (
    this: T,
    target: RT extends MapTarget ? RT : MapTarget,
    handler: HandlerMapTo<T, RT extends ConstructorType ? InstanceType<RT> : unknown>
  ): void {
    const { setMapTo } = useMapper<RT, T>(this as T)
    setMapTo<RT extends ConstructorType ? InstanceType<RT> : unknown>(
      target,
      handler
    )
  }

  /**
   * Run mapping current instance to target
   * @param target
   * @param lazy
   * @param args
   */
  mapTo (target: MapTarget, lazy = true, ...args: unknown[]): MapTarget | this {
    const { mapTo, hasMapping } = useMapper(
      this.constructor as typeof ActiveModel
    )

    if (!hasMapping(target) && !lazy) {
      throw new Error(`Mapping for target not found`)
    }
    const handler = mapTo(target)
    return handler ? handler(this, ...args) as MapTarget : this.clone()
  }

  /**
   * Check model has mapping configuration for target
   * @param target
   */
  hasMapping (target: MapTarget) {
    const { hasMapping } = useMapper(this.constructor as typeof ActiveModel)
    return hasMapping(target)
  }

  /**
   * Check exist mapping for current model to target
   * @param target
   */
  static hasMapping<
    RT extends ConstructorType | unknown = unknown,
    T extends typeof ActiveModel = typeof ActiveModel
  > (this: T, target: RT extends MapTarget ? RT : MapTarget) {
    const { hasMapping } = useMapper<RT, T>(this as T)
    return hasMapping(target)
  }
}
