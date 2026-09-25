# Отслеживание изменений: `isTouched()`

## Проблема

Форма редактирования профиля должна активировать кнопку "Сохранить" только когда пользователь реально
что-то изменил, а не при любом ре-рендере компонента. Мастер из нескольких шагов должен предупреждать о
несохранённых данных при уходе со страницы. Список объектов, полученных с бэкенда, нужно отправить обратно
только теми элементами, которые действительно поменялись. Всё это — один и тот же вопрос: "отличается ли
текущее состояние объекта от того, с которым он был создан?"

Решать его сравнением полей вручную (`if (form.name !== initialName || form.email !== initialEmail...)`)
не масштабируется — при каждом новом поле нужно не забыть добавить его в сравнение. `ActiveModel` решает
эту задачу на уровне модели: методом `isTouched()`.

## Базовое использование

Снэпшот "исходного состояния" сохраняется в момент создания модели, если передать `tracked: true`.
Это единственная точка входа — снэпшот нельзя установить или сбросить постфактум, только при создании:

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

Модель, созданная через `new UserForm(data)` (а не `UserForm.create(...)`), никогда не будет отслеживаемой
— у конструктора нет параметра для опций, а публичного метода, чтобы включить отслеживание постфактум, у
`ActiveModel` нет: `isTouched()` для такой модели всегда вернёт `undefined`. Если нужен dirty-tracking,
создавайте модель через `create(data, { tracked: true })`.

Чтобы сбросить "грязное" состояние после успешного сохранения (например, форма отправлена, и дальше
изменения должны отслеживаться заново от только что сохранённых данных), пересоздайте модель — новый
снэпшот фиксируется автоматически при каждом `create(..., { tracked: true })`:

```ts
async function save (form: UserForm) {
  const saved = await api.updateUser(form.toJSON())
  return UserForm.create(saved, { tracked: true }) // новый снэпшот — новая точка отсчёта
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

Снэпшот — глубокая копия всего инстанса модели на момент `create(..., { tracked: true })`, сравнение —
глубокое структурное равенство (`fast-deep-equal`) с текущим состоянием. Из этого следуют два практических
вывода, оба проверены на реальном поведении библиотеки:

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

`clone()` переносит baseline на копию: `isTouched()` клона сначала `false`, а дальше он отслеживается
независимо от оригинала.

## `isTouched()` — это не событие `touched`

В библиотеке есть два независимых механизма с похожими именами, и путать их легко:

- **Событие `touched`** (`model.on(EventType.touched, cb)`) — срабатывает **сразу**, при любом
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
собрать вручную через `ref` и событие `touched` как триггер пересчёта. Раз сброс "грязного" состояния
означает пересоздание модели (см. выше), а не мутацию существующей, `form` тоже должен быть реактивной
ссылкой — composable подписывается заново при каждой подмене модели через `watch(..., { immediate: true })`,
отписываясь от предыдущей через `onCleanup`. Важно использовать именно `shallowRef`, а не `ref`: `ref()`
рекурсивно оборачивает объект в собственный реактивный `Proxy` от Vue, а `ActiveModel` уже сам является
`Proxy` — вложенная обёртка ломает идентичность объекта, на которой держится вся внутренняя логика
библиотеки (сравнения `Object.is`, ключи `WeakMap`). `shallowRef` реактивен только к замене `.value`
целиком и не трогает то, что внутри:

```ts
// useDirty.ts
import { watch, ref, type ShallowRef } from 'vue'
import type { ActiveModel } from '@alt-point/active-models'
import { EventType } from '@alt-point/active-models'

export function useDirty (model: ShallowRef<ActiveModel>) {
  const dirty = ref(model.value.isTouched() ?? false)

  watch(model, (current, _previous, onCleanup) => {
    dirty.value = current.isTouched() ?? false
    const unsubscribe = current.on(EventType.touched, () => {
      dirty.value = current.isTouched() ?? false
    })
    onCleanup(unsubscribe) // отписка от старой модели при следующей подмене и при размонтировании
  }, { immediate: true })

  return dirty
}
```

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { UserForm } from './models/UserForm'
import { useDirty } from './useDirty'

const props = defineProps<{ initial: { name: string, email: string } }>()
const form = shallowRef(UserForm.create(props.initial, { tracked: true }))
const isDirty = useDirty(form)

async function onSave () {
  const saved = await save(form.value)
  form.value = UserForm.create(saved, { tracked: true }) // новая модель — новый снэпшот
}
</script>

<template>
  <input v-model="form.name" />
  <input v-model="form.email" />
  <button :disabled="!isDirty" @click="onSave">Сохранить</button>
</template>
```

`form` в `<template>` работает как обычно, несмотря на то, что в `<script setup>` это `shallowRef` — Vue
точно так же автоматически разворачивает верхнеуровневые `ref`/`shallowRef` в шаблоне.

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
    (onStoreChange: () => void) => model.on(EventType.touched, onStoreChange),
    [model]
  )
  const getSnapshot = useCallback(() => model.isTouched() ?? false, [model])

  return useSyncExternalStore(subscribe, getSnapshot)
}
```

```tsx
import { useState } from 'react'

function UserFormView ({ initial }: { initial: { name: string, email: string } }) {
  const [form, setForm] = useState(() => UserForm.create(initial, { tracked: true }))
  const isDirty = useDirty(form)

  async function onSave () {
    const saved = await save(form)
    setForm(UserForm.create(saved, { tracked: true })) // новая модель — новый снэпшот
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
этом сообщает. `useDirty` пересоздаёт `subscribe`/`getSnapshot` при каждой смене `form` (за счёт
`useCallback([model])`), так что подмена модели через `setForm(...)` после сохранения автоматически
переподписывает хук на новый инстанс — без этого специально заботиться не нужно.

## Сравнение с другими подходами

| Подход | Где живёт состояние | Гранулярность | Стоимость подключения |
|---|---|---|---|
| **`ActiveModel.isTouched()`** | в самой модели | весь инстанс целиком (deep-equal) | встроено, `create(data, { tracked: true })` |
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
