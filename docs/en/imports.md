# Imports and tree-shaking

There is no root import (since 5.0; [migration](/en/migration-5)): `import { ... } from '@alt-point/active-models'` does not resolve. Every capability is a
separate entry point (a subpath), so a bundle contains only what you import. There are no runtime dependencies.

## Subpaths

| Subpath | Exports |
|---|---|
| `/ActiveModel` | `ActiveModel`, type `InvariantCheck` |
| `/decorators` | `ActiveField`, `ActiveFactory`, `GetterMethod`, `SetterMethod`, `InvariantMethod`, `isHidden`, `isFillable`, `isProtected` |
| `/types` | `EventType` and the option and event types: `FactoryOptions`, `CollectionOptions`, `MapOptions`, `SetOptions`, `ActiveFieldDescriptor`, `EventListener`, `EventPayloads`, ... |
| `/pipeline` | `ValidationError`; types `ValidationIssue`, `ValidationResult`, `ValidationCode`, `FieldRules`, `Transform`, `Transitions`, `CoerceTo`, `ValueType`, `Coercible`, `Bound` |
| `/ActiveCollection` | `ActiveCollection`, type `CollectionInput` |
| `/ActiveMap` | `ActiveMap` |
| `/ActiveSet` | `ActiveSet` |
| `/collectionRegistry` | `isCollection` |
| `/scalars/Decimal` | `Decimal`, types `DecimalInput`, `RoundingMode` |
| `/scalars/Money` | `Money`, `minorUnits` |
| `/scalars/LocalDate` | `LocalDate` |
| `/scalars/immutable` | `markImmutable` |
| `/CallableModel` | `CallableModel` |
| `/Enum` | `Enum` (deprecated) |
| `/utils` | types `ModelProperties`, `RecursivePartialActiveModel` |

```ts
import { ActiveModel } from '@alt-point/active-models/ActiveModel'
import { ActiveField } from '@alt-point/active-models/decorators'
import { EventType } from '@alt-point/active-models/types'
import { Money } from '@alt-point/active-models/scalars/Money'
```

Anything not in the table (`meta`, `emitter`, `history`, `equal`, `clone`, ...) is internal and cannot be imported.

## What ends up in the bundle

The size of a single import after minification (esbuild, target ES2018) and gzip:

| Import | min | gzip |
|---|---|---|
| `EventType` | 0.3 KB | 0.2 KB |
| `ValidationError` | 0.4 KB | 0.3 KB |
| `LocalDate` | 2.4 KB | 1.1 KB |
| `Decimal` | 3.3 KB | 1.5 KB |
| `Money` (includes `Decimal`) | 6.0 KB | 2.3 KB |
| `ActiveModel` | 25.5 KB | 8.2 KB |
| `ActiveField` (includes `ActiveModel`) | 28.2 KB | 9.0 KB |
| `ActiveCollection` (includes `ActiveModel`) | 35.0 KB | 11.3 KB |
| `ActiveMap` (includes `ActiveModel`) | 29.6 KB | 9.4 KB |
| `ActiveSet` (includes `ActiveModel`) | 29.1 KB | 9.3 KB |

- Scalars, `ValidationError`, `EventType` and `CallableModel` do not pull in the model.
- `ActiveModel` and `ActiveField` do not pull in `ActiveCollection`, `ActiveMap`, `ActiveSet` or the scalars.
- Each container pulls in neither of the other two.
- The library does not depend on lodash: cloning is its own implementation.

`tests/treeshake.test.ts` enforces the limits per import: it bundles every entry point and fails when an unwanted module
shows up or the size exceeds its budget. A bundler cannot strip methods from a class, so the size of `ActiveModel` is
fixed: it includes all of its methods (history, transactions, change tracking).

## Containers are opt-in

A model field knows nothing about collections until you import them. The container's own `.field()` describes the
field type, and the `container` option takes that description:

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

If a page needs only the model, none of `ActiveCollection`, `ActiveMap` or `ActiveSet` reaches the bundle.
The method is called `field`, not `of`, because `ActiveCollection` extends `Array`, which already has a static `Array.of`.

## TypeScript and bundlers

| Environment | What you need |
|---|---|
| `moduleResolution: bundler`, `node16`, `nodenext` | nothing: `exports` is used |
| `moduleResolution: node` (legacy) | nothing: the subpaths are listed in `typesVersions` |
| Vite, webpack 5, esbuild, Rollup | nothing: ESM build, `sideEffects: false` |
| Node.js (CommonJS) | `require('@alt-point/active-models/ActiveModel')`: the same class instances as the ESM build |

Entry points share code through common chunks, so `instanceof`, events and registries work across entry points in both
ESM and CommonJS. `bun run test:dist` checks this against the built package.
