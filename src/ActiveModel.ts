import type { ActiveModelSource, AnyClassInstance, FactoryOptions, Getter, Setter, Validator } from './types'
import { cloneDeepWith } from 'lodash'
import deepEqual from 'fast-deep-equal/es6'
import { useMeta } from './meta'

type StaticContainers = '__getters__' | '__setters__' | '__attributes__' | '__validators__' | '__fillable__' | '__protected__' | '__readonly__' | '__hidden__' | '__activeFields__'

export class ActiveModel {
  protected static defineStaticProperty (propertyName: StaticContainers, fallback: () => any) {
    this[propertyName] = this.hasOwnProperty(propertyName) ? this[propertyName]!: fallback()
    return this
  }
  
  protected static setDefaultAttributes (data: AnyClassInstance, $defaultAttributes: ActiveModel | object | AnyClassInstance): AnyClassInstance | object {
    for (const prop in $defaultAttributes) {
        if (Object.prototype.hasOwnProperty.call($defaultAttributes, prop)) {
        data[prop] = Reflect.has(data, prop) ? data[prop] : $defaultAttributes[prop]
      }
    }
    return data
  }
  
  protected static fieldIsReadOnly (prop: string | keyof InstanceType<typeof this> | symbol): boolean {
    return this.__readonly__?.has(prop) ?? false
  }
  
  protected static fieldIsHidden (prop: string | keyof InstanceType<typeof this> | symbol): boolean {
    return this.__hidden__?.has(prop) ?? false
  }
  
  protected static fieldIsFillable (prop: string | keyof InstanceType<typeof this> | symbol): boolean {
    return this.__fillable__?.has(prop) ?? false
  }
  
  protected static fieldIsProtected (prop:  string | keyof InstanceType<typeof this> | symbol): boolean {
    return this.__protected__?.has(prop) ?? false
  }
  
  protected static getter<Result = unknown>(target: ActiveModel, prop: string | keyof InstanceType<typeof this> | symbol, receiver?: ActiveModel): Result {
    const Ctor = (<typeof ActiveModel> target.constructor)
    const resolvedGetter = Ctor?.resolveGetter?.(prop)
    return resolvedGetter?.(target, prop as string, receiver) ?? Reflect.get(target, prop, receiver)
  }

  protected static __getters__?: Map<string | keyof InstanceType<typeof this> | symbol, Getter<InstanceType<typeof this>>>
  protected static __setters__?: Map<string | keyof InstanceType<typeof this> | symbol, Setter<InstanceType<typeof this>>>
  protected static __attributes__?: Map<string | keyof InstanceType<typeof this> | symbol, any>
  protected static __validators__?: Map<string | keyof InstanceType<typeof this> | symbol, Validator<any>>
  protected static __fillable__?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static __protected__?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static __readonly__?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static __hidden__?: Set<string | keyof InstanceType<typeof this> | symbol>
  protected static __activeFields__?: Set<string | keyof InstanceType<typeof this> | symbol>
  

  /**
   * Add field name to hidden scope
   * @param prop
   */
  static addToHidden (...prop: Array<string | keyof InstanceType<typeof this> | symbol>): void {
    this.defineStaticProperty('__hidden__', () => new Set(this.__hidden__ || []))
    prop.forEach(p => this.__hidden__!.add(p))
  }
  
  static addToFields (...prop: Array<string | keyof InstanceType<typeof this> | symbol>): void {
    this.defineStaticProperty('__activeFields__', () => new Set(this.__activeFields__ || []))
    prop.forEach(p => this.__activeFields__!.add(p))
  }
  
  protected static isActiveField (prop: string | keyof InstanceType<typeof this> | symbol) {
    return this?.__activeFields__?.has(prop) ?? false
  }

  /**
   *  Add field name to readonly scope
   * @param prop
   */
  static addToReadonly (prop: string | keyof InstanceType<typeof this> | symbol): void {
    this.addToFields(prop)
    this.defineStaticProperty('__readonly__', () => new Set(this.__readonly__ || []))
    this.__readonly__!.add(prop)
  }

  /**
   * Add field name to protected scope
   * @param prop
   */
  static addToProtected (prop: string | keyof InstanceType<typeof this> | symbol): void {
    this.addToFields(prop)
    this.defineStaticProperty('__protected__', () => new Set(this.__protected__ || []))
    this.__protected__!.add(prop)
  }

