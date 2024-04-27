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
  type ConstructorType
} from './types'
import cloneDeepWith from 'lodash/clonedeepwith'
import { isSanitized, markSanitized, unmarkSanitized, useMeta } from './meta'
import {
  type ModelProperties,
  type RecursivePartialActiveModel,
  isComplexValue,
  isPrimitiveValue,
  getValue,
  traverse,
  isNull,
  isPOJOSSafetyValue, isSymbol
} from './utils'
import { useEmitter } from './emitter'
import { type HandlerMapTo, type MapTarget, useMapper } from "./mapper";

const isTouched = Symbol('@touched')

/**
 * Class ActiveModel
 */
export class ActiveModel {
  [isTouched]: boolean = false;
  
  /**
   *
   */
  get emitter () {
    const { getListeners, addListener } = useEmitter(this)
    return {
      emit(event: EventType, payload?: any) {
        for (const cb of getListeners(event)) {
          cb(payload)
        }
      },
      on(event: EventType, cb: ActiveModelHookListener) {
        return addListener(event, cb)
      },
      once(event: EventType, cb: ActiveModelHookListener) {
        return addListener(event, cb, true)
      }
    }
  }


  protected static defineStaticProperty (propertyName: SC, fallback: () => any) {
    // @ts-ignore
    this[propertyName] = this.hasOwnProperty(propertyName) ? this[propertyName]!: fallback()
    return this
  }


