import { describe, expect, it } from 'vitest'
import { ActiveField, ActiveModel, Decimal, LocalDate, Money, ValidationError, markImmutable } from '../src'

const d = (value: string | number) => Decimal.from(value)
const big = (value: number | string) => BigInt(value)

describe('Decimal', () => {
  it('is exact where binary floats are not', () => {
    expect(d('0.1').add('0.2').toString()).toBe('0.3')
    expect(d('1.1').multiply('1.1').toString()).toBe('1.21')
    expect(d('0.3').subtract('0.1').toString()).toBe('0.2')
  })

  it('normalizes the representation', () => {
    expect(d('1.50').toString()).toBe('1.5')
    expect(d('1.50').equals('1.5')).toBe(true)
    expect(d('1.50').scale).toBe(1)
    expect(d('-0.0').toString()).toBe('0')
    expect(d('0.000').scale).toBe(0)
    expect(d('100').toString()).toBe('100')
    expect(d('1e3').toString()).toBe('1000')
    expect(d('1e-3').toString()).toBe('0.001')
    expect(d('.5').toString()).toBe('0.5')
    expect(d('5.').toString()).toBe('5')
    expect(d('+7').toString()).toBe('7')
    expect(d('  12.5 ').toString()).toBe('12.5')
  })

  it('accepts numbers, bigints and Decimals, refuses the rest', () => {
    expect(d(0.1).toString()).toBe('0.1')
    expect(Decimal.from(big(12) * big(10) ** big(20)).toString()).toBe('1200000000000000000000')
    const x = d('1.5')
    expect(Decimal.from(x)).toBe(x)
    expect(() => Decimal.from(NaN)).toThrow(TypeError)
    expect(() => Decimal.from(Infinity)).toThrow(TypeError)
    expect(() => Decimal.from('abc')).toThrow('Not a decimal number')
    expect(() => Decimal.from('')).toThrow(TypeError)
    expect(() => Decimal.from('1.2.3')).toThrow(TypeError)
    expect(() => Decimal.from(null)).toThrow('Cannot make a Decimal from object')
    expect(() => Decimal.from('1e5000')).toThrow(RangeError)
  })

  it('formats without an exponent and to a fixed scale', () => {
    expect(d('1e30').toString()).toBe('1000000000000000000000000000000')
    expect(d(2).toFixed(2)).toBe('2.00')
    expect(d('2.345').toFixed(2)).toBe('2.35')
    expect(d('-2.345').toFixed(2)).toBe('-2.35')
    expect(d('2.5').toFixed(0)).toBe('3')
    expect(d('-0.001').toFixed(2)).toBe('0.00')
    expect(() => d(1).toFixed(-1)).toThrow(RangeError)
    expect(() => d(1).toFixed(1.5)).toThrow(RangeError)
  })

  it('rounds by every mode', () => {
    const table: Array<[string, Record<string, string>]> = [
      ['2.5', { down: '2', up: '3', floor: '2', ceiling: '3', 'half-up': '3', 'half-down': '2', 'half-even': '2' }],
      ['3.5', { down: '3', up: '4', floor: '3', ceiling: '4', 'half-up': '4', 'half-down': '3', 'half-even': '4' }],
      ['-2.5', { down: '-2', up: '-3', floor: '-3', ceiling: '-2', 'half-up': '-3', 'half-down': '-2', 'half-even': '-2' }],
      ['-3.5', { down: '-3', up: '-4', floor: '-4', ceiling: '-3', 'half-up': '-4', 'half-down': '-3', 'half-even': '-4' }],
      ['2.4', { down: '2', up: '3', floor: '2', ceiling: '3', 'half-up': '2', 'half-down': '2', 'half-even': '2' }],
      ['2.6', { down: '2', up: '3', floor: '2', ceiling: '3', 'half-up': '3', 'half-down': '3', 'half-even': '3' }],
      ['-2.6', { down: '-2', up: '-3', floor: '-3', ceiling: '-2', 'half-up': '-3', 'half-down': '-3', 'half-even': '-3' }],
      ['-2.4', { down: '-2', up: '-3', floor: '-3', ceiling: '-2', 'half-up': '-2', 'half-down': '-2', 'half-even': '-2' }],
      ['2', { down: '2', up: '2', floor: '2', ceiling: '2', 'half-up': '2', 'half-down': '2', 'half-even': '2' }],
    ]
    for (const [input, expected] of table) {
      for (const [mode, result] of Object.entries(expected)) {
        expect(d(input).round(0, mode as never).toString(), `${input} ${mode}`).toBe(result)
      }
    }
  })

  it('rounds to tens with a negative scale and keeps finer values as they are', () => {
    expect(d('1234').round(-2).toString()).toBe('1200')
    expect(d('1250').round(-2).toString()).toBe('1300')
    expect(d('1.5').round(3).toString()).toBe('1.5')
    expect(d('1.005').round(2, 'half-even').toString()).toBe('1')
    expect(d('1.015').round(2, 'half-even').toString()).toBe('1.02')
  })

  it('divides with an explicit scale and mode', () => {
    expect(d(1).divide(3, 5).toString()).toBe('0.33333')
    expect(d(2).divide(3, 5).toString()).toBe('0.66667')
    expect(d(2).divide(3, 5, 'down').toString()).toBe('0.66666')
    expect(d(-2).divide(3, 5).toString()).toBe('-0.66667')
    expect(d(2).divide(-3, 5).toString()).toBe('-0.66667')
    expect(d(-2).divide(-3, 5).toString()).toBe('0.66667')
    expect(d(-1).divide(-4, 1, 'floor').toString()).toBe('0.2')
    expect(d(1).divide(-4, 1, 'floor').toString()).toBe('-0.3')
    expect(d(1).divide(-4, 1, 'ceiling').toString()).toBe('-0.2')
    expect(d('1.5').divide('0.5', 0).toString()).toBe('3')
    expect(d('0.1').divide(3).toString()).toBe('0.03333333333333333333')
    expect(d(10).divide(4, 0, 'half-even').toString()).toBe('2')
    expect(() => d(1).divide(0)).toThrow('Division by zero')
    expect(() => d(1).divide(3, -1)).toThrow(RangeError)
  })

  it('compares and predicates', () => {
    expect(d('1.10').compareTo('1.1')).toBe(0)
    expect(d(1).compareTo(2)).toBe(-1)
    expect(d(2).compareTo(1)).toBe(1)
    expect(d(1).lessThan(2)).toBe(true)
    expect(d(1).lessThan(1)).toBe(false)
    expect(d(1).lessThanOrEqual(1)).toBe(true)
    expect(d(2).greaterThan(1)).toBe(true)
    expect(d(1).greaterThan(1)).toBe(false)
    expect(d(1).greaterThanOrEqual(1)).toBe(true)
    expect(d(1).greaterThanOrEqual(2)).toBe(false)
    expect(d(-5).sign).toBe(-1)
    expect(d(0).sign).toBe(0)
    expect(d(5).sign).toBe(1)
    expect(d(0).isZero()).toBe(true)
    expect(d(1).isZero()).toBe(false)
    expect(d(-5).abs().toString()).toBe('5')
    expect(d(5).abs().toString()).toBe('5')
    expect(d(5).negate().toString()).toBe('-5')
    expect(Decimal.ZERO.toString()).toBe('0')
  })

  it('converts to primitives and JSON', () => {
    expect(d('12.5').toNumber()).toBe(12.5)
    expect(JSON.stringify({ v: d('0.1') })).toBe('{"v":"0.1"}')
    expect(`${d('1.5')}`).toBe('1.5')
    expect(+d('1.5')).toBe(1.5)
    expect(Object.isFrozen(d(1))).toBe(true)
  })

  it('matches a BigInt reference on random integer and decimal arithmetic', () => {
    let seed = 12345
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let i = 0; i < 300; i++) {
      const a = big(random() - 1e9) * big(random() % 1000 + 1)
      const b = big(random() - 1e9)
      const scaleA = random() % 6
      const scaleB = random() % 6
      const da = Decimal.from(`${a}e-${scaleA}`)
      const db = Decimal.from(`${b}e-${scaleB}`)
      const common = Math.max(scaleA, scaleB)
      const ua = a * big(10) ** big(common - scaleA)
      const ub = b * big(10) ** big(common - scaleB)
      expect(da.add(db).equals(Decimal.from(`${ua + ub}e-${common}`))).toBe(true)
      expect(da.subtract(db).equals(Decimal.from(`${ua - ub}e-${common}`))).toBe(true)
      expect(da.multiply(db).equals(Decimal.from(`${a * b}e-${scaleA + scaleB}`))).toBe(true)
      expect(Decimal.from(da.toString()).equals(da)).toBe(true)
      expect(da.compareTo(db)).toBe(ua < ub ? -1 : ua > ub ? 1 : 0)
    }
  })
})

