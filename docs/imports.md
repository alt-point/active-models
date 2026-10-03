# Импорты и tree-shaking

Корневого импорта нет (с 5.0; [миграция](/migration-5)): `import { ... } from '@alt-point/active-models'` не разрешается. Каждая возможность — отдельная
точка входа (подпуть), поэтому в бандл попадает только то, что вы импортируете. Зависимостей в рантайме нет.

## Подпути

| Подпуть | Экспорты |
|---|---|
| `/ActiveModel` | `ActiveModel`, тип `InvariantCheck` |
| `/decorators` | `ActiveField`, `ActiveFactory`, `GetterMethod`, `SetterMethod`, `InvariantMethod`, `isHidden`, `isFillable`, `isProtected` |
| `/types` | `EventType` и типы опций и событий: `FactoryOptions`, `CollectionOptions`, `MapOptions`, `SetOptions`, `ActiveFieldDescriptor`, `EventListener`, `EventPayloads`, ... |
| `/pipeline` | `ValidationError`; типы `ValidationIssue`, `ValidationResult`, `ValidationCode`, `FieldRules`, `Transform`, `Transitions`, `CoerceTo`, `ValueType`, `Coercible`, `Bound` |
| `/ActiveCollection` | `ActiveCollection`, тип `CollectionInput` |
| `/ActiveMap` | `ActiveMap` |
| `/ActiveSet` | `ActiveSet` |
| `/collectionRegistry` | `isCollection` |
| `/scalars/Decimal` | `Decimal`, типы `DecimalInput`, `RoundingMode` |
| `/scalars/Money` | `Money`, `minorUnits` |
| `/scalars/LocalDate` | `LocalDate` |
| `/scalars/immutable` | `markImmutable` |
| `/CallableModel` | `CallableModel` |
| `/Enum` | `Enum` (устарел) |
| `/utils` | типы `ModelProperties`, `RecursivePartialActiveModel` |

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'
import { Money } from '@alt-point/active-models/scalars/Money'
```

Всё, чего нет в таблице (`meta`, `emitter`, `history`, `equal`, `clone`, ...), — внутренности; импортировать их нельзя.

## Что попадает в бандл

Размер одного импорта после минификации (esbuild, цель ES2018) и gzip:

| Импорт | min | gzip |
|---|---|---|
| `EventType` | 0,3 КБ | 0,2 КБ |
| `ValidationError` | 0,4 КБ | 0,3 КБ |
| `LocalDate` | 2,4 КБ | 1,1 КБ |
| `Decimal` | 3,3 КБ | 1,5 КБ |
| `Money` (включает `Decimal`) | 6,0 КБ | 2,3 КБ |
| `ActiveModel` | 25,5 КБ | 8,2 КБ |
| `ActiveField` (включает `ActiveModel`) | 28,2 КБ | 9,0 КБ |
| `ActiveCollection` (включает `ActiveModel`) | 35,0 КБ | 11,3 КБ |
| `ActiveMap` (включает `ActiveModel`) | 29,6 КБ | 9,4 КБ |
| `ActiveSet` (включает `ActiveModel`) | 29,1 КБ | 9,3 КБ |

- Скаляры, `ValidationError`, `EventType` и `CallableModel` не тянут модель.
- `ActiveModel` и `ActiveField` не тянут `ActiveCollection`, `ActiveMap`, `ActiveSet` и скаляры.
- Каждый контейнер не тянет остальные два.
- Библиотека не зависит от lodash: клонирование — собственная реализация.

Пределы по каждому импорту проверяет `tests/treeshake.test.ts`: он собирает каждую точку входа и падает, если в бандл
попал лишний модуль или размер вышел за бюджет. Методы класса бандлер не вырезает, поэтому у `ActiveModel` размер
фиксирован: он включает все его методы (историю, транзакции, отслеживание изменений).

## Контейнеры подключаются явно

Поле модели не знает про коллекции, пока вы их не импортировали. Тип контейнера описывает `.field()` самого контейнера,
опция `container` принимает это описание:

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { ActiveCollection } from '@alt-point/active-models/ActiveCollection'
import { ActiveMap } from '@alt-point/active-models/ActiveMap'
import { ActiveSet } from '@alt-point/active-models/ActiveSet'

class Board extends ActiveModel {
  @ActiveField({ container: ActiveCollection.field(Task, { sortBy: 'id' }) }) tasks!: ActiveCollection<Task>
  @ActiveField({ container: ActiveMap.field(User, { key: 'id' }) }) users!: ActiveMap<User>
  @ActiveField({ container: ActiveSet.field(Tag, { unique: 'name' }) }) tags!: ActiveSet<Tag>
}
```

Если на странице нужна только модель, ни `ActiveCollection`, ни `ActiveMap`, ни `ActiveSet` в бандл не попадут.
Имя `field`, а не `of`: `ActiveCollection` наследует `Array`, у которого уже есть статический `Array.of`.

## TypeScript и сборщики

| Окружение | Что нужно |
|---|---|
| `moduleResolution: bundler`, `node16`, `nodenext` | ничего: используется `exports` |
| `moduleResolution: node` (старый) | ничего: подпути описаны в `typesVersions` |
| Vite, webpack 5, esbuild, Rollup | ничего: ESM-сборка, `sideEffects: false` |
| Node.js (CommonJS) | `require('@alt-point/active-models/ActiveModel')`: тот же экземпляр классов, что и в ESM-сборке |

Подпути разных точек входа делят общий код через общие чанки: `instanceof`, события и реестры работают между точками
входа и в ESM, и в CommonJS. Это проверяет `bun run test:dist` на собранном пакете.
