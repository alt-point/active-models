import { ActiveModel } from './ActiveModel'
import { useEmitter } from './emitter'
import { registerCollection } from './collectionRegistry'
import { attachItem, detachItem, isNilKey, keyFunction, normalizeItem, wrapContainer } from './collectionCore'
import { ValidationError } from './pipeline'
import {
  EventType,
  type ActiveModelHookListener,
  type ContainerSpec,
  type EventListener,
  type SetOptions,
} from './types'
import type { RecursivePartialActiveModel } from './utils'

type State<T extends ActiveModel> = {
  self: ActiveSet<T>
  model: typeof ActiveModel
  coerce: boolean
  options: SetOptions<T>
  uniqueKey?: (item: T) => unknown
  keys: Map<unknown, T>
  itemKey: Map<T, unknown>
  attached: Map<T, { off: () => void, count: number }>
}

const states = new WeakMap<object, State<any>>()
const SetProto = Set.prototype

const emit = (state: State<any>, event: EventType, payload: unknown) => {
  useEmitter(state.self).emit(event, payload)
}

const attach = <T extends ActiveModel>(state: State<T>, item: T) => attachItem(state, item, onItemTouched)

const detach = <T extends ActiveModel>(state: State<T>, item: T) => detachItem(state, item)

const releaseKey = <T extends ActiveModel>(state: State<T>, item: T) => {
  const key = state.itemKey.get(item)
  state.itemKey.delete(item)
  if (state.keys.get(key) === item) {
    state.keys.delete(key)
  }
}

/** An item changed: follow its unique key (unless taken), and bubble the change */
const onItemTouched = <T extends ActiveModel>(state: State<T>, item: T) => {
  if (state.uniqueKey) {
    const previous = state.itemKey.get(item)
    const key = state.uniqueKey(item)
    if (!Object.is(previous, key)) {
      if (state.keys.get(previous) === item) {
        state.keys.delete(previous)
      }
      state.itemKey.set(item, key)
      if (!isNilKey(key) && !state.keys.has(key)) {
        state.keys.set(key, item)
      }
    }
  }
  emit(state, EventType.touched, { target: state.self })
}

/**
 * A `Set` of one model's instances - and nothing else can get in. Identity decides duplicates; with the
 * `unique` option no two items may also share a key.
 *
 * Emits `itemsAdded`, `itemsRemoved` and `touched` (also when an item changes), so it bubbles into a parent
 * model like a nested model does. Create it with {@link ActiveSet.create}, or the `set` field option.
 */
export class ActiveSet<T extends ActiveModel = ActiveModel> extends Set<T> {
  /**
   * @param model - the only model class the set accepts
   * @param items - initial items (instances or, with `coerce`, plain data)
   * @param options - `unique` key and `coerce`
   */
  static create<M extends typeof ActiveModel> (
    this: typeof ActiveSet,
    model: M,
    items: Iterable<unknown> = [],
    options: SetOptions<InstanceType<M>> = {}
  ): ActiveSet<InstanceType<M>> {
    if (typeof model !== 'function' || !(model.prototype instanceof ActiveModel)) {
      throw new TypeError('ActiveSet.create() needs a class extending ActiveModel')
    }
    const set = new this() as ActiveSet<InstanceType<M>>
    states.set(set, {
      self: set,
      model,
      coerce: options.coerce ?? true,
      options,
      uniqueKey: keyFunction<InstanceType<M>>(options.unique),
      keys: new Map(),
      itemKey: new Map(),
      attached: new Map(),
    })
    registerCollection(set)
    set.addAll(items as Iterable<RecursivePartialActiveModel<InstanceType<M>>>)
    return set
  }

  /**
   * Describe a set field for `@ActiveField({ container })`: an assigned array or `Set` becomes an `ActiveSet`
   * of `model`, the default is an empty one.
   * @example
   * @ActiveField({ container: ActiveSet.field(Tag, { unique: 'name' }) }) tags!: ActiveSet<Tag>
   */
  static field<M extends typeof ActiveModel> (
    this: typeof ActiveSet,
    model: M,
    options: SetOptions<InstanceType<M>> = {}
  ): ContainerSpec<ActiveSet<InstanceType<M>>> {
    return {
      model,
      wrap: (value) => wrapContainer(
        'set',
        model,
        value,
        (candidate) => candidate instanceof this && (candidate as ActiveSet).model === model,
        (items) => this.create(model, items, options),
        'an array'
      ),
    }
  }

  /** Subscribe to an event on every set of this class. */
  static on (event: EventType, cb: ActiveModelHookListener) {
    return useEmitter(this).addListener(event, cb)
  }

