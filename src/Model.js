import merge from 'merge'

/**
 * String to camel case
 * @param {string} s
 * @returns {string}
 */
const stringToCamelCase = (s) => {
  const result = s.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  return result.charAt(0).toLowerCase() + result.slice(1)
}

/**
 * String to pascal case
 * @param {string} s
 * @returns {string}
 */
const stringToPascalCase = s => String(s).split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')

/**
 * sanitize data
 * @param data
 * @returns {any}
 */
const sanitize = (data) => {
  return merge.recursive(true, {}, data)
}

/**
 * Применяем данные переданные в конструктор к модели
 * @param data
 * @param model
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
  Object.defineProperties(model, getters.map(p => ({ [p]: { enumerable: true } })))
  return model
}

/**
 * Поднимаем все свойства и методы из цепочки прототипов
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

const requiredCheck = (model, prop, value, required = []) => {
  if (required.includes(prop)) {
    if (!Object.prototype.hasOwnProperty.call(model, prop) || value === undefined) {
      throw new Error(`Property ${prop} is required!`)
    }
  }
}

const fillableCheck = (prop, fillable = []) => {
  // Если свойство не содержится в массиве доступных для присвоения свойств,
  // то устанавливать его значение запрещено
  if (fillable.length) {
    return fillable.includes(prop)
  }
  return true
}

/**
 * Proxy getter
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
  // check required value
  requiredCheck(model, prop, value, model.constructor.required)
  // validate value
  const pascalProp = stringToPascalCase(prop)
  const validator = typeof prop === 'string' && `validate${pascalProp}`

  if (typeof model.constructor[validator] === 'function') {
    model.constructor[validator](model, prop, value)
  }

  const setter = typeof prop === 'string' && `setter${pascalProp}`

  if (typeof model.constructor[setter] === 'function') {
    model.constructor[setter](model, prop, value, receiver)
  } else {
    Reflect.set(model, prop, value, receiver)
  }
}

/**
 * Getter
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */
const getter = (target, prop, receiver) => {
  // Если свойство скрыто, то вместо его значения возвращаем `undefined`
  if (target.constructor.hidden.includes(prop) && typeof target[prop] !== 'function') {
    return
  }
  const pascalProp = stringToPascalCase(prop)
  const getter = typeof prop === 'string' && `getter${pascalProp}`

  if (typeof target[prop] === 'function') {
    return Reflect.get(target, prop, receiver)
  }

  if (typeof target.constructor[getter] === 'function') {
    return target.constructor[getter](target, prop, receiver)
  } else {
    return Reflect.get(target, prop, receiver)
  }
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
   * Список полей, доступных для явного изменения
   * @return {*[]}
   */
  static get fillable () {
    return []
  }

  /**
   * Список обязательных полей
   * @return {*[]}
   */
  static get required () {
    return []
  }

  /**
   * Список полей, недоступных для чтения, например `password`
   * @returns {Array}
   */
  static get hidden () {
    return []
  }

  toString () {
    return JSON.stringify(this)
  }

  makeFreeze () {
    return Object.freeze(this)
  }

  /**
   * Модель
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
      }
    }

    data = setDefaultAttributes(sanitize(data || {}), this.constructor.$attributes, getters)
    const model = new Proxy(this, handler)
    fill(model, data)
    return model
  }
}
