import type { EnumItemType } from './types'
export class Enum {
  readonly #map: Map<EnumItemType,EnumItemType> = new Map()
  readonly #default: EnumItemType | undefined = undefined

  /**
   * @param entries
   * @param defaultValue
   */
  constructor (entries: EnumItemType[] = [], defaultValue: EnumItemType | undefined = undefined) {
    for (const key of entries) {
      this.#map.set(key, key)
    }
    this.#default = defaultValue
  }

  /**
   * Get default value
   * @return {}
   */
  get default (): EnumItemType | undefined {
    return this.#default
  }

  /**
   * Get enum values
   * @return {any[]}
   */
  values (): Array<EnumItemType> {
    return Array.from(this.#map.values())
  }

  /**
   * Get value by key
   * @param key
   * @return {any}
   */
  get (key: EnumItemType): EnumItemType| undefined {
    return this.#map.get(key)
  }

  /**
   * Check exist value in enum
   * @param key
   * @return {boolean}
   */
  has (key: EnumItemType | undefined): boolean {
    return key=== undefined ? false : this.#map.has(key)
  }

  /**
   *
   * @return {any[]}
   */
  keys (): Array<EnumItemType> {
    return Array.from(this.#map.keys())
  }

  /**
   *
   * @return {[EnumItemType, EnumItemType][]}
   */
  entries (): [EnumItemType, EnumItemType][] {
    return Array.from(this.#map.entries())
  }

  /**
   * Validate values
   * @param value
   */
  validate (value: EnumItemType[] | EnumItemType): boolean {
    value  = Array.isArray(value) ? value : [value]

    for (const v of value) {
      if (!this.has(v)) {
        throw new Error(`Value must be include one of type: ${this.values().join(', ')}; Provide value "${v}"`)
      }
    }

    return true
  }
}
