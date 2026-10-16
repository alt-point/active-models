import {
  type ActiveModelSource,
  type AnyClassInstance,
  type FactoryOptions,
  type Getter,
  type Setter,
  StaticContainers as SC,
  type Validator,
  EventType,
  type ActiveModelHookListener,
  type EventListener,
  type ConstructorType,
  type HandlerMapTo,
  type MapTarget,
} from './types'
import { cloneDeep, cloneDeepWith } from './clone'
import { deepEqual } from './equal'
import { isImmutable } from './scalars/immutable'
import { beginJournal, commitJournal, isJournaling, journal, rollbackJournal, setParent } from './journal'
import {
  consumeRawConstruction,
  copyTrackingState,
  getBaseline,
  isShallow,
  getRaw as getRawData,
  isCreating,
  isRestoring,
  isSanitized,
  markSanitized,
  runInCreatingContext,
  runRawConstruction,
  runRestoring,
  saveBaseline,
  saveRaw,
  unmarkSanitized,
} from './meta'
import {
  abortGroup,
  beginGroup,
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  clearHistory as clearHistoryStack,
  commitGroup,
  enableHistory,
  hasHistory,
  recordChange,
  step as stepHistory,
} from './history'
import {
  type ModelProperties,
  type RecursivePartialActiveModel,
  isComplexValue,
  isPrimitiveValue,
  getValue,
  traverse,
  isNull,
  isPOJOSSafetyValue,
} from './utils'
import { emit, useEmitter } from './emitter'
import { useMapper } from './mapper'
import { isCollection } from './collectionRegistry'
import {
  ValidationError,
  canTransition as canTransitionFn,
  coerceValue,
  describeKind,
  nextStates,
  ruleIssues,
  runTransforms,
  type PipelineConfig,
  type ValidationIssue,
  type ValidationResult,
} from './pipeline'

/**
 * proxy -> raw instance. Instance methods run with `this === proxy`, but state
 * that must include `hidden` fields (clone) has to be read from the raw object.
 */
const rawOf = new WeakMap<object, ActiveModel>()

/** raw instance -> its proxy (for code that holds the raw target but must write through the traps) */
const proxyOf = new WeakMap<object, ActiveModel>()

/** A model-level check: return `false` (or a message) when violated; throwing also counts */
export type InvariantCheck = (model: any) => boolean | string | void

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'

/**
 * Instances frozen by `makeFreeze()`; checked by the traps for a clear error.
 */
const frozenModels = new WeakSet<object>()

/** How a refused primitive source shows in the error: a string quoted, anything else via `String()` */
const describePrimitive = (value: unknown): string => typeof value === 'string' ? JSON.stringify(value) : String(value)

/** Keys that would swap the prototype or the class of an instance (e.g. from parsed JSON): never written. */
const unsafeKeys = new Set<string | symbol>(['__proto__', 'constructor'])

/**
 * Per parent instance: prop -> unsubscribe functions of the `touched`
 * listeners it holds on its nested models. Lets a replaced child stop
 * notifying the parent, and keeps repeated assignments from stacking listeners.
 */
const childSubscriptions = new WeakMap<object, Map<string | symbol, Array<() => void>>>()

/** Parents currently re-emitting a bubbled `touched` (guards against reference cycles). */
const bubbling = new WeakSet<object>()

const makeWrittenTracker = () => {
  const registry = new WeakMap<ActiveModel, Set<string | symbol>>()
  const written = (target: ActiveModel): Set<string | symbol> => {
    let set = registry.get(target)
    if (!set) {
      set = new Set()
      registry.set(target, set)
    }
    return set
  }
  written.peek = (target: ActiveModel) => registry.get(target)
  return written
}


/**
 * Tracks which `readonly` fields have already received their one-time value,
 * per raw instance. A `readonly` field may be set exactly once — via the
 * `create()` factory or via `new Model(data)` — after that, any further
 * write (through `fill()` or direct assignment) is silently ignored.
 */
const getReadonlyWritten = makeWrittenTracker()

/**
 * Tracks which `fillable: false` fields have already received their one
 * (and only intended) write — the class-field initializer's own default,
 * which `new Model(data)` routes through this same proxy after `super()`
 * returns (see the `set` trap below). Any further write is blocked with a
 * throw, same as before this tracking existed — `create()`/`new Model(data)`
 * never let data claim this slot: non-fillable keys are stripped from the
 * incoming data before `fill()` ever sees them (see `stripNonFillable`).
 */
const getFillableWritten = makeWrittenTracker()

/** The baseline a tracked model keeps for `changes()` / `revert()` (a model as its raw object, or a shallow snapshot) */
const baselineOf = (model: ActiveModel): object => {
  const baseline = getBaseline(model)
  if (!baseline) {
    throw new TypeError('changes() and revert() need a model created with create(data, { tracked: true })')
  }
  return rawOf.get(baseline) ?? baseline
}

/** The issue of a `validator` that returned `false`; one that throws supplies its own message */
const refusedIssue = (path: string, value: unknown): ValidationIssue => ({
  path,
  code: 'validator',
  message: `"${path}" is invalid`,
  value,
})

/**
 * Every rule/validator problem of `model`, recursing into nested models and collections.
 * `seen` guards against reference cycles.
 */
const collectIssues = (model: ActiveModel, prefix: string, issues: ValidationIssue[], seen: WeakSet<object>) => {
  if (seen.has(model)) {
    return
  }
  seen.add(model)
  const Ctor = <typeof ActiveModel>model.constructor
  for (const prop of Ctor.fieldNames()) {
    const path = prefix ? `${prefix}.${String(prop)}` : String(prop)
    const value = Reflect.get(model, prop)
    const pipeline = Ctor.resolvePipeline(prop)

    if (pipeline) {
      issues.push(...ruleIssues(pipeline.rules, value, path, pipeline.coerce))
    }
    const validator = Ctor.resolveValidator(prop)
    if (validator && value !== undefined && value !== null) {
      try {
        if (validator(model, String(prop), value) === false) {
          issues.push(refusedIssue(path, value))
        }
      } catch (error) {
        issues.push({ path, code: 'validator', message: (error as Error).message, value })
      }
    }

    const isList = isCollection(value) || Array.isArray(value)
    let items = [value]
    if (isList) {
      // an ActiveMap iterates [key, item] pairs: walk its values
      items = Array.from(value instanceof Map ? (value as Map<unknown, unknown>).values() : (value as Iterable<unknown>))
    }
    items.forEach((item, index) => {
      if (item instanceof ActiveModel) {
        collectIssues(rawOf.get(item) ?? item, isList ? `${path}[${index}]` : path, issues, seen)
      }
    })
  }

  const proxy = proxyOf.get(model) ?? model
  for (const { name, check } of Ctor.getInvariants()) {
    try {
      const outcome = check(proxy)
      if (outcome === false || typeof outcome === 'string') {
        issues.push({ path: prefix, code: 'invariant', message: typeof outcome === 'string' ? outcome : `Invariant "${name}" is violated` })
      }
    } catch (error) {
      issues.push({ path: prefix, code: 'invariant', message: (error as Error).message })
    }
  }
}

