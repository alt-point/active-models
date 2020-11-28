export default class Enum {
  #map = new Map()
  #default = undefined

  /**
   * @param entries
   * @param defaultValue
   */
  constructor (entries = [], defaultValue) {
    for (const key of entries) {
      this.#map.set(key, key)
    }
    this.#default = defaultValue
  }

  /**
   * Get default value
   * @return {any}
   */
  get default () {
    return this.#default
  }

  /**
   * Get enum values
   * @return {any[]}
   */
  values () {
    return Array.from(this.#map.values())
  }

  /**
   * Get value by key
   * @param key
   * @return {any}
   */
  get (key) {
    return this.#map.get(key)
  }

  /**
   * Check exist value in enum
   * @param key
   * @return {boolean}
   */
  has (key) {
    return this.#map.has(key)
  }

  /**
   *
   * @return {any[]}
   */
  keys () {
    return Array.from(this.#map.keys())
  }

  /**
   *
   * @return {[any, any][]}
   */
  entries () {
    return Array.from(this.#map.entries())
  }

  /**
   * Validate values
   * @param {array|string} value
   * @return {boolean}
   */
  validate (value) {
    value  = Array.isArray(value) ? value : [value]

    for (const v of value) {
      if (!this.has(v)) {
        throw new Error(`Value must be include one of type: ${this.values().join(', ')}; Provide value "${v}"`)
      }
    }

    return true
  }
}
