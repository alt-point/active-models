# Валидация, нормализация и правила состояния

Всё, через что проходит значение при записи в поле, в таком порядке:

```
transform (trim / lowercase / uppercase / свои) → coerce → значение то же? стоп → transitions → rules → validator → события
```

Отклонённая запись бросает `ValidationError`; `validate()` прогоняет те же правила по **текущему** состоянию и
сообщает о **всех** проблемах сразу, а не только о первой.

## Нормализаторы

```ts
class User extends ActiveModel {
  @ActiveField({ trim: true, lowercase: true }) email: string = ''
  @ActiveField({ uppercase: true }) country: string = ''
  @ActiveField({ transform: [(v) => String(v).replace(/\s+/g, ' '), (v) => v.slice(0, 50)] }) bio: string = ''
}

user.email = '  Ann@Example.COM '   // сохранится "ann@example.com"
```

`transform` принимает функцию (или массив) `(value, { model, prop }) => newValue`; встроенные сокращения выполняются
первыми. Не-строки проходят через `trim`/`lowercase`/`uppercase` без изменений. События и `touched` видят
**нормализованное** значение, а запись, которая после нормализации равна текущему значению, — no-op (ничего не эмитится).

## Приведение типов

```ts
@ActiveField({ coerce: 'number' })  price: number = 0      // '12.5' → 12.5
@ActiveField({ coerce: 'integer' }) qty: number = 0        // '4' → 4, '2.5' отклоняется
@ActiveField({ coerce: 'boolean' }) active: boolean = false // 'true' / '1' / 1 → true, 'false' / '0' / 0 → false
@ActiveField({ coerce: 'date' })    when?: Date            // ISO-строка или timestamp → Date
@ActiveField({ coerce: 'string' })  label?: string         // 42 → '42', Date → ISO-строка
```

`null`/`undefined` проходят как есть. Значение, которое не удаётся привести, отклоняется с кодом `coerce`.

## Декларативные правила

| Опция | Проверяет |
|---|---|
| `required` | не `null`, не `undefined`, не `''` |
| `type` | `'string' \| 'number' \| 'integer' \| 'boolean' \| 'date' \| 'array' \| 'object'` (`coerce` подразумевает тип) |
| `min`, `max` | число или `Date` |
| `minLength`, `maxLength` | символы строки / элементы массива |
| `pattern` | строка подходит под `RegExp` (флаг `/g` не мешает) |
| `oneOf` | одно из значений массива или значение TypeScript-`enum` (строкового или числового) |

Необязательное поле со значением `null`/`undefined` не проверяется; на отсутствие реагирует только `required`.

```ts
class Person extends ActiveModel {
  @ActiveField({ required: true, minLength: 2 }) name?: string
  @ActiveField({ min: 0, max: 150 }) age?: number
  @ActiveField({ oneOf: Role }) role?: Role
}
```

## `validate()` и `assertValid()`

Проверки при записи не видят поле, которое **так и не было задано** (записи же не было). `validate()` видит:

```ts
const { valid, issues } = order.validate()
// issues: [
//   { path: 'id', code: 'required', message: '"id" is required' },
//   { path: 'address.city', code: 'required', ... },
//   { path: 'history[1].city', code: 'required', ... },
// ]

order.assertValid()                                   // бросает ValidationError, в .issues — все проблемы
Order.create(data, { validate: true })                // бросает вместо возврата невалидной модели; `created` не эмитится
```

Рекурсивно обходит вложенные модели, коллекции и массивы моделей (пути вида `history[1].city`), переживает циклические
ссылки и запускает `validator` только для заданных значений (как и при записи). Коды: `required`, `type`, `coerce`,
`min`, `max`, `minLength`, `maxLength`, `pattern`, `oneOf`, `transition`, `validator`.

## Переходы состояний

```ts
class Order extends ActiveModel {
  @ActiveField({ transitions: { new: ['paid', 'cancelled'], paid: ['shipped'], shipped: [] } })
  status?: 'new' | 'paid' | 'shipped' | 'cancelled'
}

const order = Order.create({ status: 'new' })
order.status = 'paid'        // ок
order.status = 'new'         // ValidationError: "status" cannot change from "paid" to "new"

order.canTransition('status', 'shipped')   // true
order.allowedTransitions('status')         // ['shipped']
```

Состояние без записи — конечное. **Первое** значение (из `undefined`/`null`) и создание из сохранённых данных не
ограничены: заказ, загруженный как `shipped`, допустим; проверяются только последующие изменения. Запись того же
состояния — no-op.

## Строгие модели

```ts
class Strict extends ActiveModel {
  static strict = true
  @ActiveField() name: string = ''
}

strict.name = 'x'   // ок
strict.nmae = 'x'   // TypeError: Unknown property "nmae" on Strict: declare it with @ActiveField() (strict model)
```

Символы и уже существующие свойства (недекорированные поля класса, методы) разрешены. Создавайте строгие модели через
`create()`: `new Model(data)` пропускает через ту же проверку инициализаторы недекларированных полей класса.

## `ValidationError`

```ts
try { user.age = -1 } catch (e) {
  if (e instanceof ValidationError) e.issues   // [{ path: 'age', code: 'min', message: '"age" must be at least 0', value: -1 }]
}
```

## Что важно знать

- **Отклонённая первая запись не блокирует `readonly`-поле** — отметка «записано один раз» ставится только после всех проверок.
- `validator` остаётся для всего, что декларативными правилами не выразить; сначала используйте правила — они же питают `validate()`.
- Правила и нормализаторы **обходятся** при возврате значений (откат, undo, revert): эти значения были валидны, когда их взяли.