/**
 * Class ActiveModel
 */
export class ActiveModel {
  /**
   * Subscribe to a lifecycle/field event on this instance. Implemented as a
   * getter (not a plain method) so that accessing it through the proxy - via
   * `Ctor.getter()`'s `Reflect.get(target, prop, target)` below - resolves
   * `this` to the raw target. That keeps the returned closure's `addListener`
   * keyed by the same raw object the `set`/`deleteProperty` traps use to
   * `emit()` (see the internal-only `emit()` calls throughout this
   * file) - a plain prototype method would instead bind `this` to the proxy
   * at call time (`model.on(...)` calls with `this === model`), which is a
   * *different* WeakMap key and would silently never see trap-emitted events.
   */
  get on () {
    const { addListener } = useEmitter(this)
    return <E extends EventType>(event: E, cb: EventListener<E>) => addListener(event, cb as ActiveModelHookListener)
  }

  /**
   * Same as `on`, but the listener is removed after firing once.
   * @see on
   */
  get once () {
    const { addListener } = useEmitter(this)
    return <E extends EventType>(event: E, cb: EventListener<E>) => addListener(event, cb as ActiveModelHookListener, true)
  }

  /**
   * Subscribe to a lifecycle/field event for *every* instance of this class
   * (subclasses' instances included), not just one. Registered against the
   * constructor itself, which `emit()` merges in as
   * "inherited" listeners for any instance of this class - the same
   * mechanism `@ActiveField({ on: {...} })` already uses internally.
   */
  static on<E extends EventType> (event: E, cb: EventListener<E>) {
    const { addListener } = useEmitter(this)
    return addListener(event, cb as ActiveModelHookListener)
  }

  /**
   * Same as `on`, but the listener is removed after firing once.
   * @see on
   */
  static once<E extends EventType> (event: E, cb: EventListener<E>) {
    const { addListener } = useEmitter(this)
    return addListener(event, cb as ActiveModelHookListener, true)
  }

  protected static defineStaticProperty (
    propertyName: SC,
    fallback: () => unknown
  ) {
    // @ts-ignore
    this[propertyName] = Object.prototype.hasOwnProperty.call(this, propertyName)
      ? this[propertyName]!
      : fallback()
    return this
  }

  protected static setDefaultAttributes (
    data: AnyClassInstance
  ): Partial<InstanceType<typeof this>> {
    const attributes: Record<string, unknown> = this[SC.__attributes__]
      // Stryker disable next-line all: defensive fallbacks for a class with no defaults
      ? Object.fromEntries(this[SC.__attributes__]?.entries() || [])
      : {}
    for (const prop in attributes) {
      // Stryker disable next-line ConditionalExpression: attributes is a plain object built just above
      if (Object.prototype.hasOwnProperty.call(attributes, prop)) {
        if (Reflect.has(data, prop)) {
          continue
        }

        // Stryker disable next-line OptionalChaining: attributes is never undefined here
        const declared = attributes?.[prop]
        let value = getValue(declared)
        // Stryker disable next-line ConditionalExpression,LogicalOperator: a factory result is already fresh; cloning it again is invisible
        if (typeof declared !== 'function' && isComplexValue(value)) {
          // a plain `value: []` is one shared object - give every instance its own copy
          value = value instanceof ActiveModel ? value.clone() : cloneDeep(value)
        }
        if (isComplexValue(value)) {
          markSanitized(value)
        }
        data[prop] = value
      }
    }
    return data
  }

  /**
   * Remove keys for `fillable: false` fields from incoming data before it
   * ever reaches `fill()`. Without this, a `fillable: false` field's ONLY
   * legitimate write - its own class-field initializer's default, which
   * `new Model(data)` routes through this proxy after `super()` returns -
   * would lose a race against attacker-supplied `data`, since the data-fill
   * always runs first (see the `set` trap's fillable-tracking comment).
   */
  protected static stripNonFillable (
    data: AnyClassInstance
  ): Partial<InstanceType<typeof this>> {
    for (const prop in data) {
      if (this.isActiveField(prop) && !this.fieldIsFillable(prop)) {
        delete data[prop]
      }
    }
    return data
  }

  /**
   * `create()` constructs the raw instance *before* wrapping it in a proxy
   * (see `create()` below), specifically so class-field initializers run
   * unintercepted. That means a `fillable: false` field's default is
   * established here, outside the proxy - the `set` trap's write-once
   * tracking never sees it happen and would otherwise treat a later direct
   * assignment as the still-open "first" write. Mark every non-fillable
   * field as already-written right after raw construction so the trap
   * correctly blocks any write to it from this point on.
   */
  protected static sealNonFillable (instance: InstanceType<typeof this>): void {
    const activeFields = this[SC.__activeFields__]
    if (!activeFields) {
      return
    }
    for (const prop of activeFields) {
      if (!this.fieldIsFillable(prop)) {
        getFillableWritten(instance).add(prop)
      }
    }
  }