describe('Money', () => {
  it('builds, validates the currency and the precision', () => {
    expect(Money.of('19.99', 'USD').toString()).toBe('19.99 USD')
    expect(Money.of(5, 'USD').toString()).toBe('5.00 USD')
    expect(Money.of(500, 'JPY').toString()).toBe('500 JPY')
    expect(Money.of('1.234', 'KWD').toString()).toBe('1.234 KWD')
    expect(() => Money.of('1.005', 'USD')).toThrow(RangeError)
    expect(() => Money.of('1.5', 'JPY')).toThrow(RangeError)
    expect(() => Money.of(1, 'usd')).toThrow(TypeError)
    expect(() => Money.of(1, 'US')).toThrow(TypeError)
    expect(() => Money.of(1, 5 as never)).toThrow(TypeError)
    expect(Money.zero('EUR').isZero()).toBe(true)
  })

  it('parses from a string, an object or a Money', () => {
    expect(Money.from('12.50 usd').toString()).toBe('12.50 USD')
    expect(Money.from('-3 EUR').toString()).toBe('-3.00 EUR')
    expect(Money.from({ amount: '4', currency: 'GBP' }).toString()).toBe('4.00 GBP')
    const m = Money.of(1, 'USD')
    expect(Money.from(m)).toBe(m)
    expect(() => Money.from('12.50')).toThrow('Not a money value')
    expect(() => Money.from(12)).toThrow(TypeError)
    expect(() => Money.from(null)).toThrow(TypeError)
    expect(() => Money.from({ amount: 1 })).toThrow(TypeError)
  })

  it('does arithmetic in one currency only', () => {
    const a = Money.of('10.10', 'USD')
    expect(a.add(Money.of('0.20', 'USD')).toString()).toBe('10.30 USD')
    expect(a.add('0.20 USD').toString()).toBe('10.30 USD')
    expect(a.subtract(Money.of('20', 'USD')).toString()).toBe('-9.90 USD')
    expect(a.negate().toString()).toBe('-10.10 USD')
    expect(a.negate().abs().toString()).toBe('10.10 USD')
    expect(a.sign).toBe(1)
    expect(() => a.add(Money.of(1, 'EUR'))).toThrow('Currency mismatch: USD and EUR')
    expect(() => a.compareTo(Money.of(1, 'EUR'))).toThrow(TypeError)
  })

  it('multiplies and divides with rounding to minor units', () => {
    expect(Money.of('19.99', 'USD').multiply(3).toString()).toBe('59.97 USD')
    expect(Money.of('10.00', 'USD').multiply('0.075').toString()).toBe('0.75 USD')
    expect(Money.of('0.05', 'USD').multiply('0.5').toString()).toBe('0.02 USD')
    expect(Money.of('0.05', 'USD').multiply('0.5', 'half-up').toString()).toBe('0.03 USD')
    expect(Money.of('100', 'USD').divide(3).toString()).toBe('33.33 USD')
    expect(Money.of('100', 'JPY').divide(3).toString()).toBe('33 JPY')
    expect(Money.of('100', 'USD').divide(8, 'up').toString()).toBe('12.50 USD')
  })

  it('allocates without losing a cent', () => {
    expect(Money.of('100', 'USD').allocate([1, 1, 1]).map(String)).toEqual(['33.34 USD', '33.33 USD', '33.33 USD'])
    expect(Money.of('0.05', 'USD').allocate([3, 7]).map(String)).toEqual(['0.02 USD', '0.03 USD'])
    expect(Money.of('-100', 'USD').allocate([1, 1, 1]).map(String)).toEqual(['-33.34 USD', '-33.33 USD', '-33.33 USD'])
    expect(Money.of('10', 'JPY').allocate([1, 1, 1]).map(String)).toEqual(['4 JPY', '3 JPY', '3 JPY'])
    expect(Money.of('5', 'USD').allocate([0, 1]).map(String)).toEqual(['0.00 USD', '5.00 USD'])
    expect(Money.of('0.01', 'USD').allocate([0, 1, 1]).map(String)).toEqual(['0.00 USD', '0.01 USD', '0.00 USD'])
    expect(Money.of('7', 'USD').allocate([1]).map(String)).toEqual(['7.00 USD'])
    expect(() => Money.of(1, 'USD').allocate([])).toThrow(RangeError)
    expect(() => Money.of(1, 'USD').allocate([0, 0])).toThrow(RangeError)
    expect(() => Money.of(1, 'USD').allocate([1, -1])).toThrow(RangeError)
  })

  it('allocation always sums to the original', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let i = 0; i < 200; i++) {
      const currency = ['USD', 'JPY', 'KWD'][random() % 3]
      const money = Money.of(Decimal.from(`${(random() % 2000000) - 1000000}e-${minorUnitsOf(currency)}`), currency)
      const ratios = Array.from({ length: (random() % 6) + 1 }, () => (random() % 9) + 1)
      const parts = money.allocate(ratios)
      const sum = parts.reduce((acc, part) => acc.add(part), Money.zero(currency))
      expect(sum.equals(money)).toBe(true)
      expect(parts).toHaveLength(ratios.length)
    }
  })

  it('compares and serializes', () => {
    const a = Money.of(1, 'USD')
    expect(a.equals(Money.of('1.00', 'USD'))).toBe(true)
    expect(a.equals(Money.of(1, 'EUR'))).toBe(false)
    expect(a.equals('1.00 USD')).toBe(false)
    expect(a.lessThan(Money.of(2, 'USD'))).toBe(true)
    expect(a.greaterThan(Money.of(2, 'USD'))).toBe(false)
    expect(a.compareTo(Money.of(1, 'USD'))).toBe(0)
    expect(JSON.stringify({ price: Money.of('5', 'USD') })).toBe('{"price":{"amount":"5.00","currency":"USD"}}')
    expect(Money.from(JSON.parse(JSON.stringify(a))).equals(a)).toBe(true)
    expect(Object.isFrozen(a)).toBe(true)
  })
})

