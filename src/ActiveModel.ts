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
  type ConstructorType,
  type HandlerMapTo,
  type MapTarget,
} from './types'
import cloneDeepWith from 'lodash-es/cloneDeepWith'
import { isSanitized, markSanitized, unmarkSanitized, useMeta } from './meta'
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

const isTouched = Symbol('@touched')

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
  [isTouched]: boolean = false

  /**
   *
   */
  get emitter () {
    const { getListeners, addListener } = useEmitter(this)
    return {
      emit (event: EventType, payload?: unknown) {
        for (const cb of getListeners(event)) {
          cb(payload)
        }
      },
      on (event: EventType, cb: ActiveModelHookListener) {
        return addListener(event, cb)
      },
      once (event: EventType, cb: ActiveModelHookListener) {
        return addListener(event, cb, true)
      },
    }
  }

  protected static defineStaticProperty (
    propertyName: SC,
    fallback: () => unknown
  ) {
    // @ts-ignore
    this[propertyName] = this.hasOwnProperty(propertyName)
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

        const value = getValue(attributes?.[prop])
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
      // built-in getters (e.g. `emitter`) through the proxy resolves `this`
      // to the same raw instance the internal set/delete traps use to emit
      // events. Otherwise `model.emitter.on(...)` registers against the proxy
      // while `target.emitter.emit(...)` inside the traps fires against the
      // raw target, and the listener never sees the event.
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

    return Array.isArray(instance)
      ? instance.map((i) => this.toJSON(i))
      : Object.keys(instance).reduce(
        (a: { [key: string]: unknown }, b: string) => {
          // @ts-ignore
          const value =
            (<typeof ActiveModel>instance.constructor)?.getter?.(
              instance as ActiveModel,
              b
            ) ?? Reflect.get(instance, b)
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
   * Make model readonly
   * @return {Readonly<this>}
   */
  makeFreeze (): Readonly<this> {
    return Object.freeze(this)
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

    const {
      saveInitialState,
      setInstance,
      startCreating,
      endCreating,
      saveRaw,
      runInCreatingContext
    } = useMeta()
      return runInCreatingContext(() => {
        startCreating()
        if ((opts.sanitize ?? true) && !isSanitized(data)) {
          data = this.sanitize(data  as object)
        }
        const raw = new this()
        this.sealNonFillable(raw)
        const model = this.wrap(raw)

        setInstance(model)

        endCreating()

        this.fill(model, this.stripNonFillable(this.setDefaultAttributes(data))) as InstanceType<T>

        if (opts.tracked) {
          saveRaw(data)
          saveInitialState(model)
        }

        unmarkSanitized(data as object)
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
    data: Array<T | ActiveModelSource>,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ) {
    return data.filter((s: unknown) => s).map((item) => this.create(item, opts))
  }

  /**
   * Batch factory for lazy creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollectionLazy<T extends typeof ActiveModel> (
    this: T,
    data: Array<T | ActiveModelSource>,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ) {
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
    data: Promise<Array<T | ActiveModelSource>>,
    opts: FactoryOptions = { lazy: false, tracked: false }
  ) {
    return this.createFromCollection<T>(await data, opts)
  }

  /**
   * Async lazy creating collection of current model instance
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollectionLazy<T extends typeof ActiveModel> (
    this: T,
    data: Promise<Array<T | ActiveModelSource>>,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ) {
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
   * Clone current instance with unlinked references
   */
  clone (): this {
    const Ctor = <typeof ActiveModel>this.constructor
    return cloneDeepWith(this, Ctor.cloneCustomizer.bind(Ctor))
  }

  protected static cloneCustomizer (
    value: object | ActiveModel,
    _key: number | string | undefined,
    parent: unknown
  ): unknown {
    if (value instanceof ActiveModel && Boolean(parent)) {
      return this.wrap(cloneDeepWith(value, this.cloneCustomizer.bind(this)))
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
  protected static wrap<
    RType extends ActiveModel,
    P = keyof InstanceType<typeof this> | string | symbol
  > (instance: RType): RType {
    return new Proxy(instance, {
      get (target, prop, receiver) {
        return (<typeof ActiveModel>target.constructor).getter(
          target,
          prop,
          receiver
        )
      },
      set (target, prop, value, receiver) {
        const { isNotCreating } = useMeta()
        const isActiveField = (<typeof ActiveModel>(
          target.constructor
        )).isActiveField(prop)
        const oldValue = Reflect.get(target, prop, receiver)

        const isEqual = Object.is(oldValue, value)
        if (!isEqual && isNotCreating()) {
          target[isTouched] = true
          target.emitter.emit(EventType.touched)
        }

        if (isEqual || !isActiveField) {
          // if value for current property is equal previews value or property is not ActiveField → eager return with delegate set value to property
          return Reflect.set(target, prop, value, receiver)
        }

        const defineListenerTouchValue = (value: unknown) => {
          if (value instanceof ActiveModel) {
            value.emitter.on(EventType.touched, () => {
              target[isTouched] = true
            })
          }
        }
        Array.isArray(value)
          ? value.forEach((v) => defineListenerTouchValue(v))
          : defineListenerTouchValue(value)

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

        target.emitter.emit(EventType.beforeSetValue, {
          target,
          prop,
          value,
          oldValue,
        })

        const result =
          Ctor.resolveSetter(prop)?.(target, prop as string, value, receiver) ??
          Reflect.set(target, prop, value, receiver)
        target.emitter.emit(EventType.afterSetValue, {
          target,
          prop,
          value,
          oldValue,
        })

        // nullabling definition
        if (!isNull(oldValue) && isNull(value)) {
          target.emitter.emit(EventType.nulling, {
            target,
            prop,
            value,
            oldValue,
          })
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
        if ((<typeof ActiveModel>target.constructor).fieldIsProtected(prop)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }

        target.emitter.emit(EventType.beforeDeletingAttribute, { target, prop })

        return Reflect.deleteProperty(target, prop)
      },
      has (target, prop: string | symbol) {
        return Reflect.has(target, prop)
      },
      ownKeys (target) {
        const Ctor = <typeof ActiveModel>target.constructor
        const getters = Ctor.getGetters() as Array<string | symbol>
        return Array.from(
          new Set(Reflect.ownKeys(target).concat(getters))
        ).filter((property) => !Ctor.fieldIsHidden(property as string))
      },
    }) as RType
  }

  /**
   *  Return touched state of model
   */
  isTouched () {
    const { isTouched } = useMeta(this)
    return isTouched()
  }

  /**
   * Starting tracking changes data in current instance
   */
  startTracking () {
    const { saveInitialState } = useMeta(this)
    saveInitialState(this)
  }

  constructor (data: ActiveModelSource = {}) {
    const { isCreating, endCreating } = useMeta()
    const Ctor = <typeof ActiveModel>this.constructor
    if (isCreating()) {
      endCreating()
      return this
    }

    if (isPrimitiveValue(data)) {
      data = {}
    }

    if (!isSanitized(data)) {
      data = Ctor.sanitize(data)
    }

    const model = Ctor.wrap(this)
    return Ctor.fill(model, Ctor.stripNonFillable(Ctor.setDefaultAttributes(data)))
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
    handler: HandlerMapTo<T, RT extends ConstructorType ? InstanceType<RT> : RT>
  ): void {
    const { setMapTo } = useMapper<RT, T>(this as T)
    setMapTo<RT extends ConstructorType ? InstanceType<RT> : RT>(
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
    return hasMapping(target) ? mapTo(target)?.(this, ...args)! : this.clone()
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
