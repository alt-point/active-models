# Миграция с 3.x на 4.0

Версия 4.0 закрывает публичные поверхности, которые давали обойти инварианты модели, и исправляет ряд
ошибок. Ломающих изменений четыре.

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

## Что изменилось в поведении (не ломающее)

| Что | Было | Стало |
|---|---|---|
| Подписки на родительском классе | не срабатывали для подклассов | срабатывают |
| Payload `created` / `touched` | нет | `{ target }` |
| `touched` во время `create()` | эмитился при начальном заполнении | не эмитится |
| Исключение в слушателе | обрывало остальных слушателей | все слушатели вызываются, потом бросается первая ошибка |
| `toJSON()` для `Date`/`Set`/`Map` | `{}` | ISO-строка / массив / объект |
| `clone()` | обычный объект без `Proxy`, терял `hidden` | полноценная модель, `hidden` сохранены, baseline перенесён |
| `makeFreeze()` | путаная ошибка про `Symbol(@touched)` | понятный `TypeError` |
| `'hidden' in model` | `true` | `false` |
| `createFromCollection` | тип `ActiveModel[]` | `InstanceType<T>[]` |
| `CallableModel` | `extends Function` (нужен `unsafe-eval` под CSP) | обычная функция, CSP-безопасно |
| Сборка ESM | `AsyncLocalStorage` тихо отключался | не используется вовсе |
