# Change tracking: `isTouched()` and `startTracking()`

## The problem

A profile-edit form should only enable "Save" once the user has actually changed something — not on every
re-render. A multi-step wizard should warn about unsaved changes on navigation away. A list of records
fetched from the backend should only send back the items that actually changed. All of these are the same
question: "does the object's current state differ from the one it was created with?"

Answering it by hand-comparing fields (`if (form.name !== initialName || form.email !== initialEmail...)`)
doesn't scale — every new field is one more place you have to remember to add. `ActiveModel` solves this
at the model level: `isTouched()` and `startTracking()`.

## Basic usage

A snapshot of the "initial state" is saved at creation time when you pass `tracked: true`:

```ts
import { ActiveModel, ActiveField } from '@alt-point/active-models'

class UserForm extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField() email: string = ''
}

const form = UserForm.create({ name: 'Alice', email: 'alice@example.com' }, { tracked: true })

form.isTouched() // false — current state matches the snapshot

form.name = 'Alice Cooper'
form.isTouched() // true
```

If a model was already created without `tracked: true` (e.g. `new UserForm(data)`, where `create()`'s
options aren't available), you can set the snapshot at any later point via `startTracking()` — the same
mechanism, just triggered from application code instead of the factory:

```ts
const form = new UserForm({ name: 'Alice', email: 'alice@example.com' })
form.startTracking() // pins the current state as the baseline

form.email = 'alice@work.com'
form.isTouched() // true
```

`startTracking()` is also how you reuse a model across saves: call it again after a successful save to
clear the "dirty" state without recreating the model.

```ts
async function save (form: UserForm) {
  await api.updateUser(form.toJSON())
  form.startTracking() // the just-saved state becomes the new baseline
}
```

## Three states, not two

`isTouched()` returns `boolean | undefined` — that's deliberate, not an oversight:

| Value | When | Meaning |
|---|---|---|
| `undefined` | a snapshot was never saved | "did it change" is meaningless — there's nothing to compare against |
| `false` | a snapshot exists, current state matches it | unchanged |
| `true` | a snapshot exists, current state differs | changed |

If you treat the result as a plain `boolean`, `undefined` can silently slip through
`if (!form.isTouched())` as the "unchanged" branch — for a model where tracking was never enabled in the
first place. Check explicitly:

```ts
if (form.isTouched() === false) {
  // definitely unchanged
}
if (form.isTouched() === undefined) {
  // tracking was never enabled for this model
}
```

## What's actually compared

The snapshot is a deep copy of the whole model instance taken at `startTracking()`/
`create(..., { tracked: true })`; the comparison is deep structural equality (`fast-deep-equal`) against
the current state. Two practical consequences follow — both verified against the library's actual
behavior:

**Changes in nested `factory` models bubble up.** If a field was built via `factory`, the snapshot
includes it too — there's no need to track the nested model separately:

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
user.isTouched() // true — even though the change was on the nested model, not user itself
```

**Fields marked `hidden: true` are excluded from the comparison.** `ownKeys` (used while building the
snapshot) filters hidden fields out exactly like it does for `Object.keys()`/`JSON.stringify()` — so a
change to a hidden field is invisible to `isTouched()`:

```ts
class Session extends ActiveModel {
  @ActiveField() name: string = ''
  @ActiveField({ hidden: true }) csrfToken: string = ''
}

const session = Session.create({ name: 'x' }, { tracked: true })
session.csrfToken = 'new-token'
session.isTouched() // false — csrfToken is hidden from the snapshot
```

If a field must participate in change tracking, don't make it `hidden` — reserve `hidden` for data that
genuinely shouldn't be serialized *or* compared (see the
[`@ActiveField()` options reference](/en/active-field-options#hidden)).

## `isTouched()` is not the `touched` event

The library has two independently-named mechanisms with similar names, and it's easy to mix them up:

- **The `touched` event** (`model.emitter.on(EventType.touched, cb)`) — fires **immediately**, on any
  real change to any active field, regardless of whether tracking is enabled. This is push-based: you find
  out about every change the moment it happens.
- **`isTouched()`** — pull-based: answers "does the *current* state differ from the snapshot" whenever you
  ask. It does nothing until you explicitly call it.

The `touched` event needs no `tracked: true` and has nothing to do with the snapshot — it fires even when
`isTouched()` would return `undefined`. More on the event: [Model lifecycle](/en/model-lifecycle#touched-internal-no-payload).

The `touched` event is the right signal for finding out that *something* changed right now (e.g. to trigger
a reactive UI recompute); `isTouched()` is how you get an unambiguous answer at one specific point (e.g.
before a form submit, or when a tab closes).

## Using it in Vue

Composition API: `isTouched()` is a plain method, not reactive on its own, so you wire up reactivity
manually with a `ref` and the `touched` event as the recompute trigger:

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
  form.startTracking() // clear the dirty state after saving
}
</script>

<template>
  <input v-model="form.name" />
  <input v-model="form.email" />
  <button :disabled="!isDirty" @click="onSave">Save</button>
</template>
```

`model.emitter.on(...)` returns an unsubscribe function — passing it straight into `onUnmounted` is safe,
no listener leaks on unmount.

## Using it in React

Same principle, but with the tool React itself provides for this: `useSyncExternalStore` is designed
exactly for subscribing to an external mutable state source (which an `ActiveModel` instance is), without
tearing between renders and without a manual `useEffect` + `useState` combo:

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
      <button disabled={!isDirty} onClick={onSave}>Save</button>
    </>
  )
}
```

Since `ActiveModel` doesn't keep its state in React state, a direct assignment (`form.name = ...`) doesn't
trigger a re-render by itself — the `touched` event (via `useDirty`) is what reports it.

## Comparison with other approaches

| Approach | Where the state lives | Granularity | Setup cost |
|---|---|---|---|
| **`ActiveModel.isTouched()`** | on the model itself | whole instance (deep-equal) | built in, `tracked: true` or `startTracking()` |
| `react-hook-form` `formState.isDirty` | inside the form, tied to `register()`/`Controller` | per-field and aggregate | requires building the form through the library |
| Formik `dirty` | `values` vs `initialValues` inside Formik's state | whole form state (deep-equal) | requires wrapping every field with Formik |
| VeeValidate / Vuelidate | validator state | per-field | requires a separate validation/field schema |
| MobX (`observable` + manual snapshot) | in the store, but the snapshot/compare is your code | implementation-dependent | no built-in `isDirty`, hand-written |
| Redux Toolkit / Immer | previous vs. next immutable state | shallow-equal by reference (cheap due to structural sharing) | comparing snapshots is still your code |

The key difference: dirty tracking in `ActiveModel` isn't a layer bolted onto a form library or a store —
it's a property of the data model itself. The same `UserForm` with the same `isTouched()` behaves
identically in Vue, React, a Node script, or a test — with no UI-framework glue. The cost is that the
comparison runs against the whole model, not a single field; if you need to know *which* field changed,
combine it with the `afterSetValue`/`touched` events (see [Model lifecycle](/en/model-lifecycle)) instead
of relying on `isTouched()` alone.
