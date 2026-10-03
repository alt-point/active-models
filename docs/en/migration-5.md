# Migrating from 4.x to 5.0

Version 5.0 splits the package into one entry point per capability and makes the typed containers opt-in, so a
bundle contains only what it imports. There are four breaking changes, and a script does most of the edits: see [Automatic migration](#automatic-migration).

## Automatic migration

The package ships a script that walks a directory recursively and rewrites the code for 5.0 in `.ts`, `.tsx`, `.mts`,
`.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.vue` files (only the `<script>` blocks):

```bash
npx @alt-point/active-models migrate ./src           # show what would change (writes nothing)
npx @alt-point/active-models migrate ./src --write   # apply
```

What it does:

- replaces imports from the package root with subpath imports (`import`, `import type`, `export ... from`,
  `const { ... } = require(...)`), keeping aliases (`A as B`), `type` modifiers, quotes, semicolons, indentation and line endings;
- rewrites the `collection` / `map` / `set` options of `@ActiveField({ ... })` into `container: ActiveCollection.field(...)`
  (`ActiveMap.field`, `ActiveSet.field`) and adds the imports it needs;
- rewrites `Model.collection(...)` and `Model.createCollection(...)` into `ActiveCollection.create(Model, ...)` and
  `ActiveCollection.createFromData(Model, ...)`;
- leaves strings, comments and regular expressions alone, and skips `node_modules`, `dist`, `build`, `.git`, `.nuxt`, `.output`;
- is idempotent: running it again changes nothing.

What it leaves to you: `import * as X from '@alt-point/active-models'`, dynamic `import()`, `jest.mock(...)`, a shorthand
`@ActiveField({ collection })` or one with a computed value, `ns.Task.collection()`. Each such place is printed with its file
and line (`MANUAL`).

| Flag | Effect |
|---|---|
| `--write` | apply the changes (without it, only show them) |
| `--check` | exit code 1 when something would change or needs manual work (for CI) |
| `--imports-only` | fix imports only; leave `Model.collection()` and the `collection` / `map` / `set` options |
| `--ext ts,vue` | which extensions to scan |
| `--ignore a,b` | which directories to skip instead of the default list |

Commit your work before `--write` so the result is easy to review with `git diff`. The script edits only files that import the
package directly; a file of your own that re-exports `@alt-point/active-models` is processed like any other, and its
consumers stay as they are.

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
