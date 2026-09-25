# Invariants, transactions, diffs and undo

Four tools for integrity **over time and across fields**, all built on the same idea: values that were valid can
always be put back.

## Invariants: rules across several fields

A rule about two fields (`end >= start`) can't hold between the two writes that make it true, so it isn't checked on
every write. It is checked by `validate()`, `assertValid()`, `create(data, { validate: true })`, `transaction()` and
an atomic `fill()`.

```ts
class Trip extends ActiveModel {
  @ActiveField({ coerce: 'date' }) start?: Date
  @ActiveField({ coerce: 'date' }) end?: Date

  @InvariantMethod('end must not be before start')
  static endAfterStart (trip: Trip) {
    return !trip.start || !trip.end || trip.end >= trip.start   // false (or a message string) = violated
  }
}

// without the decorator:
Trip.defineInvariant('end after start', (t) => t.end >= t.start ? true : `end ${t.end} is before ${t.start}`)
```

A violation is reported as `{ path: '', code: 'invariant', message }` (`path` is the field holding the model when it is
nested: `trip`, `legs[1]`). A check that throws counts as violated. Invariants are inherited by subclasses.

## `transaction()`: all or nothing

```ts
trip.transaction((t) => {
  t.seats = 9
  t.start = new Date('2026-05-20')
  t.end = new Date('2026-05-05')      // the model is now invalid...
})                                    // ...so everything is rolled back and a ValidationError is thrown
```

If `fn` throws, or the model is invalid when it finishes (a rule, a validator or an invariant), **every field goes back**
and the error is rethrown: no caller ever sees a half-changed model. It returns what `fn` returns; an `async` fn is
awaited. Transactions nest, each rolling back to its own start.

`fill(data, { atomic: true })` is a transaction around `fill()`; a plain `fill` keeps what was written before the first
refused value.

- Events fire as the writes happen and aren't un-fired; the rollback emits its own for the fields it puts back.
- Nested models and collections are restored as **fresh copies**, so a reference you kept to the old nested instance
  goes stale.
- The rollback bypasses rules and transitions (those values were valid when taken).

## Diffs and revert

```ts
const profile = Profile.create(data, { tracked: true })
profile.name = 'x'
profile.trips.push({ seats: 9 })

profile.changes()        // { name: { from: 'n', to: 'x' }, trips: { from: <copy>, to: <collection> } }
profile.dirtyFields()    // ['name', 'trips']
profile.isDirty('name')  // true

profile.revert('name')   // one field back
profile.reset()          // everything back (revert() with no argument)
```

Where `isTouched()` says *whether* something changed, `changes()` says *what*. Nested models and lists are compared by
content, `from` is a copy, and — unlike `isTouched()` — `hidden` fields are included. Reverting restores fresh live
copies of nested models and collections, bypasses rules and emits the usual events. Needs a model created with
`{ tracked: true }` (it keeps a pristine copy taken right after creation; a `clone()` shares it).

## Undo and redo

```ts
const note = Note.create({ text: 'a' }, { history: true })     // or { history: { limit: 50 } }
note.text = 'b'
note.text = 'c'
note.undo()      // text === 'b'
note.undo()      // text === 'a'
note.redo()      // text === 'b'
note.canUndo(), note.canRedo(), note.clearHistory()
```

Every write after creation is a step (100 kept by default). A new write clears the redo steps; a whole `transaction()`
or atomic `fill()` is **one** step, and a rolled-back one leaves none. Undo/redo bypass rules and transitions and
aren't recorded themselves.

## Limits

- **In-place mutation** (`arr.push()`, a plain nested object) is invisible to `changes()` history and undo — they see
  field assignments. Nested `ActiveModel`s and `ActiveCollection`s are compared by content by `changes()`, but their
  own edits are not steps in the parent's undo history.
- `changes()`/`revert()` keep a second copy of the model: tracked models cost about twice the memory.
- These are prototype methods (`validate`, `transaction`, `changes`, `revert`, `reset`, `undo`, `redo`, ...): don't
  name a field the same.
