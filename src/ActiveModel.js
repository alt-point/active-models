import merge from 'merge'

const splitTokens = new RegExp('[-_.+*/:? ]', 'g')

/**
 * String to camel case
 * @param {string} s
 * @returns {string}
 */
const stringToCamelCase = (s) => {
  const result = s.split(splitTokens).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  return result.charAt(0).toLowerCase() + result.slice(1)
}

/**
 * String to pascal case
 * @param {string} s
 * @returns {string}
 */
const stringToPascalCase = s => String(s).split(splitTokens).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')

/**
 * Sanitize data
 * @param data
 * @returns {any}
 */
const sanitize = (data) => {
  return merge.recursive(true, {}, data)
}

/**
 * Fill data to model
 * @param {Object} data
 * @param {Object} model
 */
const fill = (model, data) => {
  for (const prop in data) {
    if (Object.prototype.hasOwnProperty.call(data, prop)) {
      model[prop] = data[prop]
    }
  }
}

/**
 * Set default attributes
 * @param {Object} model
 * @param {Object} $defaultAttributes
 * @param {Array} getters
 * @returns {*}
 */
const setDefaultAttributes = (model, $defaultAttributes, getters = []) => {
  for (const prop in $defaultAttributes) {
    if (!Object.prototype.hasOwnProperty.call(model, prop) && Object.prototype.hasOwnProperty.call($defaultAttributes, prop)) {
      model[prop] = model[prop] || $defaultAttributes[prop]
    }
  }

  for (const g of getters) {
    if (!Object.prototype.hasOwnProperty.call(model, g)) {
      Object.defineProperty(model, g, { enumerable: true })
    }
  }

  return model
}

/**
 * Lifting all properties and methods from the prototype chain
 * @param {Class} constructor
 * @param {array} properties
 * @returns {*[]}
 */
const getStaticMethodsNamesDeep = (constructor, properties = []) => {
  if (!constructor) {
    return [...new Set(properties)]
  }
  const op = Reflect.ownKeys(constructor)
    .filter(prop => typeof prop === 'string')
    .filter(prop => !['arguments', 'callee', 'caller'].includes(prop))
    .filter(prop => typeof constructor[prop] === 'function')
  properties.push(...op)
  return getStaticMethodsNamesDeep(Object.getPrototypeOf(constructor), properties)
}

/**
 * Check property is fillable
 * @param {string} prop
 * @param {array} fillable
 * @return {boolean}
 */
const fillableCheck = (prop, fillable = []) => {
  // If the property is not contained in the array of properties available for assignment,
  // it is forbidden to set its value
  if (fillable.length) {
    return fillable.includes(prop)
  }
  return true
}

/**
 * Setter handler
 * @param model
 * @param prop
 * @param value
 * @param receiver
 * @returns {boolean}
 */
const setter = (model, prop, value, receiver) => {
  if (model[prop] === value) {
    return Reflect.set(model, prop, value, receiver)
  }

  if (!fillableCheck(prop, model.constructor.fillable)) {
    return false
  }

  // validate value
  const pascalProp = stringToPascalCase(prop)
  const validator = typeof prop === 'string' && `validate${pascalProp}`

  if (typeof model.constructor[validator] === 'function') {
    model.constructor[validator](model, prop, value)
  }

  const setter = typeof prop === 'string' && model.constructor[`setter${pascalProp}`]

  if (typeof setter === 'function') {
    setter(model, prop, value, receiver)
  } else {
    Reflect.set(model, prop, value, receiver)
  }
}

/**
 * Getter handler
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */
const getter = (target, prop, receiver) => {
  const pascalProp = stringToPascalCase(prop)
  const getter = typeof prop === 'string' && target.constructor[`getter${pascalProp}`]

  if (typeof getter === 'function') {
    return target.constructor[getter](target, prop, receiver)
  }

  return Reflect.get(target, prop, receiver)
}

/**
 * Active record model
 * @param {object} data
 * @param {object} $attributes
 */
export default class ActiveModel {
  static get $attributes () {
    return {}
  }

  /**
   * An array of the properties available for assignment via constructor argument `data`
   * @return {*[]}
   */
  static get fillable () {
    return []
  }

  /**
   * List of fields that cannot be deleted
   * @return {*[]}
   */
  static get required () {
    return []
  }

  /**
   * List of fields to exclude from ownKeys, such as ' password`
   * @returns {Array}
   */
  static get hidden () {
    return []
  }

  toString () {
    return JSON.stringify(this)
  }

  /**
   * Make model readonly
   * @return {Readonly<ActiveModel>}
   */
  makeFreeze () {
    return Object.freeze(this)
  }

  /**
   * Constructor
   * @param {object} data
   * @returns {Proxy<ActiveModel>|{}}
   */
  constructor (data = {}) {
    const self = this

    const handler = {
      get (target, prop, receiver) {
        return getter(target, prop, receiver)
      },
      set (target, prop, value, receiver) {
        setter(target, prop, value, receiver)
        return true
      },
      apply (target, thisArg, argumentsList) {
        return Reflect.apply(target, thisArg, argumentsList)
      },
      getPrototypeOf () {
        return Reflect.getPrototypeOf(self)
      },
      deleteProperty (target, prop) {
        if (self.constructor.required && self.constructor.required.includes(prop)) {
          throw new TypeError(`Property "${prop}" is required!`)
        }

        return Reflect.deleteProperty(target, prop)
      },
      has (target, prop) {
        return Reflect.has(target, prop)
      }
    }

    const getters = getStaticMethodsNamesDeep(this.constructor)
      .filter(fn => fn.startsWith('getter'))
      .map(fn => stringToCamelCase(fn.substring(6)))

    if (getters.length) {
      handler.ownKeys = function (target) {
        return [...new Set(Reflect.ownKeys(target).concat(getters))]
          .filter(property => !self.constructor.hidden.includes(property))
      }
    }
    const model = new Proxy(this, handler)

    data = setDefaultAttributes(sanitize(data || {}), this.constructor.$attributes, getters)
    fill(model, data)
    return model
  }
}
