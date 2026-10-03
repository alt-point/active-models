# Миграция с 3.x на 4.0

Версия 4.0 закрывает публичные поверхности, которые давали обойти инварианты модели, и исправляет ряд
ошибок. Ломающих изменений пять.

## 1. `model.emitter` удалён → `on` / `once`

```ts
// было
model.emitter.on(EventType.afterSetValue, cb)
model.emitter.once(EventType.afterSetValue, cb)

// стало
model.on(EventType.afterSetValue, cb)      // на инстансе
model.once(EventType.afterSetValue, cb)
Model.on(EventType.afterSetValue, cb)      // НОВОЕ: на классе, для всех инстансов (и подклассов)
```

`emit()` наружу больше не доступен — подделать событие жизненного цикла нельзя. `on`/`once` по-прежнему
возвращают функцию отписки.

## 2. `startTracking()` удалён

Снимок для `isTouched()` теперь создаётся только при создании: `Model.create(data, { tracked: true })`.
Сбросить baseline после сохранения — значит пересоздать модель:

```ts
// было
await api.save(form.toJSON())
form.startTracking()

// стало
form = Form.create(await api.save(form.toJSON()), { tracked: true })
```

Модель, созданная через `new Model(data)`, отслеживаться не может (`isTouched()` вернёт `undefined`).

## 3. `create()` бросает `TypeError` для массива

Раньше `Model.create([...])` тихо возвращал пустую модель. Теперь — `TypeError` с подсказкой; для списков
используйте `Model.createFromCollection([...])`.

## 4. `createFromCollection` пропускает только `null` / `undefined`

Раньше выбрасывались любые falsy-значения (`0`, `''`, `false`). Теперь — только `null`/`undefined`.

## 5. Корневого импорта нет: свой подпуть на каждую возможность

`import { ... } from '@alt-point/active-models'` больше не разрешается. Импортируйте каждую возможность из её подпути;
полный список — в разделе [Импорты и tree-shaking](/imports).

```ts
// было
import { ActiveModel, ActiveField, EventType, ValidationError } from '@alt-point/active-models'

// стало
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'
import { ValidationError } from '@alt-point/active-models/pipeline'
```

| Что экспортировалось из корня | Подпуть |
|---|---|
| `ActiveModel` | `/ActiveModel` |
| `ActiveField`, `ActiveFactory`, `GetterMethod`, `SetterMethod`, `InvariantMethod` | `/decorators` |
| `EventType` и все типы опций и событий | `/types` |
| `ValidationError`, `FieldRules`, ... | `/pipeline` |
| `CallableModel` | `/CallableModel` |
| `Enum` | `/Enum` |
| `ModelProperties`, `RecursivePartialActiveModel` | `/utils` |

Подпути `/ActiveModel`, `/CallableModel` и `/decorators` существовали и в 3.x. В бандл попадает только то, что вы
импортируете; зависимостей в рантайме больше нет (`lodash-es` удалён).

## Что изменилось в поведении (не ломающее)

| Что | Было | Стало |
|---|---|---|
| Подписки на родительском классе | не срабатывали для подклассов | срабатывают |
| Payload `created` / `touched` | нет | `{ target }` |
| `touched` во время `create()` | эмитился при начальном заполнении | не эмитится |
| `touched` и отклонённая запись | эмитился до проверок | эмитится после успешной записи; из вложенных моделей всплывает |
| Дефолт `value: []` / `{}` | один объект на все инстансы | копия на каждый инстанс |
| `once` в `@ActiveField` | мог не сработать, если первое событие пришлось на другое поле | срабатывает на первом событии своего поля |
| `@ActiveFactory(undefined)` | молча ничего не делал | `ReferenceError` при определении класса |
| Исключение в слушателе | обрывало остальных слушателей | все слушатели вызываются, потом бросается первая ошибка |
| `toJSON()` для `Date`/`Set`/`Map` | `{}` | ISO-строка / массив / объект |
| `clone()` | обычный объект без `Proxy`, терял `hidden` | полноценная модель, `hidden` сохранены, baseline перенесён |
| `makeFreeze()` | путаная ошибка про `Symbol(@touched)` | понятный `TypeError` |
| `'hidden' in model` | `true` | `false` |
| `createFromCollection` | тип `ActiveModel[]` | `InstanceType<T>[]` |
| `CallableModel` | `extends Function` (нужен `unsafe-eval` под CSP) | обычная функция, CSP-безопасно |
| Сборка ESM | `AsyncLocalStorage` тихо отключался | не используется вовсе |
