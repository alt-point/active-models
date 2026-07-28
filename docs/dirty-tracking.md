# Отслеживание изменений: `isTouched()` и `startTracking()`

## Проблема

Форма редактирования профиля должна активировать кнопку "Сохранить" только когда пользователь реально
что-то изменил, а не при любом ре-рендере компонента. Мастер из нескольких шагов должен предупреждать о
несохранённых данных при уходе со страницы. Список объектов, полученных с бэкенда, нужно отправить обратно
только теми элементами, которые действительно поменялись. Всё это — один и тот же вопрос: "отличается ли
текущее состояние объекта от того, с которым он был создан?"

Решать его сравнением полей вручную (`if (form.name !== initialName || form.email !== initialEmail...)`)
не масштабируется — при каждом новом поле нужно не забыть добавить его в сравнение. `ActiveModel` решает
эту задачу на уровне модели: `isTouched()` и `startTracking()`.

## Базовое использование

Снэпшот "исходного состояния" сохраняется в момент создания модели, если передать `tracked: true`:

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

class UserForm extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField() email: string = ''
}

const form = UserForm.create({ name: 'Alice', email: 'alice@example.com' }, { tracked: true })

form.isTouched() // false — состояние совпадает со снэпшотом

form.name = 'Alice Cooper'
form.isTouched() // true
```

Если модель уже создана без `tracked: true` (например, `new UserForm(data)`, где опции `create()`
недоступны), снэпшот можно установить в любой момент вручную через `startTracking()` — это тот же самый
механизм, просто вызванный не из фабрики, а из кода приложения:

```ts
const form = new UserForm({ name: 'Alice', email: 'alice@example.com' })
form.startTracking() // фиксирует текущее состояние как точку отсчёта

form.email = 'alice@work.com'
form.isTouched() // true
```

`startTracking()` полезен и для повторного использования модели: после успешного сохранения формы
вызовите его снова, чтобы обнулить "грязное" состояние без пересоздания модели.

```ts
async function save (form: UserForm) {
  await api.updateUser(form.toJSON())
  form.startTracking() // текущее (только что сохранённое) состояние становится новой точкой отсчёта
}
```

## Три состояния, а не два

`isTouched()` возвращает `boolean | undefined` — это не случайность и не недосмотр:

| Значение | Когда | Что значит |
|---|---|---|
| `undefined` | снэпшот никогда не сохранялся | вопрос "изменилось ли" не имеет смысла — не с чем сравнивать |
| `false` | снэпшот есть, текущее состояние с ним совпадает | не изменено |
| `true` | снэпшот есть, текущее состояние отличается | изменено |

Если явно рассчитывать на `boolean`, `undefined` может тихо пройти фальшивый `if (!form.isTouched())` как
`true`-путь ("не изменено") — а это может быть моделью, для которой отслеживание вообще не включалось.
Проверяйте явно:

```ts
if (form.isTouched() === false) {
  // точно не изменено
}
if (form.isTouched() === undefined) {
  // отслеживание не было включено для этой модели
}
```

## Что именно сравнивается

Снэпшот — глубокая копия всего инстанса модели на момент `startTracking()`/`create(..., { tracked: true })`,
сравнение — глубокое структурное равенство (`fast-deep-equal`) с текущим состоянием. Из этого следуют два
практических вывода, оба проверены на реальном поведении библиотеки:

**Изменения во вложенных `factory`-моделях распространяются наверх.** Если поле создано через
`factory`, снэпшот включает и его — трекать вложенную модель отдельно не нужно:

```ts
class Address extends ActiveModel {
  @ActiveField() city: string = ''
}
class User extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField({ factory: Address }) address?: Address
}

const user = User.create({ name: 'Alice', address: { city: 'Berlin' } }, { tracked: true })
user.address!.city = 'Munich'
user.isTouched() // true — хотя менялось поле вложенной модели, а не самого user
```

**Поля с `hidden: true` не попадают в сравнение.** `ownKeys` (задействуется при построении снэпшота)
фильтрует скрытые поля точно так же, как при `Object.keys()`/`JSON.stringify()` — значит их изменение
`isTouched()` не увидит:

```ts
class Session extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField({ hidden: true }) csrfToken: string = ''
}

