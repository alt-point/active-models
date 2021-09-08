import cloneDeep from 'lodash.clonedeep'
import deepEqual from 'fast-deep-equal'
import type  { ActiveModelSource, AnyClassInstance, Getter, Setter } from './types'

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
    .filter(prop => typeof (<AnyClassInstance><unknown>constructor)[prop as string] === 'function') as string[]


  properties.push(...op)
  return getStaticMethodsNamesDeep(Reflect.getPrototypeOf(constructor), properties)
}


const hasStaticMethod = (Ctor:  { new <T>(...args: any[]): T, [key: string]: (...args: any[]) => any }, method: string): boolean => {
  return Ctor[method] && typeof Ctor[method] === 'function'
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

  if (!fillableCheck(prop, (<typeof ActiveModel> target.constructor).fillable)) {
    return false
  }

  // validate value
  const pascalProp: string = stringToPascalCase(prop)
  const validator: string = `validate${pascalProp}`

  if (hasStaticMethod(target.constructor, validator)) {
    getStaticMethod(target.constructor, validator)(target, prop, value)
  }

  const registered = target.constructor.resolveSetter(prop)
  if (registered) {
    return registered(target, prop, value, receiver)
  }

  // if setter static method for prop find in current class, then proxied to setter
  const setter: string = `setter${pascalProp}`
  if ((<AnyClassInstance><unknown>target.constructor)[setter] === 'function') {
    return (<AnyClassInstance><unknown>target.constructor)[setter](target, prop, value, receiver)
  }

  return Reflect.set(target, prop, value, receiver)
}

/**
 * Getter handler
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */
const getter = (target: ActiveModel | AnyClassInstance, prop: string, receiver?: any): any => {
  const getter: string = `getter${stringToPascalCase(prop)}`

  const registered = target.constructor.resolveGetter(prop)
  if (registered) {
    return registered(target, prop, receiver)
  }

  if (hasStaticMethod(target.constructor, getter)) {
    return getStaticMethod(target.constructor, getter)(target, prop, receiver)
  }

  return Reflect.get(target, prop, receiver)
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
      .filter(property => !hidden.includes(property as string))
  }
}

class ActiveModel {
  protected static __getters__ = new Map<string | symbol, Getter<any>>()
  protected static __setters__ = new Map<string | symbol, Setter<any>>()

  protected static defineGetter <T>(prop: string, handler: Getter<T>) {
    this.__getters__.set(prop, handler)
  }

  protected static resolveGetter <T>(prop: string | symbol): Getter<T> | undefined {
    return this.__getters__.get(prop)
  }

  protected static defineSetter <T>(prop: string, handler: Setter<T>) {
    this.__setters__.set(prop, handler)
  }

  protected static resolveSetter <T>(prop: string | symbol): Setter<T> | undefined {
    return this.__setters__.get(prop)
  }

  static get $attributes (): object {
    return {}
  }

  toJSON () {
    return Object.keys(this)
      .reduce((a: object, b: string) => {
        // @ts-ignore
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
  makeFreeze () {
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
    const getters: string[] = this.getGetters()
    implementGetters(model, getters)
    const source = this.sanitize(data || {})
    return _fill<T>(model, source)
  }

  fill (data: ActiveModelSource): this {
    const getters: string[] = (<typeof ActiveModel> this.constructor).getGetters()
    implementGetters(this, getters)
    _fill<this>(this, (<typeof ActiveModel> this.constructor).sanitize(data || {}))
    return this
  }

  clone (): this {
    return cloneDeep(this)
  }

  static getGetters (): string[] {
    return getStaticMethodsNamesDeep(this)
      .filter(fn => fn.startsWith('getter'))
      .map(fn => stringToCamelCase(fn.substring(6)))
  }

  constructor(data: ActiveModelSource = {}) {
    data = (<typeof ActiveModel> this.constructor).sanitize(data || {})
    const model = new Proxy<this>(this, handler)
    const getters: string[] = (<typeof ActiveModel> this.constructor).getGetters()
    implementGetters(model, getters)
    return _fill<this>(model, setDefaultAttributes(data, (<typeof ActiveModel> this.constructor).$attributes))
  }
}

/**
 * Active record model
 * @param {object} data
  */
export default ActiveModel
