import cloneDeep from 'lodash.clonedeep'
import deepEqual from 'fast-deep-equal'
import type  { ActiveModelSource, AnyClassInstance, Getter, Setter, Validator } from './types'

const splitTokens = new RegExp('[-_.+*/:? ]', 'g')
/**
 * String to camel case
 * @param {string} s
 * @returns {string}
 */
const stringToCamelCase = (s: string): string => {
  const result = s.split(splitTokens).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  return result.charAt(0).toLowerCase() + result.slice(1)
}

/**
 * String to pascal case
 * @param {string} s
 * @returns {string}
 */
const stringToPascalCase = (s: string): string => {
  return String(s).split(splitTokens).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

const prefix = (strings: TemplateStringsArray): string => {
  return `${strings[0]}${stringToPascalCase(strings.slice(1, strings.length ).join(''))}`
}

/**
 * Fill data to model
 * @param {Object} data
 * @param {Object} model
 */
const _fill = <T>(model: ActiveModel | AnyClassInstance, data: ActiveModel | AnyClassInstance): T => {
  for (const prop in data) {
    Reflect.set(model, prop, data[prop])
    // model[prop] = data[prop]
  }
  return model
}

/**
 * Set default attributes
 * @param {Object} model

 * @param {Array} getters
 * @returns {*}
 */
const implementGetters  = (model: ActiveModel, getters: Array<string> = []): void => {
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
      data[prop] = data[prop] || $defaultAttributes[prop]
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

const getStaticMethod = (Ctor:  { new <T>(...args: any[]): T, [key: string]: (...args: any[]) => any }, method: string): Function => {
  return Ctor[method]
}


/**
 * Check property is fillable
 * @param {string} prop
 * @param {array} fillable
 * @return {boolean}
 */
const fillableCheck = (prop: string, fillable: string[] = []): boolean => {
  // If the property is not contained in the array of properties available for assignment,
  // it is forbidden to set its value
  if (fillable.length) {
    return fillable.includes(prop)
  }
  return true
}

const readOnlyCheck  = (prop: string, readonly: string[] = []): boolean => {
  if (readonly.length) {
    return readonly.includes(prop)
  }
  return false
}


/**
 * Setter handler
 * @param target
 * @param prop
 * @param value
 * @param receiver
 * @returns {boolean}
 */
const setter = (target: ActiveModel | AnyClassInstance, prop: string, value: any, receiver: any): void | boolean => {
  if (deepEqual(target[prop], value)) {
    return Reflect.set(target, prop, value, receiver)
  }
  const Ctor = (<typeof ActiveModel> target.constructor)
  if (!fillableCheck(prop, Ctor.fillable)) {
    return false
  }

  if (readOnlyCheck(prop, Ctor.readonly)) {
    return false
  }

  // validate value
  const validator = Ctor.resolveValidator(prop)
  if (validator) {
    validator(target, prop, value)
  }

  const resolvedSetter = Ctor.resolveSetter(prop)
  return resolvedSetter ? resolvedSetter(target, prop, value, receiver) : Reflect.set(target, prop, value, receiver)
}

/**
 * Getter handler
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */
const getter = (target: ActiveModel | AnyClassInstance, prop: string, receiver?: any): any => {
  const Ctor = (<typeof ActiveModel> target.constructor)
  const resolvedGetter = Ctor.resolveGetter(prop)
  return resolvedGetter ? resolvedGetter(target, prop, receiver) : Reflect.get(target, prop, receiver)
}

const handler = <ProxyHandler<ActiveModel>>{
  get (target, prop, receiver) {
    return getter(target, prop as string, receiver)
  },
  set (target, prop: string, value, receiver) {
    setter(target, prop, value, receiver)
    return true
  },
  apply (target: ActiveModel, thisArg, argumentsList) {
    return Reflect.apply(target as unknown as Function, thisArg, argumentsList)
  },
  deleteProperty (target, prop) {
    if ((<typeof ActiveModel> target.constructor).protected && (<typeof ActiveModel> target.constructor).protected.includes(prop as string)) {
      throw new TypeError(`Property "${prop as string}" is protected!`)
    }

    return Reflect.deleteProperty(target, prop)
  },
  has (target, prop) {
    return Reflect.has(target, prop)
  },
  ownKeys (target: ActiveModel) {
    const getters = (<typeof ActiveModel> target.constructor).getGetters()
    const hidden = (<typeof ActiveModel> target.constructor).hidden
    return Array.from(new Set(Reflect.ownKeys(target).concat(getters)))
      .filter(property => !hidden.includes(<string>property))
  }
}

export class ActiveModel {
  static readonly __activeModeActivate: boolean = false
  protected static __getters__?: Map<string, Getter<any>> = new Map<string, Getter<any>>()
  protected static __setters__?: Map<string, Setter<any>> = new Map<string, Setter<any>>()
  protected static __attributes__?: Map<string, any> = new Map<string, any>()
  protected static __validators__?: Map<string, Validator<any>> = new Map<string, Validator<any>>()
  protected static __fillable__?: Set<string> = new Set<string>()
  protected static __protected__?: Set<string> = new Set<string>()
  protected static __readonly__?: Set<string> = new Set<string>()
  protected static __hidden__?: Set<string> = new Set<string>()

  static throwIfNotDecorated () {
    if (!this.__activeModeActivate) {
      throw new TypeError('Current class must be decorate with @ActiveClass decorator.')
    }
    return this
  }

  static addToHidden (...prop: string[]): void {
    prop.forEach(p => this.__hidden__ && this.__hidden__.add(p))
  }

  static addToReadonly (prop: string): void {
    this.__readonly__ && this.__readonly__.add(prop)
  }

  static addToProtected (prop: string): void {
    this.__protected__ && this.__protected__.add(prop)
  }

  static addToFillable (prop: string): void {
    this.__protected__ && this.__protected__.add(prop)
  }

  static defineGetter <T>(prop: string, handler: Getter<T>): void {
    this.__getters__ && this.__getters__.set(prop, handler)
  }

  static resolveGetter <T>(prop: string): Getter<T> | undefined {
    const staticName = `getter${stringToPascalCase(prop)}`
    const staticFallback = hasStaticMethod(this, staticName) ? Reflect.get(this, staticName) as Getter<T> : undefined
    const getter = this.__getters__ && this.__getters__.get(prop) || staticFallback
    return getter ? getter.bind(this) : undefined
  }

  static defineSetter <T>(prop: string, handler: Setter<T>): void {
    this.__setters__ && this.__setters__.set(prop, handler)
  }

  static resolveSetter <T>(prop: string): Setter<T> | undefined {
    const staticName = `setter${stringToPascalCase(prop)}`
    const staticFallback = hasStaticMethod(this, staticName) ? Reflect.get(this, staticName) as Setter<T> : undefined
    const setter = this.__setters__ && this.__setters__.get(prop) || staticFallback
    return setter ? setter.bind(this) : undefined
  }

  static defineValidator <T = unknown>(prop: string, handler: Validator<T>): void {
    this.__validators__ && this.__validators__.set(prop, handler)
  }

  static resolveValidator <T>(prop: string): Validator<T> | undefined {
    const pascalProp: string = stringToPascalCase(prop)
    const staticName: string = `validate${pascalProp}`
    const staticFallback = hasStaticMethod(this, staticName) ? Reflect.get(this, staticName) as Validator<T> : undefined
    const validator = this.__validators__ && this.__validators__.get(prop) || staticFallback
    return validator ? validator.bind(this) : undefined
  }

  /**
   *
   * @param prop
   * @param value
   */
  static defineAttribute (prop: string, value: any): void {
    this.__attributes__ && this.__attributes__.set(prop, typeof value === 'function' ? value() : value)
  }

  private static resolveAttributes (): object {
    const attributes = this.__attributes__ ? Object.fromEntries( this.__attributes__.entries() ) : {}
    return Object.assign(this.$attributes, attributes)
  }

  /**
   *
   */
  static get $attributes (): object {
    return {}
  }

  toJSON (): object {
    return Object.keys(this)
      .reduce((a: { [key: string] : any }, b: string) => {
        a[b] = getter(this,b)
        return a
      }, {})
  }

  /**
   * An array of the properties available for assignment via constructor argument `data`
   * @return {string[]}
   */
  static get fillable (): string[] {
    return []
  }

  /**
   *
   */
  static get readonly (): string[] {
    return []
  }

  /**
   * List of fields that cannot be deleted
   * @return {string[]}
   */
  static get protected (): string[] {
    return []
  }

  /**
   * List of fields to exclude from ownKeys, such as ' password`
   * @returns {string[]}
   */
  static get hidden (): string[] {
    return []
  }

  /**
   * Make model readonly
   * @return {Readonly<ActiveModel>}
   */
  makeFreeze (): Readonly<ActiveModel> {
    return Object.freeze(this)
  }

  /**
   * Sanitize input data
   * @param data
   * @return {*}
   */
  static sanitize (data: object | ActiveModel): object {
    return cloneDeep(data)
  }

  /**
   * Factory method for create new instance
   * @param data
   */
  static create<T extends ActiveModel>(data: T | ActiveModelSource): T {
    const model = new this()
    const getters = this.getGetters()
    implementGetters(model, getters)
    const source = this.sanitize(data || {})
    return _fill<T>(model, setDefaultAttributes(source, this.resolveAttributes()))
  }

  fill (data: ActiveModelSource): this {
    const Ctor = (<typeof ActiveModel> this.constructor)
    const getters = Ctor.getGetters()
    implementGetters(this, getters)
    _fill<this>(this, Ctor.sanitize(data || {}))
    return this
  }

  clone (): this {
    return cloneDeep(this)
  }

  static getGetters (): Array<string> {
    const calculatesGetters = getStaticMethodsNamesDeep(this)
      .filter(fn => fn.startsWith('getter'))
      .map(fn => stringToCamelCase(fn.substring(6)))
    calculatesGetters.push(...this.__getters__ ? this.__getters__.keys(): [])
    return calculatesGetters
  }

  constructor(data: ActiveModelSource = {}) {
    const Ctor = (<typeof ActiveModel> this.constructor)
    data = Ctor.sanitize(data || {})
    const model = new Proxy<this>(this, handler)
    const getters = Ctor.getGetters()
    implementGetters(model, getters)
    return _fill<this>(model, setDefaultAttributes(data, Ctor.resolveAttributes()))
  }
}