const session = Session.create({ name: 'x' }, { tracked: true })
session.csrfToken = 'new-token'
session.isTouched() // false — csrfToken скрыт от снэпшота
```

Если поле обязано участвовать в отслеживании изменений, не делайте его `hidden` — используйте `hidden`
только для данных, которые действительно не должны ни сериализоваться, ни сравниваться (см.
[справочник опций `@ActiveField()`](/active-field-options#hidden)).

## `isTouched()` — это не событие `touched`

В библиотеке есть два независимых механизма с похожими именами, и путать их легко:

- **Событие `touched`** (`model.emitter.on(EventType.touched, cb)`) — срабатывает **сразу**, при любом
  реальном изменении любого активного поля, независимо от того, включено ли отслеживание. Это push-модель:
  вы узнаёте о каждом изменении в момент, когда оно произошло.
- **`isTouched()`** — pull-модель: отвечает на вопрос "отличается ли *текущее* состояние от снэпшота" в
  любой момент, когда вы его зададите. Ничего не делает, пока вы явно не вызовете метод.

Событие `touched` не требует `tracked: true` и не связано со снэпшотом — оно срабатывает, даже если
`isTouched()` вернёт `undefined`. Подробнее про событие: [Жизненный цикл модели](/model-lifecycle#touched-внутреннее-без-payload).

Событие `touched` — подходящий сигнал, чтобы узнать, что *что-то* изменилось прямо сейчас (например,
чтобы дёрнуть UI на реактивный пересчёт); `isTouched()` — способ получить однозначный ответ в конкретной
точке (например, перед сабмитом формы или при закрытии вкладки).

## Использование во Vue

Composition API: `isTouched()` — обычный метод, не реактивный сам по себе, поэтому реактивность нужно
собрать вручную через `ref` и событие `touched` как триггер пересчёта:

```ts
// useDirty.ts
import { ref, onUnmounted } from 'vue'
import type { ActiveModel } from '@alt-point/active-models'
import { EventType } from '@alt-point/active-models'

export function useDirty (model: ActiveModel) {
  const dirty = ref(model.isTouched() ?? false)

  const unsubscribe = model.emitter.on(EventType.touched, () => {
    dirty.value = model.isTouched() ?? false
  })

  onUnmounted(unsubscribe)

  return dirty
}
```

```vue
<script setup lang="ts">
import { UserForm } from './models/UserForm'
import { useDirty } from './useDirty'

const props = defineProps<{ initial: { name: string, email: string } }>()
const form = UserForm.create(props.initial, { tracked: true })
const isDirty = useDirty(form)

async function onSave () {
  await save(form)
  form.startTracking() // сброс "грязного" состояния после сохранения
}
</script>

<template>
  <input v-model="form.name" />
  <input v-model="form.email" />
  <button :disabled="!isDirty" @click="onSave">Сохранить</button>
</template>
```

`model.emitter.on(...)` возвращает функцию отписки — передавать её напрямую в `onUnmounted` безопасно,
утечек подписчиков при размонтировании компонента не будет.

## Использование в React

Тот же принцип, но идиоматичный для React инструмент — `useSyncExternalStore`: он спроектирован именно
для подписки на внешние изменяемые источники состояния (коим модель `ActiveModel` и является), без
рассинхронизации между рендерами и без ручного `useEffect` + `useState`:

```tsx
// useDirty.ts
import { useCallback, useSyncExternalStore } from 'react'
import type { ActiveModel } from '@alt-point/active-models'
import { EventType } from '@alt-point/active-models'

export function useDirty (model: ActiveModel) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => model.emitter.on(EventType.touched, onStoreChange),
    [model]
  )
  const getSnapshot = useCallback(() => model.isTouched() ?? false, [model])

  return useSyncExternalStore(subscribe, getSnapshot)
}
```

```tsx
function UserFormView ({ form }: { form: UserForm }) {
  const isDirty = useDirty(form)

  async function onSave () {
    await save(form)
    form.startTracking()
  }

  return (
    <>
      <input value={form.name} onChange={(e) => { form.name = e.target.value }} />
      <button disabled={!isDirty} onClick={onSave}>Сохранить</button>
    </>
  )
}
```

Поскольку `ActiveModel` не хранит своё состояние в React state, прямое присваивание (`form.name = ...`)
не запускает ре-рендер само по себе — событие `touched` (через `useDirty`) и есть тот триггер, который об
этом сообщает.

## Сравнение с другими подходами

| Подход | Где живёт состояние | Гранулярность | Стоимость подключения |
|---|---|---|---|
| **`ActiveModel.isTouched()`** | в самой модели | весь инстанс целиком (deep-equal) | встроено, `tracked: true` или `startTracking()` |
| `react-hook-form` `formState.isDirty` | внутри формы, привязано к `register()`/`Controller` | по полю и агрегированно | требует построить форму через саму библиотеку |
| Formik `dirty` | `values` vs `initialValues` внутри Formik-стейта | весь стейт формы (deep-equal) | требует Formik-обёртку над всеми полями |
| VeeValidate / Vuelidate | стейт валидатора | по полю | требует описать схему валидации/полей отдельно |
| MobX (`observable` + ручной снэпшот) | в сторе, но снэпшот и сравнение — ваш код | зависит от реализации | нет встроенного `isDirty`, пишется вручную |
| Redux Toolkit / Immer | предыдущий и следующий immutable-стейт | shallow-equal по ссылкам (дёшево из-за structural sharing) | сравнение снэпшотов — тоже ваш код |

Главное отличие `ActiveModel`: отслеживание "грязности" — не надстройка над формой или стором, а
встроенное свойство самой модели данных. Один и тот же `UserForm` с одним и тем же `isTouched()` работает
одинаково во Vue, React, Node-скрипте или тестах — без обвязки конкретного UI-фреймворка. Плата за это —
сравнение идёт по всей модели целиком, а не по отдельному полю; если нужно узнать *какое именно* поле
изменилось, комбинируйте с событиями `afterSetValue`/`touched` (см.
[Жизненный цикл модели](/model-lifecycle)), а не полагайтесь на один `isTouched()`.