const minorUnitsOf = (currency: string) => (currency === 'JPY' ? 0 : currency === 'KWD' ? 3 : 2)

describe('LocalDate', () => {
  it('builds and validates a calendar date', () => {
    expect(LocalDate.of(2026, 9, 25).toString()).toBe('2026-09-25')
    expect(LocalDate.from('2024-02-29').toString()).toBe('2024-02-29')
    expect(LocalDate.from(' 0001-01-01 ').toString()).toBe('0001-01-01')
    for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-1', 'tomorrow', '']) {
      expect(() => LocalDate.from(bad), bad).toThrow()
    }
    expect(() => LocalDate.of(1900, 2, 29)).toThrow(RangeError)
    expect(LocalDate.of(2000, 2, 29).toString()).toBe('2000-02-29')
    expect(() => LocalDate.of(2026.5, 1, 1)).toThrow(RangeError)
    expect(() => LocalDate.of(-1, 1, 1)).toThrow(RangeError)
    expect(() => LocalDate.of(10000, 1, 1)).toThrow(RangeError)
    expect(() => LocalDate.from(5)).toThrow(TypeError)
    expect(() => LocalDate.from(new Date('nope'))).toThrow('Invalid Date')
  })

  it('converts from Date (local day), objects and back', () => {
    expect(LocalDate.from(new Date(2026, 8, 25, 23, 59)).toString()).toBe('2026-09-25')
    expect(LocalDate.from({ year: 2026, month: 1, day: 2 }).toString()).toBe('2026-01-02')
    const date = LocalDate.of(2026, 9, 25).toDate()
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 8, 25, 0])
    const d1 = LocalDate.of(2026, 1, 1)
    expect(LocalDate.from(d1)).toBe(d1)
    expect(LocalDate.today()).toBeInstanceOf(LocalDate)
  })

  it('does calendar arithmetic', () => {
    expect(LocalDate.of(2026, 12, 31).addDays(1).toString()).toBe('2027-01-01')
    expect(LocalDate.of(2026, 3, 1).addDays(-1).toString()).toBe('2026-02-28')
    expect(LocalDate.of(2024, 3, 1).addDays(-1).toString()).toBe('2024-02-29')
    expect(LocalDate.of(2026, 1, 31).addMonths(1).toString()).toBe('2026-02-28')
    expect(LocalDate.of(2024, 1, 31).addMonths(1).toString()).toBe('2024-02-29')
    expect(LocalDate.of(2026, 11, 30).addMonths(3).toString()).toBe('2027-02-28')
    expect(LocalDate.of(2026, 1, 15).addMonths(-1).toString()).toBe('2025-12-15')
    expect(LocalDate.of(2026, 1, 15).addMonths(-13).toString()).toBe('2024-12-15')
    expect(LocalDate.of(2024, 2, 29).addYears(1).toString()).toBe('2025-02-28')
    expect(LocalDate.of(2024, 2, 29).addYears(4).toString()).toBe('2028-02-29')
    expect(LocalDate.of(2026, 9, 25).daysUntil('2026-10-05')).toBe(10)
    expect(LocalDate.of(2026, 9, 25).daysUntil('2026-09-20')).toBe(-5)
    expect(LocalDate.of(2023, 12, 31).daysUntil('2024-12-31')).toBe(366)
  })

  it('knows weekdays and calendar facts', () => {
    expect(LocalDate.of(2026, 9, 25).dayOfWeek).toBe(5)
    expect(LocalDate.of(1970, 1, 1).dayOfWeek).toBe(4)
    expect(LocalDate.of(2026, 9, 27).dayOfWeek).toBe(7)
    expect(LocalDate.of(2026, 9, 28).dayOfWeek).toBe(1)
    expect(LocalDate.of(1969, 12, 31).dayOfWeek).toBe(3)
    expect(LocalDate.of(2024, 1, 1).isLeapYear).toBe(true)
    expect(LocalDate.of(2100, 1, 1).isLeapYear).toBe(false)
    expect(LocalDate.of(2026, 2, 1).lengthOfMonth).toBe(28)
    expect(LocalDate.of(2026, 4, 1).lengthOfMonth).toBe(30)
    expect(LocalDate.of(2026, 1, 1).lengthOfMonth).toBe(31)
    expect(LocalDate.of(1970, 1, 1).toEpochDay()).toBe(0)
    expect(LocalDate.fromEpochDay(-1).toString()).toBe('1969-12-31')
  })

  it('compares, serializes and roundtrips every day of a leap cycle', () => {
    const a = LocalDate.of(2026, 1, 1)
    const b = LocalDate.of(2026, 1, 2)
    expect(a.compareTo(b)).toBe(-1)
    expect(b.compareTo(a)).toBe(1)
    expect(a.compareTo('2026-01-01')).toBe(0)
    expect(a.isBefore(b)).toBe(true)
    expect(a.isAfter(b)).toBe(false)
    expect(b.isAfter(a)).toBe(true)
    expect(a.equals(LocalDate.of(2026, 1, 1))).toBe(true)
    expect(a.equals('2026-01-01')).toBe(false)
    expect(JSON.stringify({ d: a })).toBe('{"d":"2026-01-01"}')
    expect(Object.isFrozen(a)).toBe(true)
    let day = LocalDate.of(2000, 1, 1)
    for (let i = 0; i < 366 * 4; i++) {
      const next = day.addDays(1)
      expect(day.daysUntil(next)).toBe(1)
      expect(LocalDate.from(next.toString()).equals(next)).toBe(true)
      expect(next.dayOfWeek).toBe((day.dayOfWeek % 7) + 1)
      day = next
    }
  })
})