  /**
   * Add field name to fillabe scope
   * @param prop
   */
  static addToFillable (prop: string | keyof InstanceType<typeof this> | symbol): void {
    this.addToFields(prop)
    this.defineStaticProperty('__fillable__', () => new Set(this.__fillable__ || []))
    this.__fillable__!.add(prop)
  }


  /**
   * define getter
   * @param prop
   * @param handler
   */
  static defineGetter (prop: string | keyof InstanceType<typeof this> | symbol, handler: Getter<any>): void {
    this.addToFields(prop)
    this.defineStaticProperty('__getters__', () => new Map(this.__getters__ || []))
    this.__getters__!.set(prop, handler)
  }

  /**
   * resolve getter
   * @param prop
   */
  static resolveGetter (prop: string | keyof InstanceType<typeof this> | symbol): Getter<any> | undefined {
    const getter = this.__getters__?.get(prop)
    return getter?.bind(this)
  }

  /**
   * define setter for field by name
   * @param prop
   * @param handler
   */
  static defineSetter (prop: string | keyof InstanceType<typeof this> | symbol, handler: Setter<any>): void {
    this.addToFields(prop)
    this.defineStaticProperty('__setters__', () => new Map(this.__setters__ || []))
    this.__setters__!.set(prop, handler)
  }

  /**
   * resolve setter for field by name
   * @param prop
   */
  protected static resolveSetter (prop: string | keyof InstanceType<typeof this> | symbol): Setter<any> | undefined {
    const setter = this.__setters__?.get(prop)
    return setter?.bind(this)
  }

  /**
   *  Define validator for field by name
   * @param prop
   * @param handler
   */
  static defineValidator (prop: string | keyof InstanceType<typeof this> | symbol, handler: Validator<any>): void {
    this.addToFields(prop)
    this.defineStaticProperty('__validators__', () => new Map(this.__validators__ || []))
    this.__validators__!.set(prop, handler)
  }

  /**
   * Resolve validator for field by name
   * @param prop
   */
  static resolveValidator(prop: string | keyof InstanceType<typeof this> | symbol): Validator<any> | undefined {
    const validator = this.__validators__?.get(prop)
    return validator?.bind(this)
  }

  /**
   * Define attribute (default value) for field by name
   * @param prop
   * @param value
   */
  static defineAttribute (prop: string | keyof InstanceType<typeof this> | symbol, value: any): void {
    this.addToFields(prop)
    this.defineStaticProperty('__attributes__', () => new Map(this.__attributes__ || []))
    this.__attributes__!.set(prop, value)
  }

