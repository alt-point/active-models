# Безопасные скаляры: Decimal, Money, LocalDate

Неизменяемые значения для данных, которые `number` и `Date` хранят неточно. Подключаются как поле модели через
`coerce: Class`: входные строки, числа и объекты превращаются в экземпляр, JSON получает строку без потери точности.

```ts
import { ActiveModel, ActiveField, Decimal, Money, LocalDate } from '@alt-point/active-models'

class Invoice extends ActiveModel {
  @ActiveField({ coerce: Money, min: Money.of(1, 'USD') }) total: Money = Money.of(1, 'USD')
  @ActiveField({ coerce: Decimal, min: Decimal.from(0) }) vatRate?: Decimal
  @ActiveField({ coerce: LocalDate, required: true, min: LocalDate.of(2020, 1, 1) }) due?: LocalDate
}

const invoice = Invoice.create({ total: '19.99 USD', vatRate: '0.2', due: '2026-09-25' })
invoice.total.multiply(invoice.vatRate!)   // Money 4.00 USD
invoice.due = new Date(2027, 0, 5)         // LocalDate 2027-01-05 (локальный день Date)
invoice.due = '2026-02-30'                 // ValidationError (code: coerce): не календарная дата
invoice.total = '5 EUR'                    // ValidationError: другую валюту нельзя сравнить с границей min
JSON.stringify(invoice)                    // {"total":{"amount":"19.99","currency":"USD"},"vatRate":"0.2","due":"2026-09-25"}
```

`coerce`, `type`, `min` и `max` принимают любой класс со статическим `from(value)` (бросает при ошибке) и методом
`compareTo`. Значения не копируются при `clone()`, `changes()` и `undo()`: они неизменяемы и заморожены.

## Decimal

Десятичное число произвольной точности на `BigInt`. `0.1 + 0.2` даёт `0.3`.

| Метод | Описание |
|---|---|
| `Decimal.from(x)` / `parse(text)` | из строки (`'-12.5'`, `'1e-3'`), конечного числа, `bigint`, `Decimal`; иначе `TypeError` |
| `add`, `subtract`, `multiply` | точные операции |
| `divide(x, scale = 20, mode = 'half-up')` | деление: точность и округление задаются явно |
| `round(scale = 0, mode = 'half-up')` | округление; отрицательный `scale` округляет до десятков, сотен |
| `compareTo`, `equals`, `lessThan`, `greaterThan`, `...OrEqual` | сравнение |
| `sign`, `isZero()`, `negate()`, `abs()` | знак и модуль |
| `toString()`, `toFixed(scale, mode)`, `toNumber()`, `toJSON()` | вывод; `toString()` не использует экспоненту |

Режимы округления: `down` (к нулю), `up` (от нуля), `floor`, `ceiling`, `half-up`, `half-down`, `half-even`
(банковское).

```ts
Decimal.from('0.1').add('0.2').toString()        // '0.3'
Decimal.from(1).divide(3, 5).toString()          // '0.33333'
Decimal.from('2.5').round(0, 'half-even')        // 2
Decimal.from('1.50').equals('1.5')               // true: каноническая форма без хвостовых нулей
```

## Money

Сумма в одной валюте. Знаков после запятой ровно столько, сколько у валюты (`USD` — 2, `JPY` — 0, `KWD` — 3).

| Метод | Описание |
|---|---|
| `Money.of(amount, currency)` | `RangeError`, если знаков больше, чем у валюты; валюта — три заглавные буквы |
| `Money.from(x)` | из `Money`, строки `'12.50 USD'` или `{ amount, currency }` |
| `add`, `subtract` | `TypeError` при разных валютах |
| `multiply(factor, mode = 'half-even')`, `divide(x, mode)` | результат округляется до минимальной единицы валюты |
| `allocate(ratios)` | делит сумму пропорционально, остаток раздаётся по одной минимальной единице с первых частей; сумма частей всегда равна исходной |
| `compareTo`, `equals`, `lessThan`, `greaterThan`, `isZero`, `negate`, `abs`, `sign` | сравнение и знак |
| `toString()`, `toJSON()` | `'12.50 USD'`, `{ amount: '12.50', currency: 'USD' }` |

```ts
Money.of('100', 'USD').allocate([1, 1, 1]).map(String)   // ['33.34 USD', '33.33 USD', '33.33 USD']
Money.of('19.99', 'USD').multiply(3).toString()          // '59.97 USD'
Money.of('10', 'USD').add(Money.of('1', 'EUR'))          // TypeError: Currency mismatch: USD and EUR
```

## LocalDate

Календарная дата без времени и часового пояса. `new Date('2026-09-25')` — это полночь по UTC, к западу от
Гринвича она показывает 24 сентября; `LocalDate` — 25 сентября везде.

| Метод | Описание |
|---|---|
| `LocalDate.of(y, m, d)` / `from(x)` | из `'YYYY-MM-DD'`, `{ year, month, day }`, `Date` (локальный день); несуществующие даты — ошибка |
| `today()`, `fromEpochDay(n)`, `toEpochDay()` | дни от 1970-01-01 |
| `addDays`, `addMonths`, `addYears` | день месяца обрезается по длине месяца: `2026-01-31 + 1 месяц = 2026-02-28` |
| `daysUntil(other)` | целых дней до другой даты (отрицательно, если она раньше) |
| `dayOfWeek`, `isLeapYear`, `lengthOfMonth` | 1 (понедельник) — 7 (воскресенье) |
| `compareTo`, `equals`, `isBefore`, `isAfter` | сравнение |
| `toDate()`, `toString()`, `toJSON()` | локальная полночь, `'YYYY-MM-DD'` |

## Свой скаляр

Подойдёт любой класс с `static from(value)`, `compareTo` (для `min`/`max`) и `toJSON`. Чтобы модель не копировала
значение, пометьте класс неизменяемым:

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