  protected static fieldIsReadOnly (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__readonly__]?.has(prop) ?? false
  }

  protected static fieldIsHidden (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__hidden__]?.has(prop) ?? false
  }

  /** The own enumerable string keys of a raw instance without its `hidden` fields: what `Object.keys(model)` reports */
  protected static visibleKeys (raw: ActiveModel): string[] {
    const hidden = this[SC.__hidden__]
    const keys = Object.keys(raw)
    return hidden ? keys.filter((key) => !hidden.has(key)) : keys
  }

  protected static fieldIsFillable (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__fillable__]?.has(prop) ?? false
  }

  protected static fieldIsProtected (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): boolean {
    return this[SC.__protected__]?.has(prop) ?? false
  }

  protected static getter<Result = unknown> (
    target: ActiveModel,
    prop: string | keyof InstanceType<typeof this> | symbol,
    receiver?: ActiveModel
  ): Result {
    const Ctor = <typeof ActiveModel>target.constructor
    // Stryker disable next-line OptionalChaining: every model class has resolveGetter
    const resolvedGetter = Ctor?.resolveGetter?.(prop)
    return (
      resolvedGetter?.(target, prop as string, receiver) ??
      // Bind the receiver to `target` (not the proxy) so that accessing
      // built-in getters (e.g. `on`/`once`) through the proxy resolves `this`
      // to the same raw instance the internal set/delete traps use to emit
      // events (via the internal-only `useEmitter(target)`). Otherwise
      // `model.on(...)` would register against the proxy while trap code
      // emits against the raw target, and the listener would never see it.
      Reflect.get(target, prop, target)
    )
  }

  protected static [SC.__getters__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    Getter<InstanceType<typeof this>>
  >
  protected static [SC.__setters__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    Setter<InstanceType<typeof this>>
  >
  protected static [SC.__attributes__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    any
  >
  protected static [SC.__validators__]?: Map<
    string | keyof InstanceType<typeof this> | symbol,
    Validator<any>
  >
  protected static [SC.__fillable__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__protected__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__readonly__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__hidden__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__activeFields__]?: Set<
    string | keyof InstanceType<typeof this> | symbol
  >
  protected static [SC.__pipeline__]?: Map<string | symbol, PipelineConfig>
  protected static [SC.__invariants__]?: Array<{ name: string, check: InvariantCheck }>

  /**
   * A strict model refuses writes to properties that are neither declared with `@ActiveField()`
   * nor already present (so `model.typo = 1` throws instead of silently adding a property).
   * Build strict models with `create()`: `new Model(data)` routes undeclared class-field
   * initializers through the same check.
   */
  static strict: boolean = false

  /**
   * Add field name to hidden scope
   * @param prop
   */
  static addToHidden (
    ...prop: Array<string | keyof InstanceType<typeof this> | symbol>
  ): void {
    this.defineStaticProperty(
      SC.__hidden__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Set(this[SC.__hidden__] || [])
    )
    prop.forEach((p) => this[SC.__hidden__]!.add(p))
  }

  /**
   * add properties to fields
   * @param prop
   */
  static addToFields (
    ...prop: Array<string | keyof InstanceType<typeof this> | symbol>
  ): void {
    this.defineStaticProperty(
      SC.__activeFields__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Set(this[SC.__activeFields__] || [])
    )
    prop.forEach((p) => this[SC.__activeFields__]!.add(p))
  }

  /** Names of the declared fields (`@ActiveField()`), hidden ones included */
  static fieldNames (): Array<string | symbol> {
    return [...(this[SC.__activeFields__] ?? [])] as Array<string | symbol>
  }

  /**
   * check property is active field
   * @param prop
   * @protected
   */
  protected static isActiveField (
    prop: string | keyof InstanceType<typeof this> | symbol
  ) {
    // Stryker disable next-line BooleanLiteral: covered by the field-less model test; Stryker cannot re-run class-definition code
    return this?.__activeFields__?.has(prop) ?? false
  }

  /**
   *  Add field name to readonly scope
   * @param prop
   */
  static addToReadonly (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__readonly__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Set(this[SC.__readonly__] || [])
    )
    this.__readonly__!.add(prop)
  }

  /**
   * Add field name to protected scope
   * @param prop
   */
  static addToProtected (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__protected__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Set(this[SC.__protected__] || [])
    )
    this[SC.__protected__]!.add(prop)
  }

  /**
   * Add field name to fillable scope
   * @param prop
   */
  static addToFillable (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__fillable__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Set(this[SC.__fillable__] || [])
    )
    this[SC.__fillable__]!.add(prop)
  }

  /**
   * define getter
   * @param prop
   * @param handler
   */
  static defineGetter (
    prop: string | keyof InstanceType<typeof this> | symbol,
    handler: Getter<any>
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__getters__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Map(this[SC.__getters__] || [])
    )
    this[SC.__getters__]!.set(prop, handler)
  }

  /**
   * resolve getter
   * @param prop
   */
  static resolveGetter (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): Getter<any> | undefined {
    const getter = this[SC.__getters__]?.get(prop)
    return getter?.bind(this)
  }

  /**
   * define setter for field by name
   * @param prop
   * @param handler
   */
  static defineSetter (
    prop: string | keyof InstanceType<typeof this> | symbol,
    handler: Setter<any>
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__setters__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Map(this[SC.__setters__] || [])
    )
    this[SC.__setters__]!.set(prop, handler)
  }

  /**
   * resolve setter for field by name
   * @param prop
   */
  protected static resolveSetter (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): Setter<any> | undefined {
    const setter = this[SC.__setters__]?.get(prop)
    return setter?.bind(this)
  }

  /**
   *  Define validator for field by name
   * @param prop
   * @param handler
   */
  static defineValidator (
    prop: string | keyof InstanceType<typeof this> | symbol,
    handler: Validator<any>
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__validators__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Map(this[SC.__validators__] || [])
    )
    this[SC.__validators__]!.set(prop, handler)
  }

  /**
   * Resolve validator for field by name
   * @param prop
   */
  static resolveValidator (
    prop: string | keyof InstanceType<typeof this> | symbol
  ): Validator<any> | undefined {
    const validator = this[SC.__validators__]?.get(prop)
    return validator?.bind(this)
  }

  /**
   * Define the write pipeline (normalizers, coercion, rules, transitions) of a field
   * @param prop
   * @param config
   */
  static definePipeline (
    prop: string | symbol,
    config: PipelineConfig
  ): void {
    this.addToFields(prop)
    // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code, killed by the option-inheritance tests
    this.defineStaticProperty(SC.__pipeline__, () => new Map(this[SC.__pipeline__] || []))
    this[SC.__pipeline__]!.set(prop, config)
  }

  /**
   * Declare a model-level rule that involves several fields (`end >= start`). It can't hold between two
   * writes, so it is checked by `validate()`, `assertValid()`, `create(data, { validate: true })`,
   * `transaction()` and atomic `fill()` - not on every write. Return `false` (or a message) when violated.
   * @param name - the name, and the default message
   * @param check - receives the model
   */
  static defineInvariant (name: string, check: InvariantCheck): void {
    // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code
    this.defineStaticProperty(SC.__invariants__, () => [...(this[SC.__invariants__] || [])])
    this[SC.__invariants__]!.push({ name, check })
  }

  /** The invariants declared on this model (and inherited ones) */
  static getInvariants (): ReadonlyArray<{ name: string, check: InvariantCheck }> {
    return this[SC.__invariants__] ?? []
  }

  /**
   * Resolve the write pipeline of a field
   * @param prop
   */
  static resolvePipeline (prop: string | symbol): PipelineConfig | undefined {
    return this[SC.__pipeline__]?.get(prop)
  }

  /**
   * Define attribute (default value) for field by name
   * @param prop
   * @param value
   */
  static defineAttribute (
    prop: string | keyof InstanceType<typeof this> | symbol,
    value: any
  ): void {
    // Stryker disable next-line CallExpression: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
    this.addToFields(prop)
    this.defineStaticProperty(
      SC.__attributes__,
      // Stryker disable next-line LogicalOperator,ArrayDeclaration: class-definition-time code: killed by the option-inheritance tests, but Stryker's runner cannot re-evaluate it
      () => new Map(this[SC.__attributes__] || [])
    )
    this[SC.__attributes__]!.set(prop, value)
  }

  /**
   * Normalizers and coercion of one write (the rules run separately, on the result)
   * @protected
   */
  protected static applyPipeline (
    target: ActiveModel,
    prop: string | symbol,
    config: PipelineConfig,
    value: unknown
  ): unknown {
    const normalized = runTransforms(config, value, target, String(prop))
    if (!config.coerce) {
      return normalized
    }
    const coerced = coerceValue(config.coerce, normalized)
    if (!coerced.ok) {
      throw new ValidationError([{
        path: String(prop),
        code: 'coerce',
        message: `"${String(prop)}" cannot be converted to ${describeKind(config.coerce)}, got ${JSON.stringify(normalized)}`,
        value: normalized,
      }])
    }
    return coerced.value
  }

  /**
   * Static method for converting to JSON
   */
  static toJSON (
    instance: object | object[] | ActiveModel | ActiveModel[]
  ): object | object[] {
    if (typeof instance !== 'object' || instance === null) {
      return instance
    }

    if (!(instance instanceof ActiveModel)) {
      // values that know how to serialize themselves (Date, URL, Buffer, ...)
      if (typeof (instance as { toJSON?: unknown }).toJSON === 'function') {
        return (instance as { toJSON: () => object }).toJSON()
      }
      if (instance instanceof Set) {
        return this.toJSON([...instance])
      }
      if (instance instanceof Map) {
        return this.toJSON(Object.fromEntries(instance))
      }
    }

    if (Array.isArray(instance)) {
      return instance.map((i) => this.toJSON(i))
    }
    // a model is read through its raw instance: getters still apply, the proxy's per-key traps don't run
    const Ctor = instance instanceof ActiveModel ? <typeof ActiveModel>instance.constructor : undefined
    const source = rawOf.get(instance) ?? instance
    const json: Record<string, unknown> = {}
    for (const key of Ctor ? Ctor.visibleKeys(source as ActiveModel) : Object.keys(instance)) {
      const value = Ctor ? Ctor.getter(source as ActiveModel, key) : Reflect.get(source, key)
      if (isPOJOSSafetyValue(value)) {
        // Stryker disable next-line ConditionalExpression,LogicalOperator: recursing into null/primitives returns them unchanged
        json[key] = typeof value === 'object' && value !== null ? this.toJSON(value as object) : value
      }
    }
    return json
  }

  /**
   * Convert current instance to JSON structure
   */
  toJSON () {
    return (<typeof ActiveModel>this.constructor).toJSON(this)
  }

  /**
   * Shallow-freeze the model: any later write, delete or defineProperty throws a TypeError.
   * Implemented by guarding the proxy traps rather than `Object.freeze()` - a
   * truly frozen target forces `ownKeys` to list every key, which would expose
   * `hidden` fields - so `Object.isFrozen(model)` still reports `false`.
   * Nested models/arrays are not frozen.
   * @return {Readonly<this>}
   */
  makeFreeze (): Readonly<this> {
    frozenModels.add(rawOf.get(this) ?? this)
    return this
  }

  /**
   * Sanitize input data
   * @param data
   * @return {*}
   */
  static sanitize (
    data: object | ActiveModel
  ): Partial<InstanceType<typeof this>> {
    const cloned = cloneDeepWith(data, this.cloneCustomizer.bind(this))

    // Stryker disable next-line all: marks only save a redundant clone
    traverse(cloned, (node) => {
      markSanitized(node)
    })

    return cloned
  }

  /**
   * Factory method for create new instance
   * @param data - source of creating
   * @param opts - options
   * @param {boolean} opts.lazy - without forced creating complex values; including current data
   * @param {boolean} opts.tracked - tracking model touched
   * @param {boolean} opts.sanitize - unlink all references to the model and complex values in its properties
   *
   * @example Basic usage
   *
   * ```typescript
   *
   * import { ActiveField, ActiveModel } from '@alt-point/active-models/src'
   *
   * class Car extends ActiveModel {
   *
   *    @ActiveField()
   *    chassis?: string = undefined
   *
   *    @ActiveField('Ivan')
   *    driver: string = 'Ivan'
   * }
   *
   * Car.create({ chassis: 'Porche' })
   *
   * ```
   */
  static create<T extends typeof ActiveModel> (
    this: T,
    data:
      | RecursivePartialActiveModel<ModelProperties<T>>
      | ActiveModelSource = {} as any,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): InstanceType<T> {
    if (data instanceof this && opts.lazy) {
      return data as InstanceType<T>
    }

    if (isPrimitiveValue(data)) {
      throw new TypeError(`${this.name}.create() expects an object, got ${describePrimitive(data)}`)
    }

    if (Array.isArray(data)) {
      throw new TypeError(
        `${this.name}.create() expects an object, got an array - use ${this.name}.createFromCollection()`
      )
    }

    return runInCreatingContext(() => {
      if ((opts.sanitize ?? true) && !isSanitized(data)) {
        data = this.sanitize(data as object)
      } else if (!isSanitized(data)) {
        // the lazy path: defaults and the non-fillable strip go into a copy, never into the caller's object
        data = { ...(data as object) }
      }
      // The raw instance is built *before* it is wrapped in the proxy, so
      // class-field initializers run unintercepted, ahead of fill().
      const raw = runRawConstruction(() => new this())
      this.sealNonFillable(raw)
      const model = this.wrap(raw)

      if (opts.tracked) {
        // the source exactly as it was passed in - before defaults are added and non-fillable keys stripped
        saveRaw(model, data)
      }

      this.fill(model, this.stripNonFillable(this.setDefaultAttributes(data)))

      if (opts.tracked === 'shallow') {
        saveBaseline(model, this.snapshotFields(raw), true)
      } else if (opts.tracked) {
        saveBaseline(model, model.clone())
      }
      if (opts.history) {
        enableHistory(raw, typeof opts.history === 'object' ? opts.history.limit : undefined)
      }

      // Stryker disable next-line all: only releases a WeakSet entry
      unmarkSanitized(data as object)

      if (opts.validate) {
        model.assertValid()
      }

      // Fires exactly once, synchronously, after this model - and,
      // transitively, every nested model a `factory` field created along the
      // way - is fully built. Nested factory fields are constructed
      // synchronously inside fill() above via their own create() call, so
      // their `created` has already fired: children emit before their parent,
      // purely from the order of a synchronous call stack. Emitted keyed by
      // `raw` - the same key every `on()`/`once()` subscription and every
      // trap-emitted event uses (see `Ctor.getter()`).
      emit(raw, EventType.created, { target: model })

      return model as InstanceType<T>
    })
  }

  /**
   * Create model from promise
   * @see create
   * @param {Promise<RecursivePartialActiveModel<ModelProperties<T>>} data
   * @param opts
   *
   * @example
   *
   * ```TypeScript
   * const carModel = await Car.asyncCreate( CarService.findOne(carId) )
   * ```
   */
  static async asyncCreate<T extends typeof ActiveModel> (
    this: T,
    data: Promise<
      RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource
    > = Promise.resolve({}) as any,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): Promise<InstanceType<T>> {
    return this.create(await data, opts)
  }

  /**
   * Call create with options.lazy = true
   * @see create
   * @param data
   * @param opts
   */
  static createLazy<T extends typeof ActiveModel> (
    this: T,
    data:
      | RecursivePartialActiveModel<ModelProperties<T>>
      | ActiveModelSource = {},
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): InstanceType<T> {
    return this.create<T>(data, {
      lazy: true,
      tracked: opts.tracked,
      sanitize: false,
    })
  }

  /**
   * Call create by awaited data result with options.lazy = true
   * @see create
   * @param data
   * @param opts
   */
  static async asyncCreateLazy<T extends typeof ActiveModel> (
    this: T,
    data: Promise<
      RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource
    > = Promise.resolve({}) as any,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Promise<InstanceType<T>> {
    return this.createLazy(await data, opts)
  }

  /**
   * Batch factory for creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollection<T extends typeof ActiveModel> (
    this: T,
    data: Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>,
    opts: FactoryOptions = { lazy: false, tracked: false, sanitize: true }
  ): Array<InstanceType<T>> {
    // only null/undefined items are skipped; every other item goes through create()
    return data
      .filter((item) => item !== null && item !== undefined)
      .map((item) => this.create(item as any, opts))
  }

  /**
   * Batch factory for lazy creating instance collection
   * @param data
   * @param opts
   */
  static createFromCollectionLazy<T extends typeof ActiveModel> (
    this: T,
    data: Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Array<InstanceType<T>> {
    return this.createFromCollection(data, {
      lazy: true,
      tracked: opts.tracked,
      sanitize: false,
    })
  }

  /**
   * Async batch factory for lazy creating instance collection by promise result
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollection<T extends typeof ActiveModel> (
    this: T,
    data: Promise<Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>>,
    opts: FactoryOptions = { lazy: false, tracked: false }
  ): Promise<Array<InstanceType<T>>> {
    return this.createFromCollection<T>(await data, opts)
  }

  /**
   * Async lazy creating collection of current model instance
   * @param data
   * @param opts
   */
  static async asyncCreateFromCollectionLazy<T extends typeof ActiveModel> (
    this: T,
    data: Promise<Array<InstanceType<T> | RecursivePartialActiveModel<ModelProperties<T>> | ActiveModelSource>>,
    opts: Pick<FactoryOptions, 'tracked'> = { tracked: false }
  ): Promise<Array<InstanceType<T>>> {
    return this.createFromCollectionLazy<T>(await data, opts)
  }

  /**
   * Filling data to **only own fields**
   * @param data
   * @param options
   */
  fill (data: ActiveModelSource, options: boolean | { force?: boolean, atomic?: boolean } = false): this {
    const { force = false, atomic = false } = typeof options === 'boolean' ? { force: options } : options
    const Ctor = <typeof ActiveModel>this.constructor
    const run = () => { Ctor.fill(this, Ctor.sanitize(data || {}), force) }
    if (atomic) {
      // all-or-nothing: any refused value (or violated invariant) rolls back everything already written
      this.transaction(run)
    } else {
      run()
    }
    return this
  }

  /**
   * Filling data to **only own fields** of instance
   * @param model
   * @param data
   * @param force - if need note detect property is fillable
   * @protected
   */
  protected static fill (
    model: InstanceType<typeof this>,
    data: Partial<InstanceType<typeof this>>,
    // Stryker disable next-line BooleanLiteral: every caller passes force explicitly
    force = false
  ): InstanceType<typeof this> {
    this.beforeFill(model, data)
    const ownFields = new Set([
      ...Reflect.ownKeys(model),
      // Stryker disable next-line OptionalChaining,ArrayDeclaration: a class with no fillable fields has no set
      ...(this?.__fillable__ || []),
    ])
    for (const prop in data) {
      if ((!ownFields.has(prop) && !force) || unsafeKeys.has(prop)) {
        continue
      }
      Reflect.set(model, prop, Reflect.get(data, prop))
    }
    return model
  }

  /**
   * static hook then calling before fill
   * @param _model
   * @param _data
   */
  static beforeFill (
    _model: InstanceType<typeof this>,
    _data: Partial<InstanceType<typeof this>>
  ) {
    //
  }

  /**
   * Clone current instance with unlinked references. The clone is a fully
   * working model (proxied, `hidden` fields included, `readonly`/`fillable: false`
   * locks and the `isTouched()` baseline carried over); instance-level
   * listeners are not copied and no `created` event is emitted for it.
   */
  clone (): this {
    const Ctor = <typeof ActiveModel>this.constructor
    const source = rawOf.get(this) ?? this
    const copy = cloneDeepWith(source, Ctor.cloneCustomizer.bind(Ctor))
    getReadonlyWritten.peek(source)?.forEach((p) => getReadonlyWritten(copy).add(p))
    getFillableWritten.peek(source)?.forEach((p) => getFillableWritten(copy).add(p))
    const model = Ctor.wrap(copy)
    copyTrackingState(this, model)
    if (isShallow(this)) {
      // the original's baseline holds its own references: the copy gets one around its values, each changed field kept changed
      const baseline = getBaseline(this)!
      const snapshot = Ctor.snapshotFields(copy)
      for (const prop of Ctor.fieldNames()) {
        const before = Reflect.get(baseline, prop)
        if (!Object.is(before, Reflect.get(source, prop))) {
          snapshot[prop] = Ctor.cloneValue(before)
        }
      }
      saveBaseline(model, snapshot, true)
    }
    Ctor.bindNestedModels(copy, model)
    return model as this
  }

  /** The `tracked: 'shallow'` baseline: the current value of every declared field, kept by reference */
  protected static snapshotFields (raw: ActiveModel): Record<string | symbol, unknown> {
    const snapshot: Record<string | symbol, unknown> = {}
    for (const prop of this.fieldNames()) {
      snapshot[prop] = Reflect.get(raw, prop)
    }
    return snapshot
  }

  /** How a tracked model's values are compared to its baseline: by reference with `tracked: 'shallow'`, by content otherwise */
  protected static equalityOf (model: ActiveModel): (a: unknown, b: unknown) => boolean {
    return isShallow(model) ? Object.is : (a, b) => deepEqual(a, b, this.sameContent)
  }

  /** A copy of a field value that shares nothing with the original (nested models and collections are cloned) */
  protected static cloneValue<V> (value: V): V {
    return cloneDeepWith({ value }, this.cloneCustomizer.bind(this)).value
  }

  /**
   * `deepEqual` hook of `isTouched()`, `changes()` and `revert()`: two models are compared as their raw
   * objects (no proxy trap runs) and without their `hidden` fields; any other pair is left to `deepEqual`.
   */
  protected static sameContent (a: object, b: object): boolean | undefined {
    const rawA = rawOf.get(a)
    const rawB = rawOf.get(b)
    return rawA && rawB ? ActiveModel.sameFields(rawA, rawB) : undefined
  }

  /** Whether two raw instances are of one class and hold equal values under every own key that is not `hidden` */
  protected static sameFields (a: ActiveModel, b: ActiveModel): boolean {
    const Ctor = <typeof ActiveModel>a.constructor
    if (Ctor !== b.constructor) {
      return false
    }
    const keys = Ctor.visibleKeys(a)
    return keys.length === Ctor.visibleKeys(b).length && keys.every((key) =>
      Object.prototype.hasOwnProperty.call(b, key) && deepEqual(Reflect.get(a, key), Reflect.get(b, key), ActiveModel.sameContent)
    )
  }

  /** The declared fields of `model` whose value differs from its baseline (see `changes()`) */
  protected static dirtyProps (model: ActiveModel): Array<string | symbol> {
    const raw = rawOf.get(model) ?? model
    const baseline = baselineOf(model)
    const same = this.equalityOf(model)
    return this.fieldNames().filter((prop) => !same(Reflect.get(baseline, prop), Reflect.get(raw, prop)))
  }

  /**
   * Re-subscribe `target` to the `touched` of the model(s) now stored under `prop`,
   * so a change deep inside a nested model bubbles up as a `touched` of the parent.
   */
  protected static bindChildren (target: ActiveModel, prop: string | symbol, receiver: unknown) {
    let byProp = childSubscriptions.get(target)
    if (byProp) {
      byProp.get(prop)?.forEach((off) => off())
      // Stryker disable next-line all: the entry is rewritten or unused after the unsubscribe above
      byProp.delete(prop)
    }

    const stored = Reflect.get(target, prop)
    if (typeof stored !== 'object' || stored === null) {
      return
    }
    const children: Array<{ on: (event: EventType, cb: () => void) => () => void }> = isCollection(stored)
      ? [stored]
      : (Array.isArray(stored) ? stored : [stored]).filter(
        (child): child is ActiveModel => child instanceof ActiveModel
      )
    // Stryker disable next-line all: early exit, binding an empty list is a no-op
    if (children.length === 0) {
      return
    }
    if (!byProp) {
      byProp = new Map()
      childSubscriptions.set(target, byProp)
    }
    const parent = proxyOf.get(target) ?? (receiver as object)
    children.forEach((child) => setParent(child, parent))
    byProp.set(prop, children.map((child) => child.on(EventType.touched, () => {
      if (bubbling.has(target)) {
        return
      }
      bubbling.add(target)
      try {
        emit(target, EventType.touched, { target: receiver })
      } finally {
        bubbling.delete(target)
      }
    })))
  }

  /** Subscribe a freshly cloned instance to the `touched` of its (already cloned) nested models. */
  protected static bindNestedModels (raw: ActiveModel, model: ActiveModel) {
    for (const prop of Reflect.ownKeys(raw)) {
      if (this.isActiveField(prop)) {
        this.bindChildren(raw, prop, model)
      }
    }
  }

  protected static cloneCustomizer (
    value: object | ActiveModel,
    _key: number | string | undefined,
    parent: unknown
  ): unknown {
    if (isImmutable(value)) {
      return value
    }
    if ((value instanceof ActiveModel || isCollection(value)) && Boolean(parent)) {
      return value.clone()
    }
  }

  /**
   * Get registered getters of current model
   */
  static getGetters (): Array<
    string | keyof InstanceType<typeof this> | symbol
  > {
    // Stryker disable next-line OptionalChaining,ArrayDeclaration: a class with no getters has no map
    return [...(this?.__getters__?.keys() ?? [])]
  }

  /**
   * Wrap an instance in a proxy for traps to work
   * @param { ActiveModel } instance Instance for wrapping
   */
  protected static wrap<RType extends ActiveModel> (instance: RType): RType {
    /**
     * `hidden` fields are concealed from `in` and descriptor lookups too - unless
     * the Proxy invariants forbid lying (non-configurable property / non-extensible
     * target, e.g. after makeFreeze()).
     */
    const isHiddenAndConcealable = (target: ActiveModel, prop: string | symbol): boolean => {
      if (!(<typeof ActiveModel>target.constructor).fieldIsHidden(prop as string)) {
        return false
      }
      if (!Object.isExtensible(target)) {
        return false
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(target, prop)
      return descriptor === undefined || descriptor.configurable === true
    }

    // shortcut: the traps that hide fields or list getters cost a call per key in Object.keys() / spread / `in`, so a
    // class with nothing to hide and no getters gets none; a field hidden with addToHidden() or a getter defined with
    // defineGetter() after an instance exists is not reflected on that instance
    const Ctor = <typeof ActiveModel>instance.constructor
    const conceals = Boolean(Ctor[SC.__hidden__]?.size)
    const listsGetters = Boolean(Ctor[SC.__getters__]?.size)
    const listKeys = (target: ActiveModel): Array<string | symbol> => {
      const keys = Reflect.ownKeys(target)
      // a non-extensible target must be reported exactly (Proxy invariant)
      if (!Object.isExtensible(target)) {
        return keys
      }
      for (const getter of Ctor[SC.__getters__]?.keys() ?? []) {
        if (!keys.includes(getter)) {
          keys.push(getter)
        }
      }
      const hidden = Ctor[SC.__hidden__]
      return hidden ? keys.filter((key) => !hidden.has(key)) : keys
    }

    const proxy = new Proxy(instance, {
      get (target, prop, receiver) {
        return (<typeof ActiveModel>target.constructor).getter(
          target,
          prop,
          receiver
        )
      },
      set (target, prop, value, receiver) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot assign to "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        const Ctor: typeof ActiveModel = <typeof ActiveModel>target.constructor
        const restoring = isRestoring()
        const creating = isCreating()
        const oldValue = Reflect.get(target, prop, receiver)

        if (!Ctor.isActiveField(prop)) {
          if (unsafeKeys.has(prop)) {
            return true
          }
          if (Ctor.strict && !restoring && typeof prop === 'string' && !(prop in target)) {
            throw new TypeError(`Unknown property "${prop}" on ${Ctor.name}: declare it with @ActiveField() (strict model)`)
          }
          return Reflect.set(target, prop, value, receiver)
        }

        if (Object.is(oldValue, value)) {
          // same value as before: nothing to validate, store or announce
          return Reflect.set(target, prop, value)
        }

        let markFillable = false
        if (!Ctor.fieldIsFillable(prop)) {
          if (getFillableWritten(target).has(prop)) {
            // A real, later write attempt (data can never reach here - see
            // stripNonFillable) - block it loudly, same as always.
            return false
          }
          // The one legitimate write: the class-field initializer's own default,
          // routed through this proxy by `new Model(data)` after `super()` returns.
          // It is recorded only once the value has passed every check below.
          markFillable = true
        }

        let markReadonly = false
        if (Ctor.fieldIsReadOnly(prop)) {
          if (getReadonlyWritten(target).has(prop)) {
            // Already set once (at creation, via factory or constructor) — locked.
            // Returning `true` (not `false`) is deliberate: `new Model(data)` wraps
            // `this` in the proxy and fills it *before* the subclass's own class-field
            // initializers run (they execute after `super()` returns, against the
            // now-proxy-bound `this`) — so the initializer's default-value assignment
            // lands here as a second write to the same prop. If this returned `false`,
            // that assignment (`this.id = <default>`) would throw under strict-mode
            // Proxy invariants and the constructor call would blow up. Silently
            // discarding the value instead lets construction complete normally while
            // still preserving the value written the first time.
            return true
          }
          // this is the one allowed write; recorded once it has passed every check
          markReadonly = true
        }

        let next = value
        if (!restoring) {
          // normalizers -> coercion -> (no change?) -> transition -> rules -> validator
          const pipeline = Ctor.resolvePipeline(prop)
          if (pipeline) {
            next = Ctor.applyPipeline(target, prop, pipeline, value)
            if (Object.is(oldValue, next)) {
              return true
            }
            if (pipeline.transitions && !creating && !canTransitionFn(pipeline.transitions, oldValue, next)) {
              throw new ValidationError([{
                path: String(prop),
                code: 'transition',
                message: `"${String(prop)}" cannot change from ${JSON.stringify(oldValue)} to ${JSON.stringify(next)}`,
                value: next,
              }])
            }
            const issues = ruleIssues(pipeline.rules, next, String(prop), pipeline.coerce)
            if (issues.length > 0) {
              throw new ValidationError(issues)
            }
          }
          if (Ctor.resolveValidator(prop)?.(target, prop as string, next) === false) {
            throw new ValidationError([refusedIssue(String(prop), next)])
          }
        }

        if (markFillable) {
          getFillableWritten(target).add(prop)
        }
        if (markReadonly) {
          getReadonlyWritten(target).add(prop)
        }

        emit(target, EventType.beforeSetValue, {
          target,
          prop,
          value: next,
          oldValue,
        })

        // shortcut: stored without the receiver, which halves a write (no round trip through the defineProperty
        // trap); a setter accessor declared as @ActiveField would get the raw instance as `this` - pass the
        // receiver again if such fields appear
        const result =
          Ctor.resolveSetter(prop)?.(target, prop as string, next, receiver) ??
          Reflect.set(target, prop, next)
        emit(target, EventType.afterSetValue, {
          target,
          prop,
          value: next,
          oldValue,
        })

        // nullabling definition
        if (!isNull(oldValue) && isNull(next)) {
          emit(target, EventType.nulling, {
            target,
            prop,
            value: next,
            oldValue,
          })
        }

        if (!restoring && !creating && hasHistory(target)) {
          recordChange(target, { prop, from: oldValue, to: Reflect.get(target, prop) })
        }

        // only a write that actually went through counts as a change
        Ctor.bindChildren(target, prop, receiver)
        if (!creating) {
          emit(target, EventType.touched, { target: receiver })
          if (isJournaling()) {
            // recorded after `touched`, so a rollback undoes this write before what a container holding the
            // model did in response (an ActiveMap puts a displaced entry back once its key is free again)
            const self = proxyOf.get(target)!
            journal(self, () => { Reflect.set(self, prop, oldValue) })
          }
        }
        return result
      },
      apply (target, thisArg, argumentsList) {
        return Reflect.apply(
          target as unknown as Function,
          thisArg,
          argumentsList
        )
      },
      deleteProperty (target, prop: string | symbol) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot delete "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        if ((<typeof ActiveModel>target.constructor).fieldIsProtected(prop)) {
          throw new TypeError(`Property "${prop as string}" is protected!`)
        }

        emit(target, EventType.beforeDeletingAttribute, { target, prop })

        if (isJournaling() && Object.prototype.hasOwnProperty.call(target, prop)) {
          const self = proxyOf.get(target)!
          const oldValue = Reflect.get(target, prop)
          journal(self, () => { Reflect.set(self, prop, oldValue) })
        }
        return Reflect.deleteProperty(target, prop)
      },
      defineProperty (target, prop, descriptor) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot define "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        return Reflect.defineProperty(target, prop, descriptor)
      },
      // an `undefined` trap is no trap: the operation goes straight to the target
      has: conceals
        ? (target, prop) => !isHiddenAndConcealable(target, prop) && Reflect.has(target, prop)
        : undefined,
      getOwnPropertyDescriptor: conceals
        ? (target, prop) => (isHiddenAndConcealable(target, prop) ? undefined : Reflect.getOwnPropertyDescriptor(target, prop))
        : undefined,
      ownKeys: conceals || listsGetters ? listKeys : undefined,
    }) as RType
    rawOf.set(proxy, instance)
    proxyOf.set(instance, proxy)
    return proxy
  }

  /**
   * Check the current state against every rule and validator, nested models and collections
   * included, and report **all** problems instead of stopping at the first. A field that was never
   * set is caught by `required`; validators run only for values that are set.
   * @example
   * const { valid, issues } = user.validate()
   * // issues: [{ path: 'address.city', code: 'required', message: '"address.city" is required' }]
   */
  validate (): ValidationResult {
    const issues: ValidationIssue[] = []
    collectIssues(rawOf.get(this) ?? this, '', issues, new WeakSet())
    return { valid: issues.length === 0, issues }
  }

  /**
   * Like `validate()`, but throws a `ValidationError` (its `issues` lists every problem) instead of returning them.
   */
  assertValid (): this {
    const { valid, issues } = this.validate()
    if (!valid) {
      throw new ValidationError(issues)
    }
    return this
  }

  /**
   * Whether the field's `transitions` allow it to change to `to` right now (`true` for a field without transitions).
   */
  canTransition (prop: string, to: unknown): boolean {
    const raw = rawOf.get(this) ?? this
    const transitions = (<typeof ActiveModel>raw.constructor).resolvePipeline(prop)?.transitions
    return transitions ? canTransitionFn(transitions, Reflect.get(raw, prop), to) : true
  }

  /**
   * The states the field may change to from its current value (all known states while it is not set).
   */
  allowedTransitions (prop: string): unknown[] {
    const raw = rawOf.get(this) ?? this
    const transitions = (<typeof ActiveModel>raw.constructor).resolvePipeline(prop)?.transitions
    return transitions ? nextStates(transitions, Reflect.get(raw, prop)) : []
  }

  /**
   * Run `fn` all-or-nothing: if it throws, or the model ends up invalid (a rule, a validator or an
   * invariant is violated), every field goes back to what it was and the error is rethrown - so no
   * caller ever sees a half-changed model. Returns what `fn` returns; an async `fn` is awaited.
   *
   * Events fire as the writes happen, and are not un-fired - the rollback emits its own for the
   * fields it puts back. Nested models and containers are restored in place (a reference you kept to
   * them stays valid; their own events fire and bubble up as `touched`). With `history` enabled the
   * whole transaction is ONE undo step.
   * @example
   * order.transaction((o) => {
   *   o.start = new Date('2026-05-10')
   *   o.end = new Date('2026-05-01')   // violates the invariant: everything is rolled back
   * })
   */
  transaction<T> (fn: (model: this) => T): T {
    const raw = rawOf.get(this) ?? this
    const self = proxyOf.get(raw) ?? this
    const rollback = () => {
      abortGroup(raw)
      runRestoring(() => rollbackJournal(self))
    }

    beginGroup(raw)
    beginJournal(self)
    let result: T
    try {
      result = fn(this)
    } catch (error) {
      rollback()
      throw error
    }

    const settle = (value: T): T => {
      const { valid, issues } = this.validate()
      if (!valid) {
        rollback()
        throw new ValidationError(issues)
      }
      commitGroup(raw)
      commitJournal(self)
      return value
    }

    if (isThenable(result)) {
      return result.then(
        (value) => settle(value as T),
        (error) => {
          rollback()
          throw error
        }
      ) as T
    }
    return settle(result)
  }

  /**
   * What changed since the model was created: `{ field: { from, to } }` for every field whose value
   * now differs from the one it had (nested models and lists are compared by content). `from` is a
   * copy. Needs a model created with `create(data, { tracked: true })`; `hidden` fields are included.
   */
  changes (): Record<string, { from: unknown, to: unknown }> {
    const raw = rawOf.get(this) ?? this
    const Ctor = <typeof ActiveModel>raw.constructor
    const baseline = baselineOf(this)
    const changed: Record<string, { from: unknown, to: unknown }> = {}
    for (const prop of Ctor.dirtyProps(this)) {
      changed[String(prop)] = { from: Ctor.cloneValue(Reflect.get(baseline, prop)), to: Reflect.get(raw, prop) }
    }
    return changed
  }

  /** Names of the fields that differ from their initial value (see `changes()`) */
  dirtyFields (): string[] {
    const raw = rawOf.get(this) ?? this
    return (<typeof ActiveModel>raw.constructor).dirtyProps(this).map(String)
  }

  /** Whether one field differs from its initial value (see `changes()`); only that field is compared */
  isDirty (prop: string): boolean {
    const raw = rawOf.get(this) ?? this
    const Ctor = <typeof ActiveModel>raw.constructor
    const baseline = baselineOf(this)
    return Ctor.isActiveField(prop) && !Ctor.equalityOf(this)(Reflect.get(baseline, prop), Reflect.get(raw, prop))
  }

  /**
   * Put one field - or, with no argument, every changed field - back to its initial value.
   * Bypasses rules and transitions (the initial value was valid) and emits the usual events.
   * Needs a model created with `create(data, { tracked: true })`.
   */
  revert (prop?: string): this {
    const raw = rawOf.get(this) ?? this
    const Ctor = <typeof ActiveModel>raw.constructor
    const baseline = baselineOf(this)
    if (prop !== undefined && !Ctor.isActiveField(prop)) {
      throw new TypeError(`"${prop}" is not a field of ${Ctor.name}`)
    }
    const props = prop === undefined ? Ctor.dirtyProps(this) : [prop]
    const shallow = isShallow(this)
    const same = Ctor.equalityOf(this)
    runRestoring(() => {
      for (const name of props) {
        const before = Reflect.get(baseline, name)
        if (!same(before, Reflect.get(raw, name))) {
          // a shallow baseline is compared by reference, so the kept value itself goes back - a copy would still read as changed
          Reflect.set(this, name, shallow ? before : Ctor.cloneValue(before))
        }
      }
    })
    return this
  }

  /** Put every changed field back to its initial value - shorthand for `revert()` */
  reset (): this {
    return this.revert()
  }

  /**
   * Undo the last change (a whole `transaction()` counts as one). Needs `create(data, { history: true })`.
   * @returns whether there was something to undo
   */
  undo (): boolean {
    return this.moveInHistory('undo')
  }

  /** Redo what `undo()` took back; any new write clears the redo steps. */
  redo (): boolean {
    return this.moveInHistory('redo')
  }

  canUndo (): boolean {
    return canUndoHistory(rawOf.get(this) ?? this)
  }

  canRedo (): boolean {
    return canRedoHistory(rawOf.get(this) ?? this)
  }

  /** Forget every undo and redo step */
  clearHistory (): void {
    clearHistoryStack(rawOf.get(this) ?? this)
  }

  private moveInHistory (direction: 'undo' | 'redo'): boolean {
    const raw = rawOf.get(this) ?? this
    return stepHistory(raw, direction, (prop, value) => {
      runRestoring(() => Reflect.set(this, prop, value))
    })
  }

  /**
   * The source data this model was created from, exactly as it was passed to
   * `create(data, { tracked: true })` - before defaults were applied and
   * non-fillable keys stripped. Deep-frozen; `undefined` for a model that was
   * not created tracked. A `clone()` carries it over.
   */
  getRaw (): Readonly<Record<string, unknown>> | undefined {
    return getRawData(this)
  }

  /**
   * Whether a non-`hidden` field (or, with `tracked: true`, the set of own keys) differs from what it was right after
   * creation; `undefined` for a model that was not created tracked.
   */
  isTouched (): boolean | undefined {
    const baseline = getBaseline(this)
    if (!baseline) {
      return undefined
    }
    const raw = rawOf.get(this) ?? this
    if (isShallow(this)) {
      const Ctor = <typeof ActiveModel>raw.constructor
      return Ctor.fieldNames().some((prop) => !Ctor.fieldIsHidden(prop) && !Object.is(Reflect.get(baseline, prop), Reflect.get(raw, prop)))
    }
    return !ActiveModel.sameFields(raw, (rawOf.get(baseline) ?? baseline) as ActiveModel)
  }

  constructor (data: ActiveModelSource = {}) {
    const Ctor = <typeof ActiveModel>this.constructor
    if (consumeRawConstruction()) {
      return this
    }

    if (isPrimitiveValue(data)) {
      throw new TypeError(`new ${Ctor.name}() expects an object, got ${describePrimitive(data)}`)
    }

    if (!isSanitized(data)) {
      data = Ctor.sanitize(data)
    }

    const model = Ctor.wrap(this)
    const filled = runInCreatingContext(() =>
      Ctor.fill(model, Ctor.stripNonFillable(Ctor.setDefaultAttributes(data)))
    )

    // Deferred, unlike create()'s synchronous emit: at this point in the
    // constructor, the subclass's own class-field initializers (e.g.
    // `prop: T = value`) have NOT run yet - per JS semantics, since this
    // constructor returns a different object (the proxy), they run *after*
    // this constructor body finishes, against the returned `filled`. A
    // microtask is the only point that's reliably after ALL of that
    // synchronous construction (constructor + every field initializer up the
    // prototype chain) has finished, since nothing here ever awaits -
    // firing synchronously here would be honest about "fill() is done" but
    // not about "this model is fully built".
    queueMicrotask(() => {
      // Keyed by the constructor's own raw `this`, not `filled`/the proxy -
      // see the comment on `Ctor.getter()` for why the two are different
      // WeakMap keys and only the raw one matches what `on()`/`once()` and
      // the traps use.
      emit(this, EventType.created, { target: filled })
    })

    return filled
  }

  /**
   * Define mapping handler for current model to target
   * @param target
   * @param handler
   */
  static mapTo<
    RT extends ConstructorType | unknown = unknown,
    T extends typeof ActiveModel = typeof ActiveModel
  > (
    this: T,
    target: RT extends MapTarget ? RT : MapTarget,
    handler: HandlerMapTo<T, RT extends ConstructorType ? InstanceType<RT> : unknown>
  ): void {
    const { setMapTo } = useMapper<RT, T>(this as T)
    setMapTo<RT extends ConstructorType ? InstanceType<RT> : unknown>(
      target,
      handler
    )
  }

  /**
   * Run mapping current instance to target
   * @param target
   * @param lazy
   * @param args
   */
  mapTo (target: MapTarget, lazy = true, ...args: unknown[]): MapTarget | this {
    const { mapTo, hasMapping } = useMapper(
      this.constructor as typeof ActiveModel
    )

    if (!hasMapping(target) && !lazy) {
      throw new Error(`Mapping for target not found`)
    }
    const handler = mapTo(target)
    return handler ? handler(this, ...args) as MapTarget : this.clone()
  }

  /**
   * Check model has mapping configuration for target
   * @param target
   */
  hasMapping (target: MapTarget) {
    const { hasMapping } = useMapper(this.constructor as typeof ActiveModel)
    return hasMapping(target)
  }

  /**
   * Check exist mapping for current model to target
   * @param target
   */
  static hasMapping<
    RT extends ConstructorType | unknown = unknown,
    T extends typeof ActiveModel = typeof ActiveModel
  > (this: T, target: RT extends MapTarget ? RT : MapTarget) {
    const { hasMapping } = useMapper<RT, T>(this as T)
    return hasMapping(target)
  }
}
