import { ActiveModel } from './ActiveModel'
import { useEmitter } from './emitter'
import { registerCollection } from './collectionRegistry'
import { attachItem, detachItem, isNilKey, isPlainObject, keyFunction, normalizeItem, wrapContainer } from './collectionCore'
import {
  EventType,
  type ActiveModelHookListener,
  type ContainerSpec,
  type EventListener,
  type MapOptions,
} from './types'
import type { RecursivePartialActiveModel } from './utils'

type State<T extends ActiveModel> = {
  self: ActiveMap<T>
  model: typeof ActiveModel
  coerce: boolean
  options: MapOptions<T>
  keyOf: (item: T) => unknown
  /** item -> the key it is stored under */
  itemKey: Map<T, unknown>
  attached: Map<T, { off: () => void, count: number }>
}

const states = new WeakMap<object, State<any>>()
const MapProto = Map.prototype

const stateOf = <T extends ActiveModel>(map: object): State<T> | undefined => states.get(map)

const emit = (state: State<any>, event: EventType, payload: unknown) => {
  useEmitter(state.self).emit(event, payload)
}

const attach = <T extends ActiveModel>(state: State<T>, item: T) => attachItem(state, item, onItemTouched)

const detach = <T extends ActiveModel>(state: State<T>, item: T) => detachItem(state, item)

/** An item's key may have changed: move it to the new key (displacing whatever held it), and bubble the change */
const onItemTouched = <T extends ActiveModel>(state: State<T>, item: T) => {
  const previous = state.itemKey.get(item)
  const key = state.keyOf(item)
  if (!Object.is(previous, key)) {
    if (MapProto.get.call(state.self, previous) === item) {
      MapProto.delete.call(state.self, previous)
    }
    state.itemKey.set(item, key)
    if (!isNilKey(key)) {
      const displaced = MapProto.get.call(state.self, key) as T | undefined
      if (displaced !== undefined && displaced !== item) {
        state.itemKey.delete(displaced)
        detach(state, displaced)
        emit(state, EventType.itemsRemoved, { target: state.self, items: [displaced], keys: [key] })
      }
      MapProto.set.call(state.self, key, item)
    }
  }
  emit(state, EventType.touched, { target: state.self })
}

/**
 * A `Map` of one model's instances, keyed by a value taken from each item - and nothing else can get in.
 *
 * - `set(key, item)` accepts an instance of the model (or, with `coerce`, plain data) whose own key equals `key`;
 *   `add(...items)` derives the key for you. Anything else throws.
 * - When an item's key field changes, the entry follows it to the new key.
 * - Emits `itemsAdded`, `itemsRemoved` (with `keys`) and `touched` (also when an item changes), so it bubbles
 *   into a parent model like a nested model does.
 *
 * Create it with {@link ActiveMap.create}, or the `map` field option. Like `ActiveCollection`, it guards its own
 * methods; `Map.prototype.set.call(map, ...)` bypasses them.
 */
export class ActiveMap<T extends ActiveModel = ActiveModel, K = any> extends Map<K, T> {
  /**
   * @param model - the only model class the map accepts
   * @param options - how the key of an item is computed (`key`), and `coerce`
   * @param items - initial items
   */
  static create<M extends typeof ActiveModel> (
    this: typeof ActiveMap,
    model: M,
    options: MapOptions<InstanceType<M>>,
    items: Iterable<unknown> = []
  ): ActiveMap<InstanceType<M>> {
    if (typeof model !== 'function' || !(model.prototype instanceof ActiveModel)) {
      throw new TypeError('ActiveMap.create() needs a class extending ActiveModel')
    }
    const keyOf = keyFunction<InstanceType<M>>(options?.key)
    if (!keyOf) {
      throw new TypeError('ActiveMap.create() needs options.key: a field name or a function')
    }

    const map = new this() as ActiveMap<InstanceType<M>>
    states.set(map, {
      self: map,
      model,
      coerce: options.coerce ?? true,
      options,
      keyOf,
      itemKey: new Map(),
      attached: new Map(),
    })
    registerCollection(map)
    map.add(...(items as Iterable<RecursivePartialActiveModel<InstanceType<M>>>))
    return map
  }

  /**
   * Describe a map field for `@ActiveField({ container })`: an assigned array, `Map` or object of items becomes an
   * `ActiveMap` keyed by `options.key`, the default is an empty one.
   * @example
   * @ActiveField({ container: ActiveMap.field(User, { key: 'id' }) }) users!: ActiveMap<User>
   */
  static field<M extends typeof ActiveModel> (
    this: typeof ActiveMap,
    model: M,
    options: MapOptions<InstanceType<M>>
  ): ContainerSpec<ActiveMap<InstanceType<M>>> {
    return {
      model,
      wrap: (value) => wrapContainer(
        'map',
        model,
        value,
        (candidate) => candidate instanceof this && (candidate as ActiveMap).model === model,
        (items) => this.create(model, options, items),
        'an array, a Map or an object',
        (input) => {
          if (input instanceof Map) return Array.from(input.values())
          return isPlainObject(input) ? Object.values(input) : undefined
        }
      ),
    }
  }

