# Миграция с 4.x на 5.0

Версия 5.0 делит пакет на точки входа по возможностям и делает типизированные контейнеры подключаемыми явно, поэтому
в бандл попадает только импортированное. Ломающих изменений четыре.

## 1. Корневого импорта нет: свой подпуть на каждую возможность

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
| `ActiveCollection`, `ActiveMap`, `ActiveSet` | `/ActiveCollection`, `/ActiveMap`, `/ActiveSet` |
| `isCollection` | `/collectionRegistry` |
| `Decimal`, `Money`, `LocalDate`, `markImmutable` | `/scalars/Decimal`, `/scalars/Money`, `/scalars/LocalDate`, `/scalars/immutable` |
| `CallableModel`, `Enum` | `/CallableModel`, `/Enum` |
| `ModelProperties`, `RecursivePartialActiveModel` | `/utils` |

Подпути `/ActiveModel`, `/CallableModel` и `/decorators` существовали и в 4.x.

## 2. Опции `collection` / `map` / `set` → `container`

`ActiveModel` и `@ActiveField` больше не импортируют классы контейнеров. Поле называет свой контейнер через его
собственный `.field()`:

```ts
// было
@ActiveField({ collection: [Task, { sortBy: 'id' }] }) tasks!: ActiveCollection<Task>
@ActiveField({ map: [User, { key: 'id' }] }) users!: ActiveMap<User>
@ActiveField({ set: [Tag, { unique: 'name' }] }) tags!: ActiveSet<Tag>

// стало
@ActiveField({ container: ActiveCollection.field(Task, { sortBy: 'id' }) }) tasks!: ActiveCollection<Task>
@ActiveField({ container: ActiveMap.field(User, { key: 'id' }) }) users!: ActiveMap<User>
@ActiveField({ container: ActiveSet.field(Tag, { unique: 'name' }) }) tags!: ActiveSet<Tag>
```

`collection: Task` (голая модель) становится `ActiveCollection.field(Task)`. Поведение прежнее; совмещение опции с
`factory` теперь даёт ошибку `use either factory or container, not both`.

## 3. `Model.collection()` / `Model.createCollection()` удалены

```ts
// было
const tasks = Task.collection(items, { sortBy: 'id' })
const loaded = Task.createCollection(apiRows, { sortBy: 'id', tracked: true })

// стало
const tasks = ActiveCollection.create(Task, items, { sortBy: 'id' })
const loaded = ActiveCollection.createFromData(Task, apiRows, { sortBy: 'id', tracked: true })
```

## 4. Зависимостей в рантайме нет

`lodash-es` удалён; клонирование — собственное. В вашем коде менять нечего. Если вы полагались на то, что lodash стоит
транзитивно, добавьте его в свой `package.json`.

## Что не затронуто

Модели, события, валидация, отслеживание изменений, история, скаляры и всё, что описано в руководстве по 4.0, работает как прежде.
