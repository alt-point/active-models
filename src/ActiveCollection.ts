import { ActiveModel } from './ActiveModel'
import { useEmitter } from './emitter'
import { registerCollection } from './collectionRegistry'
import {
  EventType,
  type ActiveModelHookListener,
  type CollectionOptions,
  type EventListener,
} from './types'
import type { RecursivePartialActiveModel } from './utils'

/** What a collection accepts: an instance of its model, or (with `coerce`) plain data for one */
export type CollectionInput<T extends ActiveModel> = T | RecursivePartialActiveModel<T>

type Comparator<T> = (a: T, b: T) => number

type State<T extends ActiveModel> = {
  self: ActiveCollection<T>
  raw: ActiveCollection<T>
  model: typeof ActiveModel
  coerce: boolean
  options: CollectionOptions<T>
  sorted: boolean
  order: 'asc' | 'desc'
  keyOf?: (item: T) => unknown
  compare?: Comparator<T>
  attached: Map<T, { off: () => void, count: number }>
}

const A = Array.prototype

/** Above this many items a sorted collection sorts once instead of inserting one by one */
const BULK_SORT_THRESHOLD = 32
const states = new WeakMap<object, State<any>>()

/*
 * V8 runs the built-in Array methods on an instance of an Array *subclass* through a generic slow
 * path (`splice` is ~15x slower than on a plain array), while plain loops stay fast. So the hot
 * paths below shift elements with loops instead of calling the built-ins on the raw storage.
 */

/** `Array.prototype.splice` for the raw storage: returns the removed items as a plain array */
const rawSplice = <T>(raw: any[], start: number, deleteCount: number, items: readonly T[]): T[] => {
  const length = raw.length
  // Stryker disable next-line ArrayDeclaration: the loop below fills every slot
  const removed = new Array<T>(deleteCount)
  for (let i = 0; i < deleteCount; i++) {
    removed[i] = raw[start + i]
  }
  const delta = items.length - deleteCount
  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      A.push.call(raw, undefined)
    }
    for (let i = length - 1; i >= start + deleteCount; i--) {
      raw[i + delta] = raw[i]
    }
  } else if (delta < 0) {
    for (let i = start + deleteCount; i < length; i++) {
      raw[i + delta] = raw[i]
    }
    raw.length = length + delta
  }
  for (let i = 0; i < items.length; i++) {
    raw[start + i] = items[i]
  }
  return removed
}

const rawIndexOf = (raw: any[], item: unknown): number => {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === item) {
      return i
    }
  }
  return -1
}

/** Stable in-place sort of the raw storage */
const rawSort = (raw: any[], compare?: (a: any, b: any) => number) => {
  const ordered = Array.from(raw).sort(compare)
  for (let i = 0; i < ordered.length; i++) {
    raw[i] = ordered[i]
  }
}

/**
 * The items in the collection's order. With a `sortBy` key every key is read once up front:
 * reading a model field goes through a Proxy, so doing it per comparison would dominate the sort.
 */
const sortedCopy = <T extends ActiveModel>(state: State<T>, items: T[]): T[] => {
  if (!state.keyOf) {
    return items.slice().sort(state.compare)
  }
  const keyOf = state.keyOf
  const order = state.order
  return items
    .map((item) => ({ key: keyOf(item), item }))
    .sort((a, b) => compareKeys(a.key, b.key, order))
    .map(({ item }) => item)
}

const stateOf = <T extends ActiveModel>(collection: object): State<T> => {
  const state = states.get(collection)
  if (!state) {
    throw new TypeError('Not an ActiveCollection')
  }
  return state
}

const isIndex = (prop: string | symbol): prop is string =>
  typeof prop === 'string' && /^(0|[1-9]\d*)$/.test(prop) && Number(prop) < 2 ** 32 - 1

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const describe = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'object') return (value as object).constructor?.name ?? 'object'
  return typeof value
}