  /** Subscribe to an event on every map of this class. */
  static on (event: EventType, cb: ActiveModelHookListener) {
    return useEmitter(this).addListener(event, cb)
  }

  /** Same as `on`, but the listener is removed after firing once. */
  static once (event: EventType, cb: ActiveModelHookListener) {
    return useEmitter(this).addListener(event, cb, true)
  }

  /** The model class this map accepts */
  get model (): typeof ActiveModel {
    return stateOf(this)!.model
  }

  /** Subscribe to `itemsAdded`, `itemsRemoved` or `touched` on this map; returns an unsubscribe function. */
  on<E extends EventType> (event: E, cb: EventListener<E>): () => void {
    return useEmitter(this).addListener(event, cb as ActiveModelHookListener)
  }

  /** Same as `on`, but the listener is removed after firing once. */
  once<E extends EventType> (event: E, cb: EventListener<E>): () => void {
    return useEmitter(this).addListener(event, cb as ActiveModelHookListener, true)
  }

  /** Store an item under its key (replacing whatever held it). Nothing is stored if any item is refused. */
  add (...items: Array<T | RecursivePartialActiveModel<T>>): this {
    const state = stateOf<T>(this)
    if (!state) {
      throw new TypeError('Not an ActiveMap: create it with ActiveMap.create()')
    }
    const accepted = items.map((item) => normalizeItem<T>(state.model, state.coerce, 'ActiveMap', item))
    const keyed = accepted.map((item) => ({ item, key: state.keyOf(item) }))
    const missing = keyed.find(({ key }) => isNilKey(key))
    if (missing) {
      throw new TypeError(`ActiveMap<${state.model.name}> needs a key for every item, got ${missing.key}`)
    }
    keyed.forEach(({ item, key }) => this.store(state, key as K, item))
    return this
  }

  /**
   * Store `item` under `key`, which must be the item's own key. A plain object is turned into an instance first.
   */
  set (key: K, value: T | RecursivePartialActiveModel<T>): this {
    const state = stateOf<T>(this)
    if (!state) {
      return super.set(key, value as T)
    }
    const item = normalizeItem<T>(state.model, state.coerce, 'ActiveMap', value)
    const own = state.keyOf(item)
    if (!Object.is(own, key)) {
      throw new TypeError(`ActiveMap<${state.model.name}> key mismatch: stored under ${JSON.stringify(key)} but the item's key is ${JSON.stringify(own)}`)
    }
    this.store(state, key, item)
    return this
  }

  delete (key: K): boolean {
    const state = stateOf<T>(this)
    if (!state) {
      return super.delete(key)
    }
    const item = MapProto.get.call(this, key) as T | undefined
    if (item === undefined) {
      return false
    }
    MapProto.delete.call(this, key)
    state.itemKey.delete(item)
    detach(state, item)
    emit(state, EventType.itemsRemoved, { target: this, items: [item], keys: [key] })
    emit(state, EventType.touched, { target: this })
    return true
  }

  clear (): void {
    const state = stateOf<T>(this)
    if (!state) {
      super.clear()
      return
    }
    const items = Array.from(this.values())
    const keys = Array.from(this.keys())
    MapProto.clear.call(this)
    items.forEach((item) => {
      state.itemKey.delete(item)
      detach(state, item)
    })
    if (items.length > 0) {
      emit(state, EventType.itemsRemoved, { target: this, items, keys })
      emit(state, EventType.touched, { target: this })
    }
  }

  /** A deep copy: every item is cloned; the key option is kept. */
  clone (): ActiveMap<T> {
    const state = stateOf<T>(this)!
    return (this.constructor as typeof ActiveMap).create(
      state.model,
      state.options as MapOptions<any>,
      Array.from(this.values(), (item) => item.clone())
    ) as unknown as ActiveMap<T>
  }

  /** The entries as a plain object: key (as a string) -> the item as plain data */
  toJSON (): Record<string, object> {
    const json: Record<string, object> = {}
    for (const [key, item] of this) {
      json[String(key)] = item.toJSON() as object
    }
    return json
  }

  private store (state: State<T>, key: K, item: T) {
    const existing = MapProto.get.call(this, key) as T | undefined
    if (existing === item) {
      return
    }
    if (existing !== undefined) {
      state.itemKey.delete(existing)
      detach(state, existing)
      emit(state, EventType.itemsRemoved, { target: this, items: [existing], keys: [key] })
    }
    MapProto.set.call(this, key, item)
    state.itemKey.set(item, key)
    attach(state, item)
    emit(state, EventType.itemsAdded, { target: this, items: [item], keys: [key] })
    emit(state, EventType.touched, { target: this })
  }
}