describe('scalars as model fields', () => {
  class Invoice extends ActiveModel {
    @ActiveField({ coerce: Money, min: Money.of(1, 'USD') }) total: Money = Money.of(1, 'USD')
    @ActiveField({ coerce: Decimal, min: Decimal.from(0), max: '100' as never }) rate?: Decimal
    @ActiveField({ coerce: LocalDate, required: true, min: LocalDate.of(2020, 1, 1) }) due?: LocalDate
  }

  it('coerces input into the value classes', () => {
    const invoice = Invoice.create({ total: '19.99 USD', rate: '0.5', due: '2026-09-25' } as never)
    expect(invoice.total).toBeInstanceOf(Money)
    expect(invoice.total.toString()).toBe('19.99 USD')
    expect(invoice.rate).toBeInstanceOf(Decimal)
    expect(invoice.due?.toString()).toBe('2026-09-25')
    invoice.due = new Date(2027, 0, 5) as never
    expect(String(invoice.due)).toBe('2027-01-05')
    invoice.rate = 3 as never
    expect(String(invoice.rate)).toBe('3')
  })

  it('refuses what cannot be converted, and values under min', () => {
    const invoice = Invoice.create({ total: '5 USD', due: '2026-09-25' } as never)
    expect(() => { invoice.due = '2026-02-30' as never }).toThrow(ValidationError)
    try {
      invoice.due = 'nope' as never
    } catch (error) {
      expect((error as ValidationError).issues[0].code).toBe('coerce')
      expect((error as ValidationError).message).toContain('LocalDate')
    }
    expect(() => { invoice.due = '2019-12-31' as never }).toThrow('at least')
    expect(() => { invoice.total = '0.50 USD' as never }).toThrow('at least')
    expect(() => { invoice.total = '5 EUR' as never }).toThrow(ValidationError)
    expect(invoice.total.toString()).toBe('5.00 USD')
    expect(invoice.due?.toString()).toBe('2026-09-25')
  })

  it('validate() catches a missing required scalar', () => {
    const result = Invoice.create({} as never).validate()
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toEqual(['due'])
  })

  it('serializes to JSON and works with tracking, clone and changes', () => {
    const invoice = Invoice.create({ total: '19.99 USD', due: '2026-09-25' } as never, { tracked: true })
    expect(JSON.parse(JSON.stringify(invoice))).toMatchObject({
      total: { amount: '19.99', currency: 'USD' },
      due: '2026-09-25',
    })
    expect(invoice.isTouched()).toBe(false)
    invoice.total = '19.99 USD' as never
    expect(invoice.isTouched()).toBe(false)
    invoice.total = '20.00 USD' as never
    expect(invoice.isTouched()).toBe(true)
    expect(String((invoice.changes() as Record<string, { to: unknown }>).total.to)).toBe('20.00 USD')
    invoice.revert('total')
    expect(invoice.total.toString()).toBe('19.99 USD')
    expect(invoice.isTouched()).toBe(false)
    const copy = invoice.clone()
    expect(copy.total).toBe(invoice.total)
    expect(copy.due).toBe(invoice.due)
  })

  it('undo restores the previous value object', () => {
    const invoice = Invoice.create({ total: '2 USD', due: '2026-09-25' } as never, { history: true })
    invoice.total = '3 USD' as never
    invoice.undo()
    expect(invoice.total.toString()).toBe('2.00 USD')
  })
})

describe('custom scalar', () => {
  class Percent {
    private constructor (readonly value: number) { Object.freeze(this) }
    static from (x: unknown) {
      const value = Number(x)
      if (!(value >= 0 && value <= 100)) throw new RangeError('0..100')
      return new Percent(value)
    }

    compareTo (other: Percent) { return Math.sign(this.value - other.value) }
    toJSON () { return this.value }
  }
  markImmutable(Percent)

  class Discount extends ActiveModel {
    @ActiveField({ coerce: Percent, max: Percent.from(50) }) rate?: Percent
  }

  it('works through coerce, max and clone', () => {
    const discount = Discount.create({ rate: '20' } as never)
    expect(discount.rate).toBeInstanceOf(Percent)
    expect(() => { discount.rate = 150 as never }).toThrow(ValidationError)
    expect(() => { discount.rate = 60 as never }).toThrow('at most')
    expect(discount.clone().rate).toBe(discount.rate)
    expect(JSON.stringify(discount)).toBe('{"rate":20}')
  })
})
