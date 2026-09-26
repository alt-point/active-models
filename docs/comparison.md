# Сравнение с нативным кодом

Восемь типовых задач. В каждой две вкладки: решение на `ActiveModel` и то же поведение, написанное вручную на
чистом TypeScript. Нативные варианты рабочие и приведены без сокращений, чтобы сравнивать можно было и объём, и
число мест, где легко ошибиться.

## 1. Деньги без ошибок округления

Требование: цена в USD, сложение, налог 7,5%, разбивка на три платежа без потери копейки.

::: code-group

```ts [ActiveModel]
import { ActiveModel, ActiveField, Money } from '@alt-point/active-models'

class Order extends ActiveModel {
  @ActiveField({ coerce: Money, min: Money.of(0, 'USD') })
  total: Money = Money.of(0, 'USD')
}

const order = Order.create({ total: '19.99 USD' })
order.total = order.total.multiply(3)                       // 59.97 USD
const withTax = order.total.multiply('1.075')               // 64.47 USD (half-even)
withTax.allocate([1, 1, 1]).map(String)                     // ['21.49 USD', '21.49 USD', '21.49 USD']
order.total = '5 EUR'                                       // ValidationError: валюта не совпадает с границей min
JSON.stringify(order)                                       // {"total":{"amount":"59.97","currency":"USD"}}
```

```ts [Нативно]
// Числа с плавающей точкой: 0.1 + 0.2 !== 0.3, поэтому хранят целые центы.
type Money = { cents: number, currency: string }

const usd = (cents: number): Money => ({ cents, currency: 'USD' })

function assertSame (a: Money, b: Money) {
  if (a.currency !== b.currency) throw new TypeError(`Currency mismatch: ${a.currency} and ${b.currency}`)
}

function multiply (m: Money, factor: number): Money {
  // factor * cents тоже float: 1999 * 1.075 = 2149.2249999999997
  return usd(Math.round(m.cents * factor))          // half-up; банковское округление пишется вручную
}

function allocate (m: Money, ratios: number[]): Money[] {
  const total = ratios.reduce((a, b) => a + b, 0)
  if (ratios.length === 0 || total === 0 || ratios.some((r) => r < 0)) throw new RangeError('bad ratios')
  const shares = ratios.map((r) => Math.floor((m.cents * r) / total))
  let rest = m.cents - shares.reduce((a, b) => a + b, 0)
  for (let i = 0; rest > 0; i = (i + 1) % shares.length) {
    if (ratios[i] > 0) { shares[i]++; rest-- }
  }
  return shares.map(usd)                            // отрицательные суммы и валюты с 0/3 знаками - отдельная работа
}

const order = { total: usd(0) }
function setTotal (next: Money) {
  assertSame(next, order.total)
  if (next.cents < 0) throw new RangeError('total must be >= 0')
  order.total = next                                // каждая запись через функцию: присваивание order.total = ... обходит проверки
}

const toJSON = (m: Money) => ({ amount: (m.cents / 100).toFixed(2), currency: m.currency })
// парсинг '19.99 USD' -> cents: ещё одна функция; JSON.stringify(order) даст {"total":{"cents":...}}
```

:::

`Money` хранит сумму как `Decimal` на BigInt: результат не зависит от `Number`, знаки валют (JPY — 0, KWD — 3) учтены,
`JSON.stringify` даёт строки без потери точности.

## 2. Форма: нормализация, приведение типов, валидация

Требование: e-mail в нижнем регистре без пробелов, возраст приходит строкой, ошибки собираются целиком.

::: code-group

```ts [ActiveModel]
import { ActiveModel, ActiveField, ValidationError } from '@alt-point/active-models'

class Signup extends ActiveModel {
  @ActiveField({ trim: true, lowercase: true, required: true, pattern: /^[^@\s]+@[^@\s]+$/ })
  email: string = ''

  @ActiveField({ coerce: 'integer', min: 18, max: 120 })
  age: number = 0
}

const form = Signup.create({ email: '  Ann@Example.COM ', age: '32' })
form.email                     // 'ann@example.com'
form.age                       // 32
form.age = 'abc'               // ValidationError: "age" cannot be converted to integer
form.age = 10                  // ValidationError: "age" must be at least 18

Signup.create({ email: 'x' })  // ValidationError: данные из create() проходят те же правила
const { valid, issues } = Signup.create({}).validate()   // поля со значениями по умолчанию тоже проверяются
// valid: false; issues: [{ path: 'email', code: 'required' }, { path: 'age', code: 'min' }]
```

