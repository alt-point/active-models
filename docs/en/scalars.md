# Safe scalars: Decimal, Money, LocalDate

Immutable values for data that `number` and `Date` store imprecisely. Attach them as a model field with
`coerce: Class`: input strings, numbers and objects become an instance, and JSON receives a string with no loss of precision.

```ts
import { ActiveModel, ActiveField, Decimal, Money, LocalDate } from '@alt-point/active-models'

class Invoice extends ActiveModel {
  @ActiveField({ coerce: Money, min: Money.of(1, 'USD') }) total: Money = Money.of(1, 'USD')
  @ActiveField({ coerce: Decimal, min: Decimal.from(0) }) vatRate?: Decimal
  @ActiveField({ coerce: LocalDate, required: true, min: LocalDate.of(2020, 1, 1) }) due?: LocalDate
}

const invoice = Invoice.create({ total: '19.99 USD', vatRate: '0.2', due: '2026-09-25' })
invoice.total.multiply(invoice.vatRate!)   // Money 4.00 USD
invoice.due = new Date(2027, 0, 5)         // LocalDate 2027-01-05 (local day of the Date)
invoice.due = '2026-02-30'                 // ValidationError (code: coerce): not a calendar date
invoice.total = '5 EUR'                    // ValidationError: a different currency cannot be compared with the min bound
JSON.stringify(invoice)                    // {"total":{"amount":"19.99","currency":"USD"},"vatRate":"0.2","due":"2026-09-25"}
```

`coerce`, `type`, `min` and `max` accept any class with a static `from(value)` (throws on error) and a `compareTo`
method. Values are not copied by `clone()`, `changes()` and `undo()`: they are immutable and frozen.

## Decimal

Arbitrary-precision decimal number backed by `BigInt`. `0.1 + 0.2` yields `0.3`.

| Method | Description |
|---|---|
| `Decimal.from(x)` / `parse(text)` | from a string (`'-12.5'`, `'1e-3'`), finite number, `bigint`, `Decimal`; otherwise `TypeError` |
| `add`, `subtract`, `multiply` | exact operations |
| `divide(x, scale = 20, mode = 'half-up')` | division: precision and rounding are explicit |
| `round(scale = 0, mode = 'half-up')` | rounding; a negative `scale` rounds to tens, hundreds |
| `compareTo`, `equals`, `lessThan`, `greaterThan`, `...OrEqual` | comparison |
| `sign`, `isZero()`, `negate()`, `abs()` | sign and absolute value |
| `toString()`, `toFixed(scale, mode)`, `toNumber()`, `toJSON()` | output; `toString()` never uses exponent notation |

Rounding modes: `down` (toward zero), `up` (away from zero), `floor`, `ceiling`, `half-up`, `half-down`, `half-even`
(banker's).

```ts
Decimal.from('0.1').add('0.2').toString()        // '0.3'
Decimal.from(1).divide(3, 5).toString()          // '0.33333'
Decimal.from('2.5').round(0, 'half-even')        // 2
Decimal.from('1.50').equals('1.5')               // true: canonical form without trailing zeros
```

## Money

An amount in a single currency. The number of decimal places equals the currency's (`USD` — 2, `JPY` — 0, `KWD` — 3).

| Method | Description |
|---|---|
| `Money.of(amount, currency)` | `RangeError` if there are more decimal places than the currency allows; currency is three uppercase letters |
| `Money.from(x)` | from `Money`, a `'12.50 USD'` string or `{ amount, currency }` |
| `add`, `subtract` | `TypeError` for different currencies |
| `multiply(factor, mode = 'half-even')`, `divide(x, mode)` | the result is rounded to the currency's minor unit |
| `allocate(ratios)` | splits the amount proportionally; the remainder is handed out one minor unit at a time, starting from the first parts; the parts always sum to the original |
| `compareTo`, `equals`, `lessThan`, `greaterThan`, `isZero`, `negate`, `abs`, `sign` | comparison and sign |
| `toString()`, `toJSON()` | `'12.50 USD'`, `{ amount: '12.50', currency: 'USD' }` |

```ts
Money.of('100', 'USD').allocate([1, 1, 1]).map(String)   // ['33.34 USD', '33.33 USD', '33.33 USD']
Money.of('19.99', 'USD').multiply(3).toString()          // '59.97 USD'
Money.of('10', 'USD').add(Money.of('1', 'EUR'))          // TypeError: Currency mismatch: USD and EUR
```

## LocalDate

A calendar date without time or time zone. `new Date('2026-09-25')` is midnight UTC; west of Greenwich it shows
September 24. `LocalDate` is September 25 everywhere.

| Method | Description |
|---|---|
| `LocalDate.of(y, m, d)` / `from(x)` | from `'YYYY-MM-DD'`, `{ year, month, day }`, `Date` (local day); nonexistent dates throw |
| `today()`, `fromEpochDay(n)`, `toEpochDay()` | days since 1970-01-01 |
| `addDays`, `addMonths`, `addYears` | the day of month is clamped to the month length: `2026-01-31 + 1 month = 2026-02-28` |
| `daysUntil(other)` | whole days until another date (negative if it is earlier) |
| `dayOfWeek`, `isLeapYear`, `lengthOfMonth` | 1 (Monday) to 7 (Sunday) |
| `compareTo`, `equals`, `isBefore`, `isAfter` | comparison |
| `toDate()`, `toString()`, `toJSON()` | local midnight, `'YYYY-MM-DD'` |

## Custom scalar

Any class with `static from(value)`, `compareTo` (for `min`/`max`) and `toJSON` works. To stop the model from copying
the value, mark the class as immutable:

```ts
import { markImmutable } from '@alt-point/active-models'

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
```
