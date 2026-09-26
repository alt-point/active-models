import { markImmutable } from './immutable'

/** How a value is rounded when digits are dropped */
export type RoundingMode =
  | 'down' // toward zero
  | 'up' // away from zero
  | 'floor' // toward -infinity
  | 'ceiling' // toward +infinity
  | 'half-up' // to nearest, ties away from zero
  | 'half-down' // to nearest, ties toward zero
  | 'half-even' // to nearest, ties to the even neighbour (banker's rounding)

export type DecimalInput = Decimal | string | number | bigint

/*
 * The build targets ES2018, which has no bigint literals (`n(10)`), so every bigint is made with `n(10)`.
 * Nothing runs at import time: an environment without BigInt fails only when a Decimal is actually used.
 */
const n = (value: number): bigint => BigInt(value)
const pow10 = (exponent: number): bigint => n(10) ** n(exponent)
const MAX_EXPONENT = 1000
const FORMAT = /^([+-])?(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/

/**
 * Drop `divisor`'s worth of digits from `units`, rounding as asked. `remainder` carries the sign of `units`.
 */
const roundDiv = (quotient: bigint, remainder: bigint, divisor: bigint, mode: RoundingMode): bigint => {
  if (remainder === n(0)) {
    return quotient
  }
  const negative = remainder < n(0)
  const twice = (negative ? -remainder : remainder) * n(2)
  const away = negative ? quotient - n(1) : quotient + n(1)
  switch (mode) {
    case 'down': return quotient
    case 'up': return away
    case 'floor': return negative ? away : quotient
    case 'ceiling': return negative ? quotient : away
    case 'half-up': return twice >= divisor ? away : quotient
    case 'half-down': return twice > divisor ? away : quotient
    case 'half-even':
      return twice > divisor || (twice === divisor && quotient % n(2) !== n(0)) ? away : quotient
  }
}

/**
 * An immutable arbitrary-precision decimal number: exact `+ - *`, division with an explicit scale and
 * rounding, no binary floating point. Stored as `units / 10^scale` in canonical form (no trailing zeros), so
 * `1.50` and `1.5` are the same value with the same fields.
 *
 * Use it as a field with `@ActiveField({ coerce: Decimal })`.
 * @example
 * Decimal.from('0.1').add('0.2').toString()   // '0.3'  (0.1 + 0.2 === 0.30000000000000004 in JS)
 */
export class Decimal {
  /** The digits as an integer */
  readonly units: bigint
  /** How many of them are after the decimal point (>= 0) */
  readonly scale: number

  private constructor (units: bigint, scale: number) {
    let u = units
    let s = scale
    while (s > 0 && u % n(10) === n(0)) {
      u /= n(10)
      s--
    }
    this.units = u
    this.scale = u === n(0) ? 0 : s
    Object.freeze(this)
  }

  /** The number zero */
  static get ZERO (): Decimal {
    return Decimal.from(0)
  }

  /**
   * Build from a decimal string (`'-12.5'`, `'1e-3'`), a finite number (via its shortest decimal form), a bigint
   * or a Decimal. Throws on anything else, including `NaN` and `Infinity`.
   */
  static from (value: unknown): Decimal {
    if (value instanceof Decimal) {
      return value
    }
    if (typeof value === 'bigint') {
      return new Decimal(value, 0)
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot make a Decimal from ${value}`)
      }
      return Decimal.parse(String(value))
    }
    if (typeof value === 'string') {
      return Decimal.parse(value)
    }
    throw new TypeError(`Cannot make a Decimal from ${typeof value}`)
  }

  /** Parse a decimal string; whitespace around it is ignored */
  static parse (text: string): Decimal {
    const match = FORMAT.exec(text.trim())
    if (!match) {
      throw new TypeError(`Not a decimal number: ${JSON.stringify(text)}`)
    }
    const [, sign, digits, exponent] = match
    const [whole, fraction = ''] = digits.split('.')
    const shift = Number(exponent ?? 0)
    if (Math.abs(shift) > MAX_EXPONENT) {
      throw new RangeError(`Exponent out of range: ${exponent}`)
    }
    let units = BigInt(`${whole || '0'}${fraction}`)
    let scale = fraction.length - shift
    if (scale < 0) {
      units *= pow10(-scale)
      scale = 0
    }
    return new Decimal(sign === '-' ? -units : units, scale)
  }

  /** `-1`, `0` or `1` */
  get sign (): -1 | 0 | 1 {
    return this.units < n(0) ? -1 : this.units > n(0) ? 1 : 0
  }

  isZero (): boolean {
    return this.units === n(0)
  }

  negate (): Decimal {
    return new Decimal(-this.units, this.scale)
  }

  abs (): Decimal {
    return this.units < n(0) ? this.negate() : this
  }

  add (other: DecimalInput): Decimal {
    const [a, b, scale] = align(this, Decimal.from(other))
    return new Decimal(a + b, scale)
  }

  subtract (other: DecimalInput): Decimal {
    const [a, b, scale] = align(this, Decimal.from(other))
    return new Decimal(a - b, scale)
  }

  multiply (other: DecimalInput): Decimal {
    const factor = Decimal.from(other)
    return new Decimal(this.units * factor.units, this.scale + factor.scale)
  }

  /**
   * Divide, keeping `scale` digits after the point (20 by default) and rounding the rest.
   * Division is not exact in general, so the precision is always your explicit choice.
   */
  divide (other: DecimalInput, scale: number = 20, mode: RoundingMode = 'half-up'): Decimal {
    const divisor = Decimal.from(other)
    if (divisor.isZero()) {
      throw new RangeError('Division by zero')
    }
    assertScale(scale)
    let numerator = this.units * pow10(scale + divisor.scale)
    let denominator = divisor.units * pow10(this.scale)
    if (denominator < n(0)) {
      // keep the denominator positive so the remainder carries the sign of the true quotient
      numerator = -numerator
      denominator = -denominator
    }
    return new Decimal(roundDiv(numerator / denominator, numerator % denominator, denominator, mode), scale)
  }

  /** Round to `scale` digits after the point (a negative scale rounds to tens, hundreds...) */
  round (scale: number = 0, mode: RoundingMode = 'half-up'): Decimal {
    assertScale(scale, true)
    if (scale >= this.scale) {
      return this
    }
    const drop = this.scale - scale
    const divisor = pow10(drop)
    const rounded = roundDiv(this.units / divisor, this.units % divisor, divisor, mode)
    return scale >= 0
      ? new Decimal(rounded, scale)
      : new Decimal(rounded * pow10(-scale), 0)
  }

  compareTo (other: DecimalInput): -1 | 0 | 1 {
    const [a, b] = align(this, Decimal.from(other))
    return a < b ? -1 : a > b ? 1 : 0
  }

  equals (other: DecimalInput): boolean {
    return this.compareTo(other) === 0
  }

  lessThan (other: DecimalInput): boolean {
    return this.compareTo(other) < 0
  }

  lessThanOrEqual (other: DecimalInput): boolean {
    return this.compareTo(other) <= 0
  }

  greaterThan (other: DecimalInput): boolean {
    return this.compareTo(other) > 0
  }

  greaterThanOrEqual (other: DecimalInput): boolean {
    return this.compareTo(other) >= 0
  }

  /** The plain decimal notation, never an exponent: `'0.001'`, `'-12.5'`, `'100000000000000000000000'` */
  toString (): string {
    const negative = this.units < n(0)
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, '0')
    const whole = digits.slice(0, digits.length - this.scale)
    const fraction = digits.slice(digits.length - this.scale)
    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
  }

  /** Exactly `scale` digits after the point, rounding if needed: `Decimal.from(2).toFixed(2) === '2.00'` */
  toFixed (scale: number, mode: RoundingMode = 'half-up'): string {
    assertScale(scale)
    const rounded = this.round(scale, mode)
    const text = rounded.toString()
    if (scale === 0) {
      return text
    }
    const [whole, fraction = ''] = text.split('.')
    return `${whole}.${fraction.padEnd(scale, '0')}`
  }

  /** A JavaScript number - lossy beyond about 15 significant digits */
  toNumber (): number {
    return Number(this.toString())
  }

  /** The JSON form is the string, so no precision is lost on the wire */
  toJSON (): string {
    return this.toString()
  }

  [Symbol.toPrimitive] (hint: string): string | number {
    return hint === 'number' ? this.toNumber() : this.toString()
  }
}

const align = (a: Decimal, b: Decimal): [bigint, bigint, number] => {
  const scale = Math.max(a.scale, b.scale)
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale]
}

const assertScale = (scale: number, allowNegative = false) => {
  if (!Number.isInteger(scale) || (!allowNegative && scale < 0) || Math.abs(scale) > MAX_EXPONENT) {
    throw new RangeError(`Scale must be an integer${allowNegative ? '' : ' >= 0'} (at most ${MAX_EXPONENT}), got ${scale}`)
  }
}

markImmutable(Decimal)
