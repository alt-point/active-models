import cloneDeep from 'lodash.clonedeep'
import deepEqual from 'fast-deep-equal'
import type  { ActiveModelSource, AnyClassInstance } from './types'

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
const fill = (model: ActiveModel | AnyClassInstance, data: ActiveModel | object | AnyClassInstance): void => {
  Reflect.ownKeys(data).forEach((prop) => {
    model[prop] = data[prop]
  })
}

/**
 * Set default attributes
 * @param {Object} model

 * @param {Array} getters
 * @returns {*}
 */
const implementGetters  = (model: ActiveModel, getters: Array<string> = []): ActiveModel => {
  for (const g of getters) {
    if (!Object.prototype.hasOwnProperty.call(model, g)) {
      Object.defineProperty(model, g, {
        enumerable: true,
        configurable: true
      })
    }
  }
  return model
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

  if (typeof (target.constructor)[validator] === 'function') {
    (<AnyClassInstance><unknown>target.constructor)[validator](target, prop, value)
  }

  const setter: string = `setter${pascalProp}`

  if ((<AnyClassInstance><unknown>target.constructor)[setter] === 'function') {
    return (<AnyClassInstance><unknown>target.constructor)[setter](target, prop, value, receiver)
  }

  Reflect.set(target, prop, value, receiver)
}

/**
 * Getter handler
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */
const getter = (target: ActiveModel, prop: string, receiver: any): any => {
  // if (prop === 'toJSON') {
  //   return target
  // }

  const getter: string = `getter${stringToPascalCase(prop)}`

  if (typeof (<AnyClassInstance><unknown>target.constructor)[getter] === 'function') {
    return (<AnyClassInstance><unknown>target.constructor)[getter](target, prop, receiver)
  }

  return Reflect.get(target, prop, receiver)
}

/**
 * Active record model
 * @param {object} data
  */
export default class ActiveModel {

  toJSON () {
    return Object.getOwnPropertyNames(this)
      .reduce((a: object, b: string) => {
        // @ts-ignore
        a[b] = this[b]
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
    return cloneDeep(data) // data
  }

  constructor(data: ActiveModelSource = {}) {
    data = data || {}
    const self = this

    const getters: string[] = getStaticMethodsNamesDeep(this.constructor)
      .filter(fn => fn.startsWith('getter'))
      .map(fn => stringToCamelCase(fn.substring(6)))

    const model = new Proxy(this, {
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
      getPrototypeOf () {
        return Reflect.getPrototypeOf(self)
      },
      deleteProperty (target, prop) {
        if ((<typeof ActiveModel> self.constructor).protected && (<typeof ActiveModel> self.constructor).protected.includes(prop as string)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }

        return Reflect.deleteProperty(target, prop)
      },
      has (target, prop) {
        return Reflect.has(target, prop)
      },
      ownKeys (target: ActiveModel) {
        return Array.from(new Set(Reflect.ownKeys(target).concat(getters)))
          .filter(property => !(<typeof ActiveModel> self.constructor).hidden.includes(property as string))
      }
    })

    fill(implementGetters(this, getters), (<typeof ActiveModel> self.constructor).sanitize(data || {}))
    return model
  }
}
