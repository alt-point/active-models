export default class Enum {
  __map = new Map()
  __default = undefined

  /**
   * @param entries
   * @param defaultValue
   */
  constructor (entries = [], defaultValue) {
    for (const key of entries) {
      this.__map.set(key, key)
    }
    this.__default = defaultValue
  }

  get default () {
    return this.__default
  }

  values () {
    return new Array(...this.__map.values())
  }

  get (key) {
    return this.__map.get(key)
  }

  set (key, value) {
    return this.__map.set(key, value)
  }

  has (key) {
    return this.__map.has(key)
  }

  /**
   * Валидация установленного значения
   * @param value
   * @return {boolean}
   */
  validate (value) {
    if (!this.has(value)) {
      throw new Error(`Value must be include one of type: ${this.values().join(', ')}; Provide value "${value}"`)
    }
    return true
  }
}
