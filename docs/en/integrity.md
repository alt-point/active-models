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
- Nested models and containers are restored **in place**: the rollback replays a journal of changes (every write to a model
  and every container operation inside the transaction records how to undo itself) newest first, so a reference you kept to a
  nested instance or a collection stays valid, a replaced instance is put back, the items of a collection return to their
  places; their rollback events fire on them and bubble up as `touched`. A rollback costs in proportion to the number of
  changes, not to the size of the model.
- Mutating a plain value in place (`m.tags.push(x)`, `m.date.setHours(0)`) is not a write to the model: the journal doesn't
  see it and can't undo it, so replace the value instead (`m.tags = [...m.tags, x]`). An instance nested in two models at
  once is rolled back only by a transaction of the one it was bound to last.
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

`{ tracked: 'shallow' }` is the same API without the deep copy and the deep walk: the baseline keeps the field values **by
reference** and compares them with `Object.is`, O(fields). Reassigning a field (`profile.trips = [...]`) counts; an edit inside a
nested model or a `push` into a collection does not (same reference, and such edits show up in `from` too); `revert()` puts the
kept instance itself back, not a copy; `clone()` keeps the list of changed fields. Pick it for large documents where
`isTouched()` is called often and nested values are replaced rather than edited: a document with a 2000-row collection takes
`isTouched()` from ≈ 370 µs to ≈ 0.2 µs.

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
or atomic `fill()` is **one** step, and a rolled-back one leaves none - not even inside an enclosing transaction.
Undo/redo bypass rules and transitions and aren't recorded themselves.

## Limits

- **In-place mutation** (`arr.push()`, a plain nested object) is invisible to `changes()` history and undo — they see
  field assignments. Nested `ActiveModel`s and `ActiveCollection`s are compared by content by `changes()`, but their
  own edits are not steps in the parent's undo history.
- `changes()`/`revert()` keep a second copy of the model: tracked models cost about twice the memory (`tracked: 'shallow'` keeps
  only references to the field values).
- These are prototype methods (`validate`, `transaction`, `changes`, `revert`, `reset`, `undo`, `redo`, ...): don't
  name a field the same.