```ts [Нативно]
type Issue = { path: string, message: string }

type Signup = { email: string, age: number }

function normalize (input: { email?: unknown, age?: unknown }): Signup {
  return {
    email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : '',
    age: typeof input.age === 'string' && input.age.trim() !== '' ? Number(input.age) : (input.age as number) ?? 0,
  }
}

function validate (form: Signup): Issue[] {
  const issues: Issue[] = []
  if (!/^[^@\s]+@[^@\s]+$/.test(form.email)) issues.push({ path: 'email', message: 'invalid email' })
  if (!Number.isInteger(form.age)) issues.push({ path: 'age', message: 'must be an integer' })
  else if (form.age < 18) issues.push({ path: 'age', message: 'must be at least 18' })
  else if (form.age > 120) issues.push({ path: 'age', message: 'must be at most 120' })
  return issues
}

// Приведение и проверка живут отдельно от данных: присваивание form.age = 'abc' ничего не проверит.
const form = normalize({ email: '  Ann@Example.COM ', age: '32' })
const issues = validate(form)
if (issues.length) throw Object.assign(new Error('invalid'), { issues })

function update<K extends keyof Signup> (key: K, value: unknown) {
  const next = normalize({ ...form, [key]: value })    // поле пришлось бы перенормализовать целиком
  const problems = validate(next)
  if (problems.length) throw Object.assign(new Error('invalid'), { issues: problems })
  Object.assign(form, next)
}
```

:::

## 3. Несохранённые изменения и откат

Требование: показывать «есть несохранённые правки», список отличий, откат одного поля и всей формы.

::: code-group

```ts [ActiveModel]
class Profile extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField() bio: string = ''
}

const profile = Profile.create(saved, { tracked: true })
profile.name = 'Bob'
profile.isTouched()            // true
profile.changes()              // { name: { from: 'Ann', to: 'Bob' } }
profile.dirtyFields()          // ['name']
profile.revert('name')         // вернули одно поле
profile.reset()                // вернули всё
profile.name = 'Ann'
profile.isTouched()            // false: сравнение по значению, а не «писали ли мы в поле»
```

```ts [Нативно]
import isEqual from 'lodash/isEqual'

type Profile = { name: string, bio: string }

function createForm (saved: Profile) {
  const baseline = structuredClone(saved)
  const current = structuredClone(saved)
  return {
    current,
    isTouched: () => !isEqual(current, baseline),
    changes: () => {
      const result: Record<string, { from: unknown, to: unknown }> = {}
      for (const key of Object.keys(baseline) as Array<keyof Profile>) {
        if (!isEqual(current[key], baseline[key])) result[key] = { from: baseline[key], to: current[key] }
      }
      return result
    },
    revert: (key: keyof Profile) => { current[key] = baseline[key] },
    reset: () => Object.assign(current, structuredClone(baseline)),
  }
}

// Реактивность в UI (Vue: reactive + computed, React: useState + useMemo) добавляется отдельно;
// вложенные объекты в baseline и current нужно клонировать глубоко, иначе они разделяют ссылки.
```

:::

## 4. Undo / redo

::: code-group

```ts [ActiveModel]
const doc = Doc.create({ title: 'A' }, { history: { limit: 50 } })
doc.title = 'B'
doc.title = 'C'
doc.undo()                     // 'B'
doc.undo()                     // 'A'
doc.redo()                     // 'B'
doc.canUndo()                  // true
doc.transaction((d) => { d.title = 'X'; d.body = 'Y' })
doc.undo()                     // одна запись отменяет всю транзакцию
```

```ts [Нативно]
type Snapshot = { title: string, body: string }

class DocHistory {
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  constructor (private state: Snapshot, private limit = 50) {}

  set<K extends keyof Snapshot> (key: K, value: Snapshot[K]) {
    if (this.state[key] === value) return
    this.push()
    this.state = { ...this.state, [key]: value }
    this.redoStack = []
  }

  batch (change: (state: Snapshot) => Snapshot) {
    this.push()
    this.state = change({ ...this.state })
    this.redoStack = []
  }

  undo () {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.state)
    this.state = previous
  }

  redo () {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.state)
    this.state = next
  }

  private push () {
    this.undoStack.push(this.state)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
  }
}
// Прямая запись в state в обход set() минует историю; вложенные структуры требуют глубокого копирования.
```

:::

## 5. Транзакция с инвариантом

Требование: поездка меняет обе даты; конец не раньше начала; при нарушении ничего не остаётся изменённым.

::: code-group

```ts [ActiveModel]
class Trip extends ActiveModel {
  @ActiveField({ coerce: 'date' }) start?: Date
  @ActiveField({ coerce: 'date' }) end?: Date

  @InvariantMethod('end must not be before start')
  static endAfterStart (trip: Trip) {
    return !trip.start || !trip.end || trip.end >= trip.start
  }
}

const trip = Trip.create({ start: '2026-01-01', end: '2026-01-05' })
trip.transaction((t) => {
  t.start = '2026-03-01'       // между записями инвариант не проверяется
  t.end = '2026-03-10'
})                             // проверен на выходе; при нарушении откат обоих полей
```