  /**
   * Resolve all defined attributes for fields
   * @private
   */
  private static resolveAttributes (): Partial<InstanceType<typeof this>> {
    const attributes = this.__attributes__ ? Object.fromEntries(this.__attributes__.entries()) : {}
    for (const [key, value] of Object.entries(attributes)) {
      attributes[key] = typeof value === 'function' ? value() : value
    }
    return attributes
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
      a[b] = (<typeof ActiveModel> instance.constructor)?.getter?.(instance, b) ?? Reflect.get(instance, b)
      if (typeof a[b] === 'object' || Array.isArray(a[b])) {
        a[b] = this.toJSON(a[b])
      }
      return a
    }, {})
  }

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
    return cloneDeepWith(data, this.cloneCustomizer.bind(this))
  }

  /**
   * Factory method for create new instance
   * @param data
   * @param opts
   */
  static create<T extends typeof ActiveModel> (this: T, data: T | ActiveModelSource = {}, opts: FactoryOptions = { lazy: false, tracked: false }): InstanceType<T> {
    if (data instanceof this && opts.lazy) {
      return data as InstanceType<T>
    }
    const model = new this()
    const {  saveInitialState, saveRaw } = useMeta(model)
    
    const source = this.sanitize(data || {})
    if (opts.tracked) {
      saveRaw(data)
    }
    
    const initialState =  this.fill(model, this.setDefaultAttributes(source, this.resolveAttributes())) as InstanceType<T>
    if (opts.tracked) {
      saveInitialState(initialState)
    }
    
    return initialState
  }
  
  static createLazy <T extends typeof ActiveModel> (this: T, data: T | ActiveModelSource = {}, opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }): InstanceType<T> {
    return this.create<T>(data, { lazy: true, tracked: opts.tracked })
  }
  /**
   * Batch factory for creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollection<T extends typeof ActiveModel>(this: T, data: Array<T | ActiveModelSource>, opts: FactoryOptions = { lazy: false, tracked: false }) {
    const attributes = this.resolveAttributes()
    const create = (data: T | ActiveModelSource): InstanceType<T> => {
      if (data instanceof this && opts.lazy) {
        return data as InstanceType<T>
      }
      const model = new this()
      const { saveRaw, saveInitialState } = useMeta(model)
      opts.tracked && saveRaw(data)
      const source = this.sanitize(data || {})
      const initialState =  this.fill(model, this.setDefaultAttributes(source, attributes)) as InstanceType<T>
      opts.tracked && saveInitialState(initialState)
      return initialState
    }
    return data
      .filter((s: unknown) => s)
      .map(item => create(item))
  }
  
  static createFromCollectionLazy<T extends typeof ActiveModel>(this: T, data: Array<T | ActiveModelSource>, opts: Pick<FactoryOptions, 'tracked'> = { tracked: false} ) {
    return this.createFromCollection(data, { lazy: true, tracked: opts.tracked}  )
  }
  
  static async asyncCreateFromCollection<T extends typeof ActiveModel>(this: T, data: Promise<Array<T | ActiveModelSource>>, opts: FactoryOptions = { lazy: false, tracked: false} ) {
    return this.createFromCollection<T>(await data, opts)
  }
  
  /**
   * Filling data to **only own fields**
   * @param data
   */
  fill (data: ActiveModelSource): this {
    const Ctor = (<typeof ActiveModel> this.constructor)
    Ctor.fill(this, Ctor.sanitize(data || {}))
    return this
  }
  
  /**
   * Filling data to **only own fields** of instance
   * @param model
   * @param data
   * @protected
   */
  protected static fill (model: InstanceType<typeof this>, data: Partial<InstanceType<typeof this>>): InstanceType<typeof this> {
    const ownFields = new Set(Reflect.ownKeys(model))
    for (const prop in data) {
      if (!ownFields.has(prop)) {
        continue
      }
      Reflect.set(model, prop, Reflect.get(data,prop))
    }
    return model
  }
  

  /**
   *
   */
  clone (): this {
    const Ctor = (<typeof ActiveModel> this.constructor)
    return cloneDeepWith(this, Ctor.cloneCustomizer.bind(Ctor))
  }

  protected static cloneCustomizer (value: any, key: number | string | undefined, parent: any): any {
    if (value instanceof ActiveModel && Boolean(parent)) {
      return this.wrap(cloneDeepWith(value, this.cloneCustomizer.bind(this)))
    }
  }

  /**
   *
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
        if (!(<typeof ActiveModel>target.constructor).isActiveField(prop)) {
          return Reflect.set(target, prop, value, receiver)
        }
        // @ts-ignore
        if (deepEqual(target[prop], value)) {
          return Reflect.set(target, prop, value, receiver)
        }
        const Ctor: typeof ActiveModel = (<typeof ActiveModel> target.constructor)
        if (!Ctor.fieldIsFillable(prop) || Ctor.fieldIsReadOnly(prop)) {
          return false
        }
        
        // validate value
        const validator = Ctor.resolveValidator(prop)
        if (validator) {
          validator(target, prop as string, value)
        }
        
        const resolvedSetter = Ctor.resolveSetter(prop)
        return resolvedSetter?.(target, prop as string, value, receiver) ?? Reflect.set(target, prop, value, receiver)
      },
      apply (target, thisArg, argumentsList) {
        return Reflect.apply(target as unknown as Function, thisArg, argumentsList)
      },
      deleteProperty (target, prop: string | symbol) {
        if ((<typeof ActiveModel> target.constructor).fieldIsProtected(prop)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }
        
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
  
  startTracking () {
    const { saveInitialState } = useMeta(this)
    saveInitialState(this)
  }
  
  constructor (data: ActiveModelSource = {}) {
    const Ctor = (<typeof ActiveModel> this.constructor)
    data = Ctor.sanitize(data || {})
    const model = Ctor.wrap(this)
    return Ctor.fill(model, Ctor.setDefaultAttributes(data, Ctor.resolveAttributes()))
  }
}
