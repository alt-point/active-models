import type { ActiveModelSource, AnyClassInstance, Getter, Setter, Validator } from './types'
import { cloneDeepWith } from 'lodash'
import deepEqual from 'fast-deep-equal/es6'

interface Constructor<T> {
  new (...args: any[]): T
}

const splitTokens = '[-_.+*/:? ]'
/**
 * String to camel case
 * @param {string} s
 * @returns {string}
 */
const stringToCamelCase = (s: string): string => {
  const result = s.split(new RegExp(splitTokens, 'g')).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  return result.charAt(0).toLowerCase() + result.slice(1)
}

/**
 * String to pascal case
 * @param {string} s
 * @returns {string}
 */
const stringToPascalCase = (s: string): string => {
  return String(s).split(new RegExp(splitTokens, 'g')).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

/**
 * Fill data to model
 * @param {Object} data
 * @param {Object} model
 */
const _fill = <T extends ActiveModel>(model: T, data: ActiveModel | AnyClassInstance): T => {
  for (const prop in data) {
    Reflect.set(model, prop, data[prop])
  }
  return model
}

/**
 * Set default attributes
 * @param {Object} model

 * @param {Array} getters
 * @returns {*}
 */
const implementGetters = (model: ActiveModel, getters: Array<string> = []): void => {
  for (const g of getters) {
    if (!Object.prototype.hasOwnProperty.call(model, g)) {
      Reflect.defineProperty(model, g, {
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
  }
}

/**
 * Set default values for attributes
 * @param data
 * @param $defaultAttributes
 */
const setDefaultAttributes = (data: AnyClassInstance, $defaultAttributes: ActiveModel | object | AnyClassInstance): AnyClassInstance | object => {
  for (const prop in $defaultAttributes) {
    if (Object.prototype.hasOwnProperty.call($defaultAttributes, prop)) {
      data[prop] = Reflect.has(data, prop) ? data[prop] : $defaultAttributes[prop]
    }
  }
  return data
}

/**
 * Lifting all properties and methods from the prototype chain
 * @param {Function} constructor
 * @param {array} properties
 * @returns {*[]}
 */
const getStaticMethodsNamesDeep = (constructor: Function | object | null | undefined, properties: string[] = []): string[] => {
  if (!constructor) {
    return Array.from(new Set(properties))
  }

  const op = Array.from(Reflect.ownKeys(constructor))
    .filter(prop => typeof prop === 'string' && !['arguments', 'callee', 'caller'].includes(prop))
    .filter(prop => typeof (<AnyClassInstance><unknown>constructor)[<string>prop] === 'function') as Array<string>

  properties.push(...op)
  return getStaticMethodsNamesDeep(Reflect.getPrototypeOf(constructor), properties)
}

const hasStaticMethod = (Ctor: any, method: string): boolean | undefined => {
  return (Reflect.has(Ctor, method) && typeof Ctor[method] === 'function') || undefined
}

/**
 * Check property is fillable
 * @param {string} prop
 * @param Ctor {typeof ActiveModel}
 * @return {boolean}
 */
const fieldIsFillable = (prop: unknown, Ctor: typeof ActiveModel): boolean => {
  return Boolean(Ctor?.__fillable__?.has(prop))
}

/**
 * Check field is protected
 * @param {string} prop
 * @param {typeof ActiveModel} Ctor
 */
const fieldIsProtected = (prop: string, Ctor: typeof ActiveModel): boolean => {
  const guarded = Ctor.protected.slice()
  if (Ctor.__protected__) {
    guarded.push(...Ctor.__protected__)
  }
  return guarded.includes(prop)
}

/**
 *
 * @param prop
 * @param Ctor
 */
const fieldIsHidden = (prop: string, Ctor: typeof ActiveModel): boolean => {
  const hidden = Ctor.hidden.slice()

  if (Ctor.__hidden__) {
    hidden.push(...Ctor.__hidden__)
  }
  return hidden.includes(prop)
}

/**
 *
 * @param prop
 * @param Ctor
 */
const fieldIsReadOnly = (prop: unknown, Ctor: typeof ActiveModel): boolean => {
  const readonly = Ctor.readonly.slice()

  if (Ctor.__readonly__) {
    readonly.push(...Ctor.__readonly__)
  }

  return readonly.includes(prop)
}

/**
 * Setter handler
 * @param target
 * @param prop
 * @param value
 * @param receiver
 * @returns {boolean}
 */
// const setter = (target: ActiveModel | AnyClassInstance, prop: string, value: any, receiver: any): void | boolean => {
//   if (deepEqual(target[prop], value)) {
//     return Reflect.set(target, prop, value, receiver)
//   }
//   const Ctor = (<typeof ActiveModel> target.constructor)
//   if (!fieldIsFillable(prop, Ctor) || fieldIsReadOnly(prop, Ctor)) {
//     return false
//   }
//
//   // validate value
//   const validator = Ctor.resolveValidator(prop)
//   if (validator) {
//     validator(target, prop, value)
//   }
//
//   const resolvedSetter = Ctor.resolveSetter(prop)
//   return resolvedSetter ? resolvedSetter(target, prop, value, receiver) : Reflect.set(target, prop, value, receiver)
// }

/**
 * Getter handler
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */
const getter = (target: ActiveModel | AnyClassInstance, prop: string, receiver?: any): any => {
  const Ctor = (<typeof ActiveModel> target.constructor)
  const resolvedGetter = Ctor?.resolveGetter?.(prop)
  return resolvedGetter ? resolvedGetter(target, prop, receiver) : Reflect.get(target, prop, receiver)
}

type StaticContainers = '__getters__' | '__setters__' | '__attributes__' | '__validators__' | '__fillable__' | '__protected__' | '__readonly__' | '__hidden__'

export class ActiveModel {
  protected static defineStaticProperty (propertyName: StaticContainers, fallback: () => any) {
    this[propertyName] = this.hasOwnProperty(propertyName) ? this[propertyName]!: fallback()
    return this
  }

  protected static __getters__?: Map<keyof InstanceType<typeof this>, Getter<InstanceType<typeof this>>>
  protected static __setters__?: Map<keyof InstanceType<typeof this>, Setter<InstanceType<typeof this>>>
  protected static __attributes__?: Map<keyof InstanceType<typeof this>, any>
  protected static __validators__?: Map<string, Validator<any>>
  protected static __fillable__?: Set<keyof InstanceType<typeof this>>
  protected static __protected__?: Set<keyof InstanceType<typeof this>>
  protected static __readonly__?: Set<keyof InstanceType<typeof this>>
  protected static __hidden__?: Set<keyof InstanceType<typeof this>>
  
  static handler<T extends typeof ActiveModel>(this: T): ProxyHandler<T> {
    return {
      get (target, prop: keyof T, receiver) {
        return getter(target, prop as string, receiver)
      },
      set (target: T, prop: keyof T, value, receiver) {
        if (deepEqual(target[prop], value)) {
          return Reflect.set(target, prop, value, receiver)
        }
        const Ctor = (<typeof ActiveModel> target.constructor)
        if (!fieldIsFillable(prop, Ctor) || fieldIsReadOnly(prop, Ctor)) {
          return false
        }
        
        // validate value
        const validator = Ctor.resolveValidator(prop)
        if (validator) {
          validator(target, prop, value)
        }
        
        const resolvedSetter = Ctor.resolveSetter(prop)
        return resolvedSetter ? resolvedSetter(target, prop, value, receiver) : Reflect.set(target, prop, value, receiver)
      },
      apply (target: T, thisArg, argumentsList) {
        return Reflect.apply(target as unknown as Function, thisArg, argumentsList)
      },
      deleteProperty (target: T, prop: string | symbol) {
        if (fieldIsProtected(prop as string, <typeof ActiveModel> target.constructor)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }
        
        return Reflect.deleteProperty(target, prop)
      },
      has (target: T, prop: keyof InstanceType<typeof this>) {
        return Reflect.has(target, prop)
      },
      ownKeys (target: T) {
        const Ctor = <typeof ActiveModel> target.constructor
        const getters = Ctor.getGetters()
        return Array.from(new Set(Reflect.ownKeys(target).concat(getters)))
          .filter(property => !fieldIsHidden(<string>property, Ctor))
      }
    }
  }

  /**
   * Add field name to hidden scope
   * @param prop
   */
  static addToHidden (...prop: Array<keyof InstanceType<typeof this>>): void {
    this.defineStaticProperty('__hidden__', () => new Set(this.__hidden__ || []))
    prop.forEach(p => this.__hidden__!.add(p))
  }

  /**
   *  Add field name to readonly scope
   * @param prop
   */
  static addToReadonly (prop: keyof InstanceType<typeof this>): void {
    this.defineStaticProperty('__readonly__', () => new Set(this.__readonly__ || []))
    this.__readonly__!.add(prop)
  }

  /**
   * Add field name to protected scope
   * @param prop
   */
  static addToProtected (prop: keyof InstanceType<typeof this>): void {
    this.defineStaticProperty('__protected__', () => new Set(this.__protected__ || []))
    this.__protected__!.add(prop)
  }

  /**
   * Add field name to fillabe scope
   * @param prop
   */
  static addToFillable (prop: keyof InstanceType<typeof this>): void {
    this.defineStaticProperty('__fillable__', () => new Set(this.__fillable__ || []))
    this.__fillable__!.add(prop)
  }


  /**
   * define getter
   * @param prop
   * @param handler
   */
  static defineGetter (prop: string, handler: Getter<any>): void {
    this.defineStaticProperty('__getters__', () => new Map(this.__getters__ || []))
    this.__getters__!.set(prop, handler)
  }

  /**
   * resolve getter
   * @param prop
   */
  static resolveGetter (prop: string): Getter<any> | undefined {
    const staticName = `getter${stringToPascalCase(prop)}`
    const staticFallback = hasStaticMethod(this, staticName) ? Reflect.get(this, staticName) as Getter<any> : undefined
    const getter = this.__getters__ ? this.__getters__.get(prop) : staticFallback
    return getter ? getter.bind(this) : undefined
  }

  /**
   * define setter for field by name
   * @param prop
   * @param handler
   */
  static defineSetter (prop: keyof InstanceType<typeof this>, handler: Setter<any>): void {
    this.defineStaticProperty('__setters__', () => new Map(this.__setters__ || []))
    this.__setters__!.set(prop, handler)
  }

  /**
   * resolve setter for field by name
   * @param prop
   */
  protected static resolveSetter (prop: keyof InstanceType<typeof this>): Setter<any> | undefined {
    const staticName = `setter${stringToPascalCase(prop)}`
    const staticFallback = hasStaticMethod(this, staticName) ? Reflect.get(this, staticName) as Setter<any> : undefined
    const setter = this.__setters__ ? this.__setters__.get(prop) : staticFallback
    return setter ? setter.bind(this) : undefined
  }

  /**
   *  Define validator for field by name
   * @param prop
   * @param handler
   */
  static defineValidator (prop: string, handler: Validator<any>): void {
    this.defineStaticProperty('__validators__', () => new Map(this.__validators__ || []))
    this.__validators__!.set(prop, handler)
  }

  /**
   * Resolve validator for field by name
   * @param prop
   */
  static resolveValidator<T = string>(prop: T): Validator<any> | undefined {
    const pascalProp: string = stringToPascalCase(prop)
    const staticName: string = `validate${pascalProp}`
    const staticFallback = hasStaticMethod(this, staticName) ? Reflect.get(this, staticName) as Validator<any> : undefined
    const validator = this.__validators__ ? this.__validators__.get(prop) : staticFallback
    return validator ? validator.bind(this) : undefined
  }

  /**
   * Define attribute (default value) for field by name
   * @param prop
   * @param value
   */
  static defineAttribute (prop: string, value: any): void {
    this.defineStaticProperty('__attributes__', () => new Map(this.__attributes__ || []))
    this.__attributes__!.set(prop, value)
  }

  /**
   * Resolve all defined attributes for fields
   * @private
   */
  private static resolveAttributes (): object {
    const attributes = this.__attributes__ ? Object.fromEntries(this.__attributes__.entries()) : {}
    for (const [key, value] of Object.entries(attributes)) {
      attributes[key] = typeof value === 'function' ? value() : value
    }
    return attributes
  }

  /**
   * Static method for converting to JSON
   */
  static toJSON (instance: ActiveModel | object | Array<ActiveModel | object>): object | Array<object> {
    if (typeof instance !== 'object' || instance === null) {
      return instance
    }
    return Array.isArray(instance) ? instance.map(i => this.toJSON(i)) : Object.keys(instance).reduce((a: { [key: string] : any }, b: string) => {
      a[b] = getter(instance, b)
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
  static sanitize (data: object | ActiveModel): object {
    return cloneDeepWith(data, this.cloneCustomizer.bind(this))
  }

  /**
   * Factory method for create new instance
   * @param data
   */
  static create<T extends typeof ActiveModel> (this: T, data: T | ActiveModelSource): InstanceType<T> {
    const model = new this()
    const getters = this.getGetters()
    implementGetters(model, getters)
    const source = this.sanitize(data || {})
    return _fill(model, setDefaultAttributes(source, this.resolveAttributes())) as InstanceType<T>
  }

  /**
   * Batch factory for creating instance collection
   * @param data
   */
  static createFromCollection<T extends typeof ActiveModel>(this: T, data: Array<T | ActiveModelSource>) {
    const getters = this.getGetters()
    const attributes = this.resolveAttributes()
    const create = (data: T | ActiveModelSource): InstanceType<T> => {
      const model = new this()
      implementGetters(model, getters)
      const source = this.sanitize(data || {})
      return _fill(model, setDefaultAttributes(source, attributes)) as InstanceType<T>
    }
    return data.map(item => create(item))
  }

  static async asyncCreateFromCollection<T extends typeof ActiveModel>(this: T, data: Promise<Array<T | ActiveModelSource>>) {
    return this.createFromCollection<T>(await data)
  }

  /**
   * Batch async factory for creating instance collection
   * @param data
   */
  fill (data: ActiveModelSource): this {
    const Ctor = (<typeof ActiveModel> this.constructor)
    const getters = Ctor.getGetters()
    implementGetters(this, getters)
    _fill<this>(this, Ctor.sanitize(data || {}))
    return this
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
  static getGetters (): Array<string> {
    const calculatesGetters = getStaticMethodsNamesDeep(this)
      .filter(fn => fn.startsWith('getter'))
      .map(fn => stringToCamelCase(fn.substring(6)))
    calculatesGetters.push(...this.__getters__ ? this.__getters__.keys() : [])
    return calculatesGetters
  }

  /**
   * Wrap an instance in a proxy for traps to work
   * @param { ActiveModel } instance Instance for wrapping
   */
  protected static wrap <InstanceType extends ActiveModel>(instance: InstanceType): InstanceType {
    return new Proxy(instance, this.handler) as InstanceType
  }

  constructor (data: ActiveModelSource = {}) {
    const Ctor = (<typeof ActiveModel> this.constructor)
    data = Ctor.sanitize(data || {})
    const model = Ctor.wrap(this)
    const getters = Ctor.getGetters()
    implementGetters(model, getters)
    return _fill<this>(model, setDefaultAttributes(data, Ctor.resolveAttributes()))
  }
}