```ts [Нативно]
type Trip = { start: Date, end: Date }

function updateTrip (trip: Trip, change: (draft: Trip) => void): Trip {
  const draft: Trip = { start: new Date(trip.start), end: new Date(trip.end) }   // глубокая копия
  change(draft)
  if (draft.end < draft.start) throw new RangeError('end must not be before start')
  return draft                                       // вызывающий обязан подменить ссылку
}

let trip: Trip = { start: new Date('2026-01-01'), end: new Date('2026-01-05') }
trip = updateTrip(trip, (d) => {
  d.start = new Date('2026-03-01')
  d.end = new Date('2026-03-10')
})
// Копия делается руками, асинхронный код внутри change() нужно обрабатывать отдельно,
// а прямая запись trip.end = ... по-прежнему обходит проверку.
```

:::

## 6. Отсортированный список одной модели

::: code-group

```ts [ActiveModel]
const tasks = Task.collection([{ id: 3 }, { id: 1 }], { sortBy: 'id', unique: 'id' })
tasks.push({ id: 2 })          // [1, 2, 3], вставка на своё место
tasks.push({ id: 2 })          // ValidationError (unique)
tasks[0].id = 10               // элемент переехал: [2, 3, 10]
tasks.findByKey(3)             // бинарный поиск
tasks.range(2, 5)              // [2, 3]
tasks.push(42 as never)        // TypeError: принимает только Task
```

```ts [Нативно]
type Task = { id: number, title: string }

class SortedTasks {
  private items: Task[] = []

  add (task: Task) {
    if (typeof task?.id !== 'number') throw new TypeError('not a Task')
    let lo = 0
    let hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.items[mid].id < task.id) lo = mid + 1
      else hi = mid
    }
    if (this.items[lo]?.id === task.id) throw new Error(`duplicate id ${task.id}`)
    this.items.splice(lo, 0, task)
  }

  find (id: number) {
    const i = this.lowerBound(id)
    return this.items[i]?.id === id ? this.items[i] : undefined
  }

  range (min: number, max: number) {
    return this.items.slice(this.lowerBound(min), this.lowerBound(max + Number.EPSILON))
  }

  private lowerBound (id: number) {
    let lo = 0
    let hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.items[mid].id < id) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
// Изменение task.id снаружи ломает порядок, а массив приходится не отдавать наружу вовсе
// (или замораживать), теряя push/map/filter. Проверка типа в рантайме - на совести add().
```

:::

## 7. Допустимые переходы состояний

::: code-group

```ts [ActiveModel]
class Order extends ActiveModel {
  @ActiveField({ transitions: { new: ['paid', 'cancelled'], paid: ['shipped'], shipped: [], cancelled: [] } })
  status: string = 'new'
}

const order = Order.create({})
order.status = 'paid'
order.status = 'new'           // ValidationError: переход paid -> new запрещён
order.canTransition('status', 'shipped')   // true
```

```ts [Нативно]
const transitions: Record<string, string[]> = {
  new: ['paid', 'cancelled'],
  paid: ['shipped'],
  shipped: [],
  cancelled: [],
}

const order = { status: 'new' }

function moveTo (next: string) {
  if (next === order.status) return
  if (!transitions[order.status]?.includes(next)) {
    throw new Error(`Transition ${order.status} -> ${next} is not allowed`)
  }
  order.status = next
}
// order.status = 'new' в обход moveTo() пройдёт молча; чтобы запретить, нужен Proxy или геттер/сеттер на каждое поле.
```

:::

## 8. События изменения полей

::: code-group

```ts [ActiveModel]
import { EventType } from '@alt-point/active-models'

User.on(EventType.afterSetValue, ({ prop, value, oldValue }) => audit(prop, oldValue, value))   // все инстансы класса
const user = User.create({ name: 'Ann' })
user.on(EventType.touched, () => saveButton.enable())                                          // один инстанс
user.name = 'Bob'              // оба слушателя сработали; ошибка одного не мешает остальным
```

```ts [Нативно]
type Listener<T> = (change: { prop: keyof T, value: unknown, oldValue: unknown }) => void

function observable<T extends object> (target: T, classListeners: Listener<T>[] = []) {
  const own: Listener<T>[] = []
  const proxy = new Proxy(target, {
    set (obj, prop, value, receiver) {
      const oldValue = Reflect.get(obj, prop, receiver)
      const ok = Reflect.set(obj, prop, value, receiver)
      if (ok && oldValue !== value) {
        const errors: unknown[] = []
        for (const listener of [...classListeners, ...own]) {
          try { listener({ prop: prop as keyof T, value, oldValue }) } catch (error) { errors.push(error) }
        }
        if (errors.length) throw errors[0]
      }
      return ok
    },
  })
  return { proxy, on: (listener: Listener<T>) => { own.push(listener); return () => own.splice(own.indexOf(listener), 1) } }
}
// Общие слушатели класса, наследование подписок, «всплытие» изменений из вложенных объектов и коллекций
// придётся добавлять самим; вложенные объекты нужно оборачивать в Proxy рекурсивно.
```

:::
