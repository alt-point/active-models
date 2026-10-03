# Migrating from 4.x to 5.0

Version 5.0 splits the package into one entry point per capability and makes the typed containers opt-in, so a
bundle contains only what it imports. There are four breaking changes.

## 1. No root import: one subpath per capability

`import { ... } from '@alt-point/active-models'` no longer resolves. Import each capability from its own subpath;
the full list is in [Imports and tree-shaking](/en/imports).

```ts
// before
import { ActiveModel, ActiveField, EventType, ValidationError } from '@alt-point/active-models'

// after
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'
import { ValidationError } from '@alt-point/active-models/pipeline'
```

| Was exported from the root | Subpath |
|---|---|
| `ActiveModel` | `/ActiveModel` |
| `ActiveField`, `ActiveFactory`, `GetterMethod`, `SetterMethod`, `InvariantMethod` | `/decorators` |
| `EventType` and every option / payload type | `/types` |
| `ValidationError`, `FieldRules`, ... | `/pipeline` |
| `ActiveCollection`, `ActiveMap`, `ActiveSet` | `/ActiveCollection`, `/ActiveMap`, `/ActiveSet` |
| `isCollection` | `/collectionRegistry` |
| `Decimal`, `Money`, `LocalDate`, `markImmutable` | `/scalars/Decimal`, `/scalars/Money`, `/scalars/LocalDate`, `/scalars/immutable` |
| `CallableModel`, `Enum` | `/CallableModel`, `/Enum` |
| `ModelProperties`, `RecursivePartialActiveModel` | `/utils` |

The subpaths `/ActiveModel`, `/CallableModel` and `/decorators` already existed in 4.x.

## 2. `collection` / `map` / `set` field options → `container`

`ActiveModel` and `@ActiveField` no longer import the container classes. A field names its container through the
container's own `.field()`:

```ts
// before
@ActiveField({ collection: [Task, { sortBy: 'id' }] }) tasks!: ActiveCollection<Task>
@ActiveField({ map: [User, { key: 'id' }] }) users!: ActiveMap<User>
@ActiveField({ set: [Tag, { unique: 'name' }] }) tags!: ActiveSet<Tag>

// after
@ActiveField({ container: ActiveCollection.field(Task, { sortBy: 'id' }) }) tasks!: ActiveCollection<Task>
@ActiveField({ container: ActiveMap.field(User, { key: 'id' }) }) users!: ActiveMap<User>
@ActiveField({ container: ActiveSet.field(Tag, { unique: 'name' }) }) tags!: ActiveSet<Tag>
```

`collection: Task` (a bare model) becomes `ActiveCollection.field(Task)`. The behavior is the same; combining the option with
`factory` now fails with `use either factory or container, not both`.

## 3. `Model.collection()` / `Model.createCollection()` removed

```ts
// before
const tasks = Task.collection(items, { sortBy: 'id' })
const loaded = Task.createCollection(apiRows, { sortBy: 'id', tracked: true })

// after
const tasks = ActiveCollection.create(Task, items, { sortBy: 'id' })
const loaded = ActiveCollection.createFromData(Task, apiRows, { sortBy: 'id', tracked: true })
```

## 4. No runtime dependencies

`lodash-es` is gone; cloning is the library's own. Nothing to change in your code. If you relied on lodash being installed
transitively, add it to your own `package.json`.

## What is not affected

Models, events, validation, tracking, history, scalars and every behavior described in the 4.0 guide work as before.