  /** Same as `on`, but the listener is removed after firing once. */
  static once (event: EventType, cb: ActiveModelHookListener) {
    return useEmitter(this).addListener(event, cb, true)
  }

  /** The model class this set accepts */
  get model (): typeof ActiveModel {
    return states.get(this)!.model
  }

  /** Subscribe to `itemsAdded`, `itemsRemoved` or `touched` on this set; returns an unsubscribe function. */
  on<E extends EventType> (event: E, cb: EventListener<E>): () => void {
    return useEmitter(this).addListener(event, cb as ActiveModelHookListener)
  }

  /** Same as `on`, but the listener is removed after firing once. */
  once<E extends EventType> (event: E, cb: EventListener<E>): () => void {
    return useEmitter(this).addListener(event, cb as ActiveModelHookListener, true)
  }

  /** Add one item (an instance, or plain data with `coerce`); adding what is already there is a no-op. */
  add (value: T | RecursivePartialActiveModel<T>): this {
    return this.addAll([value])
  }

  /** Add several items; nothing is added if any is refused or takes a unique key another item holds. */
  addAll (values: Iterable<T | RecursivePartialActiveModel<T>>): this {
    const state = states.get(this) as State<T> | undefined
    if (!state) {
      for (const value of values) {
        super.add(value as T)
      }
      return this
    }
    const fresh: T[] = []
    for (const value of values) {
      const item = normalizeItem<T>(state.model, state.coerce, 'ActiveSet', value)
      if (!SetProto.has.call(this, item) && !fresh.includes(item)) {
        fresh.push(item)
      }
    }
    if (state.uniqueKey) {
      const claimed = new Set<unknown>()
      for (const item of fresh) {
        const key = state.uniqueKey(item)
        if (isNilKey(key)) {
          continue
        }
        if (state.keys.has(key) || claimed.has(key)) {
          throw new ValidationError([{
            path: '',
            code: 'unique',
            message: `Duplicate key ${JSON.stringify(key)} in ActiveSet<${state.model.name}>`,
            value: key,
          }])
        }
        claimed.add(key)
      }
    }
    for (const item of fresh) {
      SetProto.add.call(this, item)
      if (state.uniqueKey) {
        const key = state.uniqueKey(item)
        state.itemKey.set(item, key)
        if (!isNilKey(key)) {
          state.keys.set(key, item)
        }
      }
      attach(state, item)
    }
    if (fresh.length > 0) {
      emit(state, EventType.itemsAdded, { target: this, items: fresh })
      emit(state, EventType.touched, { target: this })
    }
    return this
  }

  delete (item: T): boolean {
    const state = states.get(this) as State<T> | undefined
    if (!state) {
      return super.delete(item)
    }
    if (!SetProto.delete.call(this, item)) {
      return false
    }
    detach(state, item)
    releaseKey(state, item)
    emit(state, EventType.itemsRemoved, { target: this, items: [item] })
    emit(state, EventType.touched, { target: this })
    return true
  }

  clear (): void {
    const state = states.get(this) as State<T> | undefined
    if (!state) {
      super.clear()
      return
    }
    const items = Array.from(this)
    SetProto.clear.call(this)
    items.forEach((item) => {
      detach(state, item)
      releaseKey(state, item)
    })
    if (items.length > 0) {
      emit(state, EventType.itemsRemoved, { target: this, items })
      emit(state, EventType.touched, { target: this })
    }
  }

  /** The item that holds this unique key, in O(1) (needs the `unique` option) */
  getByKey (key: unknown): T | undefined {
    return this.uniqueState().keys.get(key)
  }

  /** Whether an item holds this unique key (needs the `unique` option) */
  hasKey (key: unknown): boolean {
    return this.uniqueState().keys.has(key)
  }

  private uniqueState (): State<T> {
    const state = states.get(this) as State<T>
    if (!state.uniqueKey) {
      throw new TypeError('getByKey/hasKey need a set created with unique')
    }
    return state
  }

  /** A deep copy: every item is cloned; the options are kept. */
  clone (): ActiveSet<T> {
    const state = states.get(this) as State<T>
    return (this.constructor as typeof ActiveSet).create(
      state.model,
      Array.from(this, (item) => item.clone()),
      state.options as SetOptions<any>
    ) as unknown as ActiveSet<T>
  }

  /** The items as plain data, like `JSON.stringify` would produce */
  toJSON (): object[] {
    return Array.from(this, (item) => item.toJSON() as object)
  }
}
