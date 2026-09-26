import { markImmutable } from './immutable'

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86400000

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
const daysInMonth = (year: number, month: number): number =>
  month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31

/** Days since 1970-01-01 (negative before), for a valid y/m/d */
const toEpochDay = (year: number, month: number, day: number): number => {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return Math.round(date.getTime() / DAY_MS)
}

/**
 * A calendar date without time and without a time zone: `2026-09-25` is that day everywhere.
 * `Date` cannot express this - `new Date('2026-09-25')` is midnight UTC and shows the 24th west of Greenwich.
 * Invalid dates (`2026-02-30`) are refused.
 *
 * Use it as a field with `@ActiveField({ coerce: LocalDate })`.
 * @example
 * LocalDate.from('2026-01-31').addMonths(1).toString()   // '2026-02-28' (clamped to the month's end)
 */
export class LocalDate {
  readonly year: number
  /** 1-12 */
  readonly month: number
  /** 1-31 */
  readonly day: number

  private constructor (year: number, month: number, day: number) {
    this.year = year
    this.month = month
    this.day = day
    Object.freeze(this)
  }

  static of (year: number, month: number, day: number): LocalDate {
    if (![year, month, day].every(Number.isInteger) || year < 0 || year > 9999 || month < 1 || month > 12 ||
      day < 1 || day > daysInMonth(year, month)) {
      throw new RangeError(`Not a calendar date: ${year}-${month}-${day}`)
    }
    return new LocalDate(year, month, day)
  }

  /** From a LocalDate, `'YYYY-MM-DD'`, `{ year, month, day }` or a `Date` (its local calendar day) */
  static from (value: unknown): LocalDate {
    if (value instanceof LocalDate) {
      return value
    }
    if (typeof value === 'string') {
      const match = ISO.exec(value.trim())
      if (!match) {
        throw new TypeError(`Not an ISO date (YYYY-MM-DD): ${JSON.stringify(value)}`)
      }
      return LocalDate.of(Number(match[1]), Number(match[2]), Number(match[3]))
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new TypeError('Invalid Date')
      }
      return LocalDate.of(value.getFullYear(), value.getMonth() + 1, value.getDate())
    }
    if (typeof value === 'object' && value !== null && 'year' in value && 'month' in value && 'day' in value) {
      const { year, month, day } = value as { year: number, month: number, day: number }
      return LocalDate.of(year, month, day)
    }
    throw new TypeError(`Cannot make a LocalDate from ${typeof value}`)
  }

  /** Today's date in the local time zone */
  static today (): LocalDate {
    return LocalDate.from(new Date())
  }

  static fromEpochDay (epochDay: number): LocalDate {
    const date = new Date(epochDay * DAY_MS)
    return LocalDate.of(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }

  /** Days since 1970-01-01 */
  toEpochDay (): number {
    return toEpochDay(this.year, this.month, this.day)
  }

  /** 1 (Monday) - 7 (Sunday) */
  get dayOfWeek (): number {
    return ((this.toEpochDay() + 3) % 7 + 7) % 7 + 1
  }

  get isLeapYear (): boolean {
    return isLeap(this.year)
  }

  get lengthOfMonth (): number {
    return daysInMonth(this.year, this.month)
  }

  addDays (days: number): LocalDate {
    return LocalDate.fromEpochDay(this.toEpochDay() + days)
  }

  /** The day of month is clamped to the target month's length */
  addMonths (months: number): LocalDate {
    const index = this.year * 12 + (this.month - 1) + months
    const year = Math.floor(index / 12)
    const month = index - year * 12 + 1
    return LocalDate.of(year, month, Math.min(this.day, daysInMonth(year, month)))
  }

  addYears (years: number): LocalDate {
    return this.addMonths(years * 12)
  }

  /** Whole days from this date to `other` (negative if `other` is earlier) */
  daysUntil (other: unknown): number {
    return LocalDate.from(other).toEpochDay() - this.toEpochDay()
  }

  compareTo (other: unknown): -1 | 0 | 1 {
    const diff = this.daysUntil(other)
    return diff > 0 ? -1 : diff < 0 ? 1 : 0
  }

  equals (other: unknown): boolean {
    return other instanceof LocalDate && this.compareTo(other) === 0
  }

  isBefore (other: unknown): boolean {
    return this.compareTo(other) < 0
  }

  isAfter (other: unknown): boolean {
    return this.compareTo(other) > 0
  }

  /** Local midnight of this day */
  toDate (): Date {
    return new Date(this.year, this.month - 1, this.day)
  }

  /** `'YYYY-MM-DD'` */
  toString (): string {
    return `${String(this.year).padStart(4, '0')}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`
  }

  toJSON (): string {
    return this.toString()
  }
}

markImmutable(LocalDate)