/** `null`/`undefined` keys always sort last, whatever the direction */
const compareKeys = (a: any, b: any, order: 'asc' | 'desc'): number => {
  const aNil = a === null || a === undefined
  const bNil = b === null || b === undefined
  if (aNil || bNil) {
    return aNil === bNil ? 0 : aNil ? 1 : -1
  }
  const result = a < b ? -1 : a > b ? 1 : 0
  return order === 'desc' ? -result : result
}

const emit = (state: State<any>, event: EventType, payload: unknown) => {
  useEmitter(state.raw).emit(event, payload)
}

const normalize = <T extends ActiveModel>(state: State<T>, item: unknown): T => {
  if (item instanceof state.model) {
    return item as T
  }
  if (state.coerce && isPlainObject(item)) {
    return state.model.createLazy(item as any) as T
  }
  throw new TypeError(
    `ActiveCollection<${state.model.name}> accepts only ${state.model.name} instances` +
    `${state.coerce ? ' or plain objects' : ''}, got ${describe(item)}`
  )
}

const normalizeAll = <T extends ActiveModel>(state: State<T>, items: ArrayLike<unknown> | Iterable<unknown>): T[] =>
  Array.from(items as Iterable<unknown>, (item) => normalize(state, item))

/** Index after the last item that is not greater than `item` (keeps insertion stable) */
const upperBound = <T extends ActiveModel>(state: State<T>, item: T): number => {
  const raw = state.raw
  let low = 0
  let high = raw.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (state.compare!(raw[mid], item) <= 0) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

const attach = <T extends ActiveModel>(state: State<T>, item: T) => {
  const known = state.attached.get(item)
  if (known) {
    known.count++
    return
  }
  // The item outlives the collection it sits in, so it must not keep that collection alive:
  // hold the state weakly and unsubscribe as soon as the collection has been collected.
  const ref = new WeakRef(state)
  const off: () => void = item.on(EventType.touched, () => {
    const alive = ref.deref()
    if (alive) {
      onItemTouched(alive, item)
    // Stryker disable all: the dead-collection branch needs a garbage collection to run - see the memory test in tests/perf
    } else {
      off()
    }
    // Stryker restore all
  })
  state.attached.set(item, { off, count: 1 })
}

const detach = <T extends ActiveModel>(state: State<T>, item: T) => {
  const known = state.attached.get(item)
  if (!known) {
    return
  }
  if (--known.count === 0) {
    known.off()
    state.attached.delete(item)
  }
}

const resort = <T extends ActiveModel>(state: State<T>) => {
  const ordered = sortedCopy(state, Array.from(state.raw))
  for (let i = 0; i < ordered.length; i++) {
    state.raw[i] = ordered[i]
  }
}

const reposition = <T extends ActiveModel>(state: State<T>, item: T) => {
  const raw = state.raw
  const index = rawIndexOf(raw, item)
  if (index < 0) {
    return
  }
  if (state.attached.get(item)!.count > 1) {
    // the same instance sits in several slots; only a full (stable) sort keeps all of them in place
    resort(state)
    return
  }
  const inOrderBefore = index === 0 || state.compare!(raw[index - 1], item) <= 0
  const inOrderAfter = index === raw.length - 1 || state.compare!(item, raw[index + 1]) <= 0
  if (inOrderBefore && inOrderAfter) {
    return
  }
  rawSplice(raw, index, 1, [])
  rawSplice(raw, upperBound(state, item), 0, [item])
}

/** An item changed: keep the order, and let the change bubble up as the collection's own `touched` */
const onItemTouched = <T extends ActiveModel>(state: State<T>, item: T) => {
  if (state.sorted) {
    reposition(state, item)
  }
  emit(state, EventType.touched, { target: state.self })
}

/** Insert already-validated items: at `position` when unsorted, at their sorted place otherwise */
const insert = <T extends ActiveModel>(state: State<T>, items: T[], position: number) => {
  if (items.length === 0) {
    return
  }
  const raw = state.raw
  let index = position
  if (state.sorted) {
    index = upperBound(state, items[0])
    // Stryker disable next-line ConditionalExpression,EqualityOperator: both paths produce the same order, the threshold only picks the faster one
    if (items.length > BULK_SORT_THRESHOLD) {
      // one stable sort (existing items first, so ties keep insertion order) beats n shifting inserts
      const merged = sortedCopy(state, Array.from(raw).concat(items))
      raw.length = 0
      for (const item of merged) {
        A.push.call(raw, item)
      }
    } else {
      for (const item of items) {
        rawSplice(raw, upperBound(state, item), 0, [item])
      }
    }
  // Stryker disable next-line ConditionalExpression: appending through rawSplice gives the same result, the branch is a fast path
  } else if (position === raw.length) {
    for (const item of items) {
      A.push.call(raw, item)
    }
  } else {
    rawSplice(raw, position, 0, items)
  }
  items.forEach((item) => attach(state, item))
  emit(state, EventType.itemsAdded, { target: state.self, items, index })
  emit(state, EventType.touched, { target: state.self })
}

const removeRange = <T extends ActiveModel>(state: State<T>, start: number, count: number): T[] => {
  const removed = rawSplice(state.raw, start, count, [])
  if (removed.length > 0) {
    removed.forEach((item) => detach(state, item))
    emit(state, EventType.itemsRemoved, { target: state.self, items: removed, index: start })
    emit(state, EventType.touched, { target: state.self })
  }
  return removed
}

const assertIndexable = <T extends ActiveModel>(state: State<T>, action: string) => {
  if (state.sorted) {
    throw new TypeError(`A sorted ActiveCollection cannot ${action} - its order is defined by ${state.options.compare ? 'compare' : 'sortBy'}`)
  }
}

const setIndex = <T extends ActiveModel>(state: State<T>, index: number, value: unknown): boolean => {
  assertIndexable(state, 'be assigned by index; use push()')
  const raw = state.raw
  if (index > raw.length) {
    throw new RangeError(`ActiveCollection cannot have holes: index ${index} is beyond length ${raw.length}`)
  }
  const item = normalize(state, value)
  if (index === raw.length) {
    insert(state, [item], index)
    return true
  }
  const previous = raw[index]
  raw[index] = item
  detach(state, previous)
  attach(state, item)
  emit(state, EventType.itemsRemoved, { target: state.self, items: [previous], index })
  emit(state, EventType.itemsAdded, { target: state.self, items: [item], index })
  emit(state, EventType.touched, { target: state.self })
  return true
}

const setLength = <T extends ActiveModel>(state: State<T>, value: unknown): boolean => {
  const length = Number(value)
  if (length > state.raw.length) {
    throw new RangeError('ActiveCollection cannot be grown by setting length - it would create holes')
  }
  removeRange(state, length, state.raw.length - length)
  return true
}

const handlers: ProxyHandler<ActiveCollection<any>> = {
  set (target, prop, value) {
    const state = stateOf(target)
    if (prop === 'length') {
      return setLength(state, value)
    }
    if (isIndex(prop)) {
      return setIndex(state, Number(prop), value)
    }
    if (typeof prop === 'symbol') {
      return Reflect.set(target, prop, value)
    }
    throw new TypeError(`ActiveCollection holds items only - cannot set property "${prop}"`)
  },
  defineProperty (target, prop, descriptor) {
    const state = stateOf(target)
    if (prop === 'length' && 'value' in descriptor) {
      return setLength(state, descriptor.value)
    }
    if (isIndex(prop) && 'value' in descriptor) {
      return setIndex(state, Number(prop), descriptor.value)
    }
    if (typeof prop === 'symbol') {
      return Reflect.defineProperty(target, prop, descriptor)
    }
    throw new TypeError(`ActiveCollection holds items only - cannot define property "${prop}"`)
  },
  deleteProperty (target, prop) {
    if (isIndex(prop)) {
      throw new TypeError('ActiveCollection cannot have holes: use splice() or remove() to delete an item')
    }
    return Reflect.deleteProperty(target, prop)
  },
}

/**
 * An array that holds instances of one `ActiveModel` and nothing else - optionally kept sorted.
 *
 * - Only instances of the declared model are accepted; with `coerce` (default) plain objects are
 *   turned into instances, everything else throws a `TypeError`. The rule holds for every way in:
 *   `push`, `splice`, index assignment, `length`...
 * - `sortBy` / `compare` keep the collection sorted: `push` inserts at the right place (stable),
 *   items that change are moved, and operations that would break the order are refused.
 * - Emits `itemsAdded`, `itemsRemoved` and `touched` (also when an item changes), so it bubbles up
 *   into a parent model like a nested model does.
 *
 * Create it with {@link ActiveCollection.create}, `Model.collection()` or the `collection` field option.
 */
export class ActiveCollection<T extends ActiveModel = ActiveModel> extends Array<T> {
  /** `map()`, `flatMap()`... return plain arrays - only `filter`, `slice` and `concat` keep the collection type */
  static get [Symbol.species] (): ArrayConstructor {
    return Array
  }

  /**
   * Create a collection of `model` instances.
   * @param model - the only model class the collection accepts
   * @param items - initial items (instances or, with `coerce`, plain data)
   * @param options - sorting and coercion
   */
  static create<M extends typeof ActiveModel> (
    this: typeof ActiveCollection,
    model: M,
    items: Iterable<unknown> = [],
    options: CollectionOptions<InstanceType<M>> = {}
  ): ActiveCollection<InstanceType<M>> {
    // Stryker disable next-line ConditionalExpression: a non-function has no prototype, so the second test rejects it as well
    if (typeof model !== 'function' || !(model.prototype instanceof ActiveModel)) {
      throw new TypeError('ActiveCollection.create() needs a class extending ActiveModel')
    }

    const raw = new this() as ActiveCollection<InstanceType<M>>
    const self = new Proxy(raw, handlers)
    const sortBy = options.sortBy
    const keyOf = typeof sortBy === 'function'
      ? sortBy as (item: InstanceType<M>) => unknown
      : typeof sortBy === 'string' ? (item: any) => item[sortBy] : undefined

    const state: State<InstanceType<M>> = {
      self,
      raw,
      model,
      coerce: options.coerce ?? true,
      options,
      sorted: Boolean(options.compare || keyOf),
      order: options.order ?? 'asc',
      keyOf,
      attached: new Map(),
    }
    state.compare = options.compare
      // Stryker disable next-line ArithmeticOperator: only the sign of a comparator result matters
      ? (a, b) => (state.order === 'desc' ? -1 : 1) * options.compare!(a, b)
      : keyOf
        ? (a, b) => compareKeys(keyOf(a), keyOf(b), state.order)
        : undefined

    states.set(raw, state)
    states.set(self, state)
    registerCollection(raw, self)

    insert(state, normalizeAll(state, items), 0)
    return self
  }

  /**
   * Subscribe to an event on every collection of this class.
   */
  static on (event: EventType, cb: ActiveModelHookListener) {
    return useEmitter(this).addListener(event, cb)
  }

  /** Same as `on`, but the listener is removed after firing once. */
  static once (event: EventType, cb: ActiveModelHookListener) {
    return useEmitter(this).addListener(event, cb, true)
  }

  /** The model class this collection accepts */
  get model (): typeof ActiveModel {
    return stateOf(this).model
  }

  /** Whether the collection keeps itself sorted (`sortBy` or `compare` was given) */
  get sorted (): boolean {
    return stateOf(this).sorted
  }

  /** Current sort direction */
  get order (): 'asc' | 'desc' {
    return stateOf(this).order
  }

  /** Subscribe to `itemsAdded`, `itemsRemoved` or `touched` on this collection; returns an unsubscribe function. */
  on<E extends EventType> (event: E, cb: EventListener<E>): () => void {
    return useEmitter(stateOf(this).raw).addListener(event, cb as ActiveModelHookListener)
  }

  /** Same as `on`, but the listener is removed after firing once. */
  once<E extends EventType> (event: E, cb: EventListener<E>): () => void {
    return useEmitter(stateOf(this).raw).addListener(event, cb as ActiveModelHookListener, true)
  }

  /**
   * Append items (a sorted collection inserts each at its sorted place). Nothing is added if any item is refused.
   */
  push (...items: Array<CollectionInput<T>>): number {
    const state = stateOf<T>(this)
    insert(state, normalizeAll(state, items), state.raw.length)
    return state.raw.length
  }

  /** Like `push`, but chainable */
  add (...items: Array<CollectionInput<T>>): this {
    this.push(...items)
    return this
  }

  /** Prepend items (a sorted collection inserts each at its sorted place). */
  unshift (...items: Array<CollectionInput<T>>): number {
    const state = stateOf<T>(this)
    insert(state, normalizeAll(state, items), 0)
    return state.raw.length
  }

  pop (): T | undefined {
    const state = stateOf<T>(this)
    return state.raw.length === 0 ? undefined : removeRange(state, state.raw.length - 1, 1)[0]
  }

  shift (): T | undefined {
    const state = stateOf<T>(this)
    return state.raw.length === 0 ? undefined : removeRange(state, 0, 1)[0]
  }

  /** Remove and/or insert items. In a sorted collection inserted items go to their sorted place. */
  splice (start: number, deleteCount?: number, ...items: Array<CollectionInput<T>>): T[] {
    const state = stateOf<T>(this)
    const added = normalizeAll(state, items)
    const length = state.raw.length
    const from = start < 0 ? Math.max(length + start, 0) : Math.min(start, length)
    const count = deleteCount === undefined ? length - from : Math.min(Math.max(deleteCount, 0), length - from)
    const removed = removeRange(state, from, count)
    insert(state, added, from)
    return removed
  }

  /** Remove one item (by identity); returns whether it was there. */
  remove (item: T): boolean {
    const state = stateOf<T>(this)
    const index = rawIndexOf(state.raw, item)
    if (index < 0) {
      return false
    }
    removeRange(state, index, 1)
    return true
  }

  clear (): void {
    const state = stateOf<T>(this)
    removeRange(state, 0, state.raw.length)
  }

  /** Replace the whole content; nothing changes if any new item is refused. */
  replaceAll (items: Iterable<CollectionInput<T>>): void {
    const state = stateOf<T>(this)
    const next = normalizeAll(state, items)
    removeRange(state, 0, state.raw.length)
    insert(state, next, 0)
  }

  /**
   * Sort in place. A sorted collection re-sorts by its own order and refuses a different comparator.
   */
  sort (compareFn?: (a: T, b: T) => number): this {
    const state = stateOf<T>(this)
    if (state.sorted) {
      if (compareFn) {
        throw new TypeError('A sorted ActiveCollection cannot be sorted by another comparator')
      }
      resort(state)
    } else {
      rawSort(state.raw, compareFn)
    }
    emit(state, EventType.touched, { target: state.self })
    return this
  }

  /** Reverse in place. For a sorted collection this flips its direction and keeps it sorted. */
  reverse (): this {
    const state = stateOf<T>(this)
    if (state.sorted) {
      state.order = state.order === 'asc' ? 'desc' : 'asc'
    }
    // Stryker disable next-line EqualityOperator: swapping the middle element with itself changes nothing
    for (let low = 0, high = state.raw.length - 1; low < high; low++, high--) {
      const swap = state.raw[low]
      state.raw[low] = state.raw[high]
      state.raw[high] = swap
    }
    emit(state, EventType.touched, { target: state.self })
    return this
  }

  fill (value: CollectionInput<T>, start?: number, end?: number): this {
    const state = stateOf<T>(this)
    assertIndexable(state, 'be filled')
    const item = normalize(state, value)
    const before = state.raw.slice()
    A.fill.call(state.raw, item, start, end)
    before.forEach((previous) => detach(state, previous))
    state.raw.forEach((current) => attach(state, current))
    emit(state, EventType.touched, { target: state.self })
    return this
  }

  copyWithin (target: number, start: number, end?: number): this {
    const state = stateOf<T>(this)
    assertIndexable(state, 'be rearranged')
    const before = state.raw.slice()
    A.copyWithin.call(state.raw, target, start, end)
    before.forEach((previous) => detach(state, previous))
    state.raw.forEach((current) => attach(state, current))
    emit(state, EventType.touched, { target: state.self })
    return this
  }

  /** A new collection of the same kind with the items the predicate keeps (items are shared, not copied) */
  filter (predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): ActiveCollection<T> {
    const state = stateOf<T>(this)
    return this.derive(state, A.filter.call(state.raw, predicate, thisArg))
  }

  slice (start?: number, end?: number): ActiveCollection<T> {
    const state = stateOf<T>(this)
    return this.derive(state, A.slice.call(state.raw, start, end))
  }

  concat (...parts: Array<T | ConcatArray<T>>): ActiveCollection<T> {
    const state = stateOf<T>(this)
    return this.derive(state, A.concat.apply(Array.from(state.raw), parts as any[]))
  }

  /** A deep copy: every item is cloned; sorting options and direction are kept. */
  clone (): ActiveCollection<T> {
    const state = stateOf<T>(this)
    return this.derive(state, Array.from(state.raw, (item) => item.clone()))
  }

  /** The items as plain data, like `JSON.stringify(collection)` would produce */
  toJSON (): object[] {
    return Array.from(stateOf<T>(this).raw, (item) => item.toJSON() as object)
  }

  private derive (state: State<T>, items: unknown[]): ActiveCollection<T> {
    return (this.constructor as typeof ActiveCollection).create(
      state.model,
      items,
      { ...state.options, order: state.order } as CollectionOptions<any>
    ) as unknown as ActiveCollection<T>
  }

  /** Index of the first item whose key is not before `key` (needs `sortBy`) */
  bisectLeft (key: unknown): number {
    return this.bound(key, (cmp) => cmp < 0)
  }

  /** Index after the last item whose key is not after `key` (needs `sortBy`) */
  bisectRight (key: unknown): number {
    return this.bound(key, (cmp) => cmp <= 0)
  }

  /** The first item with exactly this key, found by binary search (needs `sortBy`) */
  findByKey (key: unknown): T | undefined {
    const state = stateOf<T>(this)
    const index = this.bisectLeft(key)
    const item = state.raw[index]
    return item !== undefined && compareKeys(state.keyOf!(item), key, state.order) === 0 ? item : undefined
  }

  /** The items whose key lies between `min` and `max`, both inclusive (needs `sortBy`) */
  range (min: unknown, max: unknown): T[] {
    const state = stateOf<T>(this)
    const ascending = state.order === 'asc'
    const start = this.bisectLeft(ascending ? min : max)
    const end = this.bisectRight(ascending ? max : min)
    const found: T[] = []
    for (let i = start; i < end; i++) {
      found.push(state.raw[i])
    }
    return found
  }

  private bound (key: unknown, goesRight: (cmp: number) => boolean): number {
    const state = stateOf<T>(this)
    if (!state.keyOf || !state.sorted) {
      throw new TypeError('bisect/range/findByKey need a collection created with sortBy')
    }
    let low = 0
    let high = state.raw.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (goesRight(compareKeys(state.keyOf(state.raw[mid]), key, state.order))) {
        low = mid + 1
      } else {
        high = mid
      }
    }
    return low
  }
}