  protected static setDefaultAttributes (data: AnyClassInstance): Partial<InstanceType<typeof this>> {
    const attributes: Record<string, any> = this[SC.__attributes__] ? Object.fromEntries(this[SC.__attributes__]?.entries() || []) : {}
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

  protected static fieldIsReadOnly (prop: string | keyof InstanceType<typeof this> | symbol): boolean {
    return this[SC.__readonly__]?.has(prop) ?? false
  }

  protected static fieldIsHidden (prop: string | keyof InstanceType<typeof this> | symbol): boolean {
    return this[SC.__hidden__]?.has(prop) ?? false
  }

  protected static fieldIsFillable (prop: string | keyof InstanceType<typeof this> | symbol): boolean {
    return this[SC.__fillable__]?.has(prop) ?? false
  }

  protected static fieldIsProtected (prop:  string | keyof InstanceType<typeof this> | symbol): boolean {
    return this[SC.__protected__]?.has(prop) ?? false
  }
  
  
  protected static getter<Result = unknown>(target: ActiveModel, prop: string | keyof InstanceType<typeof this> | symbol, receiver?: ActiveModel): Result {
    const Ctor = (<typeof ActiveModel> target.constructor)
    const resolvedGetter = Ctor?.resolveGetter?.(prop)
    return resolvedGetter?.(target, prop as string, receiver) ?? Reflect.get(target, prop, receiver)
  }

  protected static [SC.__getters__]?: Map<string | keyof InstanceType<typeof this> | symbol, Getter<InstanceType<typeof this>>>
  protected static [SC.__setters__]?: Map<string | keyof InstanceType<typeof this> | symbol, Setter<InstanceType<typeof this>>>
  protected static [SC.__attributes__]?: Map<string | keyof InstanceType<typeof this> | symbol, any>
  protected static [SC.__validators__]?: Map<string | keyof InstanceType<typeof this> | symbol, Validator<any>>
  protected static [SC.__fillable__]?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static [SC.__protected__]?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static [SC.__readonly__]?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static [SC.__hidden__]?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static [SC.__activeFields__]?: Set<string | keyof InstanceType<typeof this> | symbol>

  /**
   * Add field name to hidden scope
   * @param prop
   */
  static addToHidden (...prop: Array<string | keyof InstanceType<typeof this> | symbol>): void {
    this.defineStaticProperty(SC.__hidden__, () => new Set(this[SC.__hidden__] || []))
    prop.forEach(p => this[SC.__hidden__]!.add(p))
  }
  
  /**
   * add properties to fields
   * @param prop
   */
  static addToFields (...prop: Array<string | keyof InstanceType<typeof this> | symbol>): void {
    this.defineStaticProperty(SC.__activeFields__, () => new Set(this[SC.__activeFields__] || []))
    prop.forEach(p => this[SC.__activeFields__]!.add(p))
  }
  
  /**
   * check property is active field
   * @param prop
   * @protected
   */
  protected static isActiveField (prop: string | keyof InstanceType<typeof this> | symbol) {
    return this?.__activeFields__?.has(prop) ?? false
  }

  /**
   *  Add field name to readonly scope
   * @param prop
   */
  static addToReadonly (prop: string | keyof InstanceType<typeof this> | symbol): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__readonly__, () => new Set(this[SC.__readonly__] || []))
    this.__readonly__!.add(prop)
  }

  /**
   * Add field name to protected scope
   * @param prop
   */
  static addToProtected (prop: string | keyof InstanceType<typeof this> | symbol): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__protected__, () => new Set(this[SC.__protected__] || []))
    this[SC.__protected__]!.add(prop)
  }

  /**
   * Add field name to fillable scope
   * @param prop
   */
  static addToFillable (prop: string | keyof InstanceType<typeof this> | symbol): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__fillable__, () => new Set(this[SC.__fillable__] || []))
    this[SC.__fillable__]!.add(prop)
  }


  /**
   * define getter
   * @param prop
   * @param handler
   */
  static defineGetter (prop: string | keyof InstanceType<typeof this> | symbol, handler: Getter<any>): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__getters__, () => new Map(this[SC.__getters__] || []))
    this[SC.__getters__]!.set(prop, handler)
  }

  /**
   * resolve getter
   * @param prop
   */
  static resolveGetter (prop: string | keyof InstanceType<typeof this> | symbol): Getter<any> | undefined {
    const getter = this[SC.__getters__]?.get(prop)
    return getter?.bind(this)
  }

  /**
   * define setter for field by name
   * @param prop
   * @param handler
   */
  static defineSetter (prop: string | keyof InstanceType<typeof this> | symbol, handler: Setter<any>): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__setters__, () => new Map(this[SC.__setters__] || []))
    this[SC.__setters__]!.set(prop, handler)
  }

  /**
   * resolve setter for field by name
   * @param prop
   */
  protected static resolveSetter (prop: string | keyof InstanceType<typeof this> | symbol): Setter<any> | undefined {
    const setter = this[SC.__setters__]?.get(prop)
    return setter?.bind(this)
  }

  /**
   *  Define validator for field by name
   * @param prop
   * @param handler
   */
  static defineValidator (prop: string | keyof InstanceType<typeof this> | symbol, handler: Validator<any>): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__validators__, () => new Map(this[SC.__validators__] || []))
    this[SC.__validators__]!.set(prop, handler)
  }

  /**
   * Resolve validator for field by name
   * @param prop
   */
  static resolveValidator(prop: string | keyof InstanceType<typeof this> | symbol): Validator<any> | undefined {
    const validator = this[SC.__validators__]?.get(prop)
    return validator?.bind(this)
  }

  /**
   * Define attribute (default value) for field by name
   * @param prop
   * @param value
   */
  static defineAttribute (prop: string | keyof InstanceType<typeof this> | symbol, value: any): void {
    this.addToFields(prop)
    this.defineStaticProperty(SC.__attributes__, () => new Map(this[SC.__attributes__] || []))
    this[SC.__attributes__]!.set(prop, value)
  }

  /**
   * Static method for converting to JSON
   */
  static toJSON (instance: ActiveModel | ActiveModel[]): object | object[] {
    if (typeof instance !== 'object' || instance === null) {
      return instance
    }

    return Array.isArray(instance) ? instance.map(i => this.toJSON(i)) : Object.keys(instance).reduce((a: { [key: string] : any }, b: string) => {
      // @ts-ignore
      const value = (<typeof ActiveModel> instance.constructor)?.getter?.(instance, b) ?? Reflect.get(instance, b)
      if (!isPOJOSSafetyValue(value) || isSymbol(b)) {
        return a
      }
      a[b] = value
      if (typeof a[b] === 'object' || Array.isArray(a[b])) {
        a[b] = this.toJSON(a[b])
      }
      return a
    }, {})
  }
  
  /**
   * Convert current instance to JSON structure
   */
  toJSON () {
    return (<typeof ActiveModel> this.constructor).toJSON(this)
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
  static sanitize (data: object | ActiveModel): Partial<InstanceType<typeof this>> {
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
    data: RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource = {} as any,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): InstanceType<T> {
    if (data instanceof this && opts.lazy) {
      return data as InstanceType<T>
    }

    if (isPrimitiveValue(data)) data = {}

    const { saveInitialState, setInstance, startCreating, endCreating, saveRaw } = useMeta()

    startCreating()

    if ((opts.sanitize ?? true) && !isSanitized(data)) {
      data = this.sanitize(data)
    }
    const model = this.wrap(new this())

    setInstance(model)

    endCreating()

    this.fill(model, this.setDefaultAttributes(data)) as InstanceType<T>

    if (opts.tracked) {
      saveRaw(data)
    }

    if (opts.tracked) {
      saveInitialState(model)
    }

    unmarkSanitized(data)

    return model as InstanceType<T>
  }
  
  /**
   * Create model from promise
   * @see create
   * @param {Promise<RecursivePartialActiveModel<ModelProperties<T>>} data
   * @param opts
   *
   * @example
   *
   * ```typescript
   * const carModel = await Car.asyncCreate( CarService.findOne(carId) )
   * ```
   */
  static async asyncCreate<T extends typeof ActiveModel> (
    this: T,
    data: Promise<RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource> = Promise.resolve({}) as any,
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
  static createLazy <T extends typeof ActiveModel> (
    this: T,
    data: RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource = {},
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): InstanceType<T> {
    return this.create<T>(data, { lazy: true, tracked: opts.tracked, sanitize: false })
  }
  
  /**
   * Call create by awaited data result with options.lazy = true
   * @see create
   * @param data
   * @param opts
   */
  static async asyncCreateLazy<T extends typeof ActiveModel> (
    this: T,
    data: Promise<RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource> = Promise.resolve({}) as any,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Promise<InstanceType<T>> {
    return this.createLazy(await data, opts)
  }
  
  /**
   * Batch factory for creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollection<T extends typeof ActiveModel>(this: T, data: Array<T | ActiveModelSource>, opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }) {
    return data
      .filter((s: unknown) => s)
      .map(item => this.create(item, opts))
  }
  
  /**
   * Batch factory for lazy creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollectionLazy<T extends typeof ActiveModel>(this: T, data: Array<T | ActiveModelSource>, opts: Pick<FactoryOptions, 'tracked'> = { tracked: false } ) {
    return this.createFromCollection(data, { lazy: true, tracked: opts.tracked, sanitize: false }  )
  }
  
  /**
   * Async batch factory for lazy creating instance collection by promise result
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollection<T extends typeof ActiveModel>(this: T, data: Promise<Array<T | ActiveModelSource>>, opts: FactoryOptions = { lazy: false, tracked: false } ) {
    return this.createFromCollection<T>(await data, opts)
  }
  
  /**
   * Async lazy creating collection of current model instance
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollectionLazy<T extends typeof ActiveModel>(this: T, data: Promise<Array<T | ActiveModelSource>>, opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }  ) {
    return this.createFromCollectionLazy<T>(await data, opts)
  }
  

  /**
   * Filling data to **only own fields**
   * @param data
   * @param force
   */
  fill (data: ActiveModelSource, force = false): this {
    const Ctor = (<typeof ActiveModel> this.constructor)
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
  protected static fill (model: InstanceType<typeof this>, data: Partial<InstanceType<typeof this>>, force = false): InstanceType<typeof this> {
    this.beforeFill(model, data)
    const ownFields = new Set([...Reflect.ownKeys(model), ...this?.__fillable__ || []])
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
   * @param model
   * @param data
   */
  static beforeFill (model: InstanceType<typeof this>, data: Partial<InstanceType<typeof this>>) {
    //
  }


  /**
   * Clone current instance with unlinked references
   */
  clone (): this {
    const Ctor = (<typeof ActiveModel> this.constructor)
    return cloneDeepWith(this, Ctor.cloneCustomizer.bind(Ctor))
  }
  
  protected static cloneCustomizer (value: any, _key: number | string | undefined, parent: any): any {
    if (value instanceof ActiveModel && Boolean(parent)) {
      return this.wrap(cloneDeepWith(value, this.cloneCustomizer.bind(this)))
    }
  }

  /**
   * Get registered getters of current model
   */
  static getGetters (): Array<string | keyof InstanceType<typeof this>  | symbol> {
    return [...this?.__getters__?.keys() ?? []]
  }

  /**
   * Wrap an instance in a proxy for traps to work
   * @param { ActiveModel } instance Instance for wrapping
   */
  protected static wrap <RType extends ActiveModel, P = keyof InstanceType<typeof this> | string | symbol>(instance: RType): RType {
    return new Proxy(instance, {
      get (target, prop, receiver) {
        return (<typeof ActiveModel>target.constructor).getter(target, prop, receiver)
      },
      set (target, prop, value, receiver) {
        const { isNotCreating } = useMeta()
        const isActiveField = (<typeof ActiveModel>target.constructor).isActiveField(prop)
        const oldValue = Reflect.get(target, prop, receiver)
        // @ts-ignore
        const isEqual = Object.is(oldValue, value)
        if (!isEqual && isNotCreating()) {
          target[isTouched] = true
          target.emitter.emit(EventType.touched)
        }
        
        if (isEqual || !isActiveField) {
          // if value for current property is equal previews value or property is not ActiveField → eager return with delegate set value to property
          return Reflect.set(target, prop, value, receiver)
        }
        const defineListenerTouchValue = (value: any) => {
          
          if (value instanceof ActiveModel) {
            value.emitter.on(EventType.touched, () => {
              target[isTouched] = true
            })
          }
        }
        Array.isArray(value) ? value.forEach(v => defineListenerTouchValue(v)): defineListenerTouchValue(value)
        
        const Ctor: typeof ActiveModel = (<typeof ActiveModel> target.constructor)
        
        if (!Ctor.fieldIsFillable(prop) || Ctor.fieldIsReadOnly(prop)) {
          return false
        }
        // validate value
        
        Ctor.resolveValidator(prop)?.(target, prop as string, value)
        
        target.emitter.emit(EventType.beforeSetValue, { target, prop, value, oldValue })

        const result = Ctor.resolveSetter(prop)?.(target, prop as string, value, receiver) ?? Reflect.set(target, prop, value, receiver)
        target.emitter.emit(EventType.afterSetValue, { target, prop, value, oldValue })
        
        // nullabling definition
        if (!isNull(oldValue) && isNull(value)) {
          target.emitter.emit(EventType.nulling, { target, prop, value, oldValue })
        }
        return result
      },
      apply (target, thisArg, argumentsList) {
        return Reflect.apply(target as unknown as Function, thisArg, argumentsList)
      },
      deleteProperty (target, prop: string | symbol) {
        if ((<typeof ActiveModel> target.constructor).fieldIsProtected(prop)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }
        
        target.emitter.emit(EventType.beforeDeletingAttribute, { target, prop})
        
        return Reflect.deleteProperty(target, prop)
      },
      has (target, prop: string | symbol) {
        return Reflect.has(target, prop)
      },
      ownKeys (target) {
        const Ctor = <typeof ActiveModel> target.constructor
        const getters = Ctor.getGetters() as Array<string | symbol>
        return Array.from(new Set(Reflect.ownKeys(target).concat(getters)))
          .filter(property => !Ctor.fieldIsHidden(property as string))
      }
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
    const { isCreating } = useMeta()
    const Ctor = (<typeof ActiveModel> this.constructor)
    if ( isCreating() ) {
      return this
    }

    if (isPrimitiveValue(data)) data = {}
    if (!isSanitized(data)) {
      data = Ctor.sanitize(data)
    }
    const model = Ctor.wrap(this)
    return Ctor.fill(model, Ctor.setDefaultAttributes(data))
  }
  
  /**
   * Define mapping handler for current model to target
   * @param target
   * @param handler
   */
  static mapTo<RT extends ConstructorType | any = any, T extends typeof ActiveModel = typeof ActiveModel>(
    this: T,
    target: RT extends MapTarget ? RT : MapTarget,
    handler: HandlerMapTo<T, RT extends ConstructorType ? InstanceType<RT> : any> ): void {
    const { setMapTo } = useMapper<RT, T>(this as T)
    setMapTo<RT extends ConstructorType ? InstanceType<RT> : RT>(target, handler)
  }
  
  /**
   * Run mapping current instance to target
   * @param target
   * @param lazy
   */
  mapTo (target: MapTarget, lazy = true): MapTarget | this {
    const { mapTo, hasMapping } = useMapper(this.constructor as typeof ActiveModel)
    
    if (!hasMapping(target) && !lazy) {
      throw new Error(`Mapping fo target not found`)
    }
    return hasMapping(target) ? mapTo(target)?.(this)! : this.clone()
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
  static hasMapping<RT extends ConstructorType | any = any, T extends typeof ActiveModel = typeof ActiveModel>(
    this: T,
    target: RT extends MapTarget ? RT : MapTarget
  ) {
    const { hasMapping } = useMapper<RT, T>(this as T)
    return hasMapping(this)
  }
  
}
