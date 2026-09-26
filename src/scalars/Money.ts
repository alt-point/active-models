import { Decimal, type DecimalInput, type RoundingMode } from './Decimal'
import { markImmutable } from './immutable'

/** Minor-unit digits of currencies that do not use two */
const MINOR_UNITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
}
const CURRENCY = /^[A-Z]{3}$/
const TEXT = /^(-?\d+(?:\.\d+)?)\s+([A-Za-z]{3})$/

/** Digits after the point that `currency` uses (2 unless listed otherwise) */
export const minorUnits = (currency: string): number => MINOR_UNITS[currency] ?? 2

/**
 * An immutable amount of money in one currency. The amount always fits the currency's minor units
 * (`12.50 USD`, `500 JPY`); arithmetic never mixes currencies and results that need more digits are
 * rounded explicitly. `allocate()` splits an amount without losing or inventing a cent.
 *
 * Use it as a field with `@ActiveField({ coerce: Money })`.
 * @example
 * Money.of('19.99', 'USD').multiply(3).toString()   // '59.97 USD'
 * Money.of('100', 'USD').allocate([1, 1, 1]).map(String)   // ['33.34 USD', '33.33 USD', '33.33 USD']
 */
export class Money {
  readonly amount: Decimal
  readonly currency: string

  private constructor (amount: Decimal, currency: string) {
    this.amount = amount
    this.currency = currency
    Object.freeze(this)
  }

  /** Throws if `amount` has more digits than the currency has minor units - round it first */
  static of (amount: DecimalInput, currency: string): Money {
    if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
      throw new TypeError(`Currency must be a 3-letter uppercase ISO 4217 code, got ${JSON.stringify(currency)}`)
    }
    const value = Decimal.from(amount)
    if (value.scale > minorUnits(currency)) {
      throw new RangeError(`${currency} has ${minorUnits(currency)} minor unit digits, got ${value.toString()}`)
    }
    return new Money(value, currency)
  }

  /** From a Money, `'12.50 USD'` or `{ amount, currency }` */
  static from (value: unknown): Money {
    if (value instanceof Money) {
      return value
    }
    if (typeof value === 'string') {
      const match = TEXT.exec(value.trim())
      if (!match) {
        throw new TypeError(`Not a money value: ${JSON.stringify(value)}`)
      }
      return Money.of(match[1], match[2].toUpperCase())
    }
    if (typeof value === 'object' && value !== null && 'amount' in value && 'currency' in value) {
      const { amount, currency } = value as { amount: DecimalInput, currency: string }
      return Money.of(amount, currency)
    }
    throw new TypeError(`Cannot make Money from ${typeof value}`)
  }

  static zero (currency: string): Money {
    return Money.of(0, currency)
  }

  get sign (): -1 | 0 | 1 {
    return this.amount.sign
  }

  isZero (): boolean {
    return this.amount.isZero()
  }

  negate (): Money {
    return new Money(this.amount.negate(), this.currency)
  }

  abs (): Money {
    return new Money(this.amount.abs(), this.currency)
  }

  add (other: unknown): Money {
    const that = this.same(other)
    return new Money(this.amount.add(that.amount), this.currency)
  }

  subtract (other: unknown): Money {
    const that = this.same(other)
    return new Money(this.amount.subtract(that.amount), this.currency)
  }

  /** Scale by a factor (a tax rate, a quantity), rounding to the currency's minor units */
  multiply (factor: DecimalInput, mode: RoundingMode = 'half-even'): Money {
    return new Money(this.amount.multiply(factor).round(minorUnits(this.currency), mode), this.currency)
  }

  /** Divide by a number, rounding to the currency's minor units */
  divide (divisor: DecimalInput, mode: RoundingMode = 'half-even'): Money {
    return new Money(this.amount.divide(divisor, minorUnits(this.currency), mode), this.currency)
  }

  /**
   * Split into parts proportional to `ratios`. The parts always add up to this amount: the leftover
   * minor units go one by one to the first parts.
   */
  allocate (ratios: readonly DecimalInput[]): Money[] {
    if (ratios.length === 0) {
      throw new RangeError('allocate() needs at least one ratio')
    }
    const weights = ratios.map((ratio) => Decimal.from(ratio))
    if (weights.some((weight) => weight.sign < 0)) {
      throw new RangeError('allocate() ratios must not be negative')
    }
    const total = weights.reduce((sum, weight) => sum.add(weight), Decimal.ZERO)
    if (total.isZero()) {
      throw new RangeError('allocate() ratios must not all be zero')
    }
    const digits = minorUnits(this.currency)
    const shares = weights.map((weight) => this.amount.multiply(weight).divide(total, digits, 'down'))
    let leftover = this.amount.subtract(shares.reduce((sum, share) => sum.add(share), Decimal.ZERO))
    const step = Decimal.parse(`1e-${digits}`)
    const unit = leftover.sign < 0 ? step.negate() : step
    const result = shares.map((share) => share)
    for (let i = 0; !leftover.isZero(); i = (i + 1) % result.length) {
      if (weights[i].isZero()) {
        continue
      }
      result[i] = result[i].add(unit)
      leftover = leftover.subtract(unit)
    }
    return result.map((share) => new Money(share, this.currency))
  }

  /** Throws for different currencies */
  compareTo (other: unknown): -1 | 0 | 1 {
    return this.amount.compareTo(this.same(other).amount)
  }

  equals (other: unknown): boolean {
    return other instanceof Money && other.currency === this.currency && this.amount.equals(other.amount)
  }

  lessThan (other: unknown): boolean {
    return this.compareTo(other) < 0
  }

  greaterThan (other: unknown): boolean {
    return this.compareTo(other) > 0
  }

  /** `'12.50 USD'` - always the full number of minor units */
  toString (): string {
    return `${this.amount.toFixed(minorUnits(this.currency))} ${this.currency}`
  }

  toJSON (): { amount: string, currency: string } {
    return { amount: this.amount.toFixed(minorUnits(this.currency)), currency: this.currency }
  }

  private same (other: unknown): Money {
    const that = Money.from(other)
    if (that.currency !== this.currency) {
      throw new TypeError(`Currency mismatch: ${this.currency} and ${that.currency}`)
    }
    return that
  }
}

markImmutable(Money)
