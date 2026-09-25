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
  type CollectionOptions,
  type ConstructorType,
  type HandlerMapTo,
  type MapTarget,
} from './types'
import cloneDeep from 'lodash-es/cloneDeep'
import cloneDeepWith from 'lodash-es/cloneDeepWith'
import deepEqual from 'fast-deep-equal/es6'
import { copyTrackingState, isSanitized, markSanitized, runRestoring, unmarkSanitized, useMeta } from './meta'
import {
  abortGroup,
  beginGroup,
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  clearHistory as clearHistoryStack,
  commitGroup,
  enableHistory,
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
import { useEmitter } from './emitter'
import { useMapper } from './mapper'
import { ActiveCollection } from './ActiveCollection'
import { isCollection } from './collectionRegistry'
import {
  ValidationError,
  canTransition as canTransitionFn,
  coerceValue,
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
  return (target: ActiveModel): Set<string | symbol> => {
    let written = registry.get(target)
    if (!written) {
      written = new Set()
      registry.set(target, written)
    }
    return written
  }
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

/** The pristine copy a tracked model keeps for `changes()` / `revert()` (as its raw object) */
const baselineOf = (model: ActiveModel): ActiveModel => {
  const baseline = useMeta(model).getBaseline()
  if (!baseline) {
    throw new TypeError('changes() and revert() need a model created with create(data, { tracked: true })')
  }
  return rawOf.get(baseline) ?? baseline
}

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
        validator(model, String(prop), value)
      } catch (error) {
        issues.push({ path, code: 'validator', message: (error as Error).message, value })
      }
    }

    const isList = isCollection(value) || Array.isArray(value)
    const items = isList ? Array.from(value as Iterable<unknown>) : [value]
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
   * `emit()` (see the internal-only `useEmitter()` calls throughout this
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
   * constructor itself, which `useEmitter()`'s `getListeners()` merges in as
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
    const written = getFillableWritten(instance)
    for (const prop of activeFields) {
      if (!this.fieldIsFillable(prop)) {
        written.add(prop)
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
        message: `"${String(prop)}" cannot be converted to ${config.coerce}, got ${JSON.stringify(normalized)}`,
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

    return Array.isArray(instance)
      ? instance.map((i) => this.toJSON(i))
      : Object.keys(instance).reduce(
        (a: { [key: string]: unknown }, b: string) => {
          // getters receive the raw instance, exactly like on a regular read
          const source = rawOf.get(instance) ?? instance
          // @ts-ignore
          const value =
            // Stryker disable next-line OptionalChaining: plain objects have no getter() - covered by the plain-structure toJSON test
            (<typeof ActiveModel>instance.constructor)?.getter?.(
              source as ActiveModel,
              b
            ) ?? Reflect.get(source, b)
          if (!isPOJOSSafetyValue(value)) {
            return a
          }
          a[b] = value
          if (
            // Stryker disable next-line ConditionalExpression,LogicalOperator: recursing into null/primitives returns them unchanged
            (typeof a[b] === 'object' && a[b] !== null) ||
            Array.isArray(a[b])
          ) {
            a[b] = this.toJSON(a[b] as object)
          }
          return a
        },
        {}
      )
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
      data = {}
    }

    if (Array.isArray(data)) {
      throw new TypeError(
        `${this.name}.create() expects an object, got an array - use ${this.name}.createFromCollection()`
      )
    }

    const {
      saveInitialState,
      setInstance,
      saveRaw,
      saveBaseline,
      runInCreatingContext,
      runRawConstruction
    } = useMeta()

    return runInCreatingContext(() => {
      if ((opts.sanitize ?? true) && !isSanitized(data)) {
        data = this.sanitize(data as object)
      }
      // The raw instance is built *before* it is wrapped in the proxy, so
      // class-field initializers run unintercepted, ahead of fill().
      const raw = runRawConstruction(() => new this())
      this.sealNonFillable(raw)
      const model = this.wrap(raw)

      setInstance(model)

      if (opts.tracked) {
        // the source exactly as it was passed in - before defaults are added and non-fillable keys stripped
        saveRaw(data)
      }

      this.fill(model, this.stripNonFillable(this.setDefaultAttributes(data)))

      if (opts.tracked) {
        saveInitialState(model)
        saveBaseline(model.clone())
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
      useEmitter(raw).emit(EventType.created, { target: model })

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
   * An `ActiveCollection` of this model: an array that accepts instances of this model and nothing
   * else, optionally kept sorted (`sortBy` / `compare`).
   * @example
   * const orders = Order.collection([{ id: 2 }, { id: 1 }], { sortBy: 'id' })
   */
  static collection<T extends typeof ActiveModel> (
    this: T,
    items: Iterable<unknown> = [],
    options: CollectionOptions<InstanceType<T>> = {}
  ): ActiveCollection<InstanceType<T>> {
    return ActiveCollection.create(this, items, options)
  }

  /**
   * Like `createFromCollection`, but returns an `ActiveCollection`: every item goes through
   * `create()` (with `lazy` / `sanitize` / `tracked`), then into a collection with the given
   * `sortBy` / `compare` / `order` / `coerce`.
   */
  static createCollection<T extends typeof ActiveModel> (
    this: T,
    data: Iterable<unknown> = [],
    options: FactoryOptions & CollectionOptions<InstanceType<T>> = {}
  ): ActiveCollection<InstanceType<T>> {
    const { lazy, sanitize, tracked, ...collectionOptions } = options
    const items = this.createFromCollection(Array.from(data) as any[], { lazy, sanitize, tracked })
    return ActiveCollection.create(this, items, collectionOptions as CollectionOptions<InstanceType<T>>)
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
   * @param force
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
      if (!ownFields.has(prop) && !force) {
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
    for (const p of getReadonlyWritten(source)) getReadonlyWritten(copy).add(p)
    for (const p of getFillableWritten(source)) getFillableWritten(copy).add(p)
    const model = Ctor.wrap(copy)
    copyTrackingState(this, model)
    Ctor.bindNestedModels(copy, model)
    return model
  }

  /** A copy of a field value that shares nothing with the original (nested models and collections are cloned) */
  protected static cloneValue<V> (value: V): V {
    return cloneDeepWith({ value }, this.cloneCustomizer.bind(this)).value
  }

  /** Every declared field of `raw` with a private copy of its value - what `transaction()` rolls back to */
  protected static snapshot (raw: ActiveModel): Map<string | symbol, unknown> {
    const taken = new Map<string | symbol, unknown>()
    for (const prop of this.fieldNames()) {
      taken.set(prop, this.cloneValue(Reflect.get(raw, prop)))
    }
    return taken
  }

  /** Write a `snapshot()` back through the proxy, only where the value differs, skipping rules and transitions */
  protected static restore (raw: ActiveModel, model: ActiveModel, snapshot: Map<string | symbol, unknown>): void {
    runRestoring(() => {
      for (const [prop, value] of snapshot) {
        if (!deepEqual(Reflect.get(raw, prop), value)) {
          Reflect.set(model, prop, value)
        }
      }
    })
  }

  /**
   * Re-subscribe `target` to the `touched` of the model(s) now stored under `prop`,
   * so a change deep inside a nested model bubbles up as a `touched` of the parent.
   */
  protected static bindChildren (target: ActiveModel, prop: string | symbol, receiver: unknown) {
    let byProp = childSubscriptions.get(target)
    if (!byProp) {
      byProp = new Map()
      childSubscriptions.set(target, byProp)
    }
    byProp.get(prop)?.forEach((off) => off())
    // Stryker disable next-line all: the entry is rewritten or unused after the unsubscribe above
    byProp.delete(prop)

    const stored = Reflect.get(target, prop)
    const children: Array<{ on: (event: EventType, cb: () => void) => () => void }> = isCollection(stored)
      ? [stored]
      : (Array.isArray(stored) ? stored : [stored]).filter(
        (child): child is ActiveModel => child instanceof ActiveModel
      )
    // Stryker disable next-line all: early exit, binding an empty list is a no-op
    if (children.length === 0) {
      return
    }
    byProp.set(prop, children.map((child) => child.on(EventType.touched, () => {
      if (bubbling.has(target)) {
        return
      }
      bubbling.add(target)
      try {
        useEmitter(target).emit(EventType.touched, { target: receiver })
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
        const { isNotCreating, isRestoring } = useMeta()
        const Ctor: typeof ActiveModel = <typeof ActiveModel>target.constructor
        const restoring = isRestoring()
        const oldValue = Reflect.get(target, prop, receiver)

        if (!Ctor.isActiveField(prop)) {
          if (Ctor.strict && !restoring && typeof prop === 'string' && !(prop in target)) {
            throw new TypeError(`Unknown property "${prop}" on ${Ctor.name}: declare it with @ActiveField() (strict model)`)
          }
          return Reflect.set(target, prop, value, receiver)
        }

        if (Object.is(oldValue, value)) {
          // same value as before: nothing to validate, store or announce
          return Reflect.set(target, prop, value, receiver)
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
            if (pipeline.transitions && isNotCreating() && !canTransitionFn(pipeline.transitions, oldValue, next)) {
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
          Ctor.resolveValidator(prop)?.(target, prop as string, next)
        }

        if (markFillable) {
          getFillableWritten(target).add(prop)
        }
        if (markReadonly) {
          getReadonlyWritten(target).add(prop)
        }

        useEmitter(target).emit(EventType.beforeSetValue, {
          target,
          prop,
          value: next,
          oldValue,
        })

        const result =
          Ctor.resolveSetter(prop)?.(target, prop as string, next, receiver) ??
          Reflect.set(target, prop, next, receiver)
        useEmitter(target).emit(EventType.afterSetValue, {
          target,
          prop,
          value: next,
          oldValue,
        })

        // nullabling definition
        if (!isNull(oldValue) && isNull(next)) {
          useEmitter(target).emit(EventType.nulling, {
            target,
            prop,
            value: next,
            oldValue,
          })
        }

        if (!restoring && isNotCreating()) {
          recordChange(target, { prop, from: oldValue, to: Reflect.get(target, prop) })
        }

        // only a write that actually went through counts as a change
        Ctor.bindChildren(target, prop, receiver)
        if (isNotCreating()) {
          useEmitter(target).emit(EventType.touched, { target: receiver })
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

        useEmitter(target).emit(EventType.beforeDeletingAttribute, { target, prop })

        return Reflect.deleteProperty(target, prop)
      },
      defineProperty (target, prop, descriptor) {
        if (frozenModels.has(target)) {
          throw new TypeError(`Cannot define "${String(prop)}": the model is frozen (makeFreeze)`)
        }
        return Reflect.defineProperty(target, prop, descriptor)
      },
      has (target, prop: string | symbol) {
        return !isHiddenAndConcealable(target, prop) && Reflect.has(target, prop)
      },
      getOwnPropertyDescriptor (target, prop) {
        return isHiddenAndConcealable(target, prop)
          ? undefined
          : Reflect.getOwnPropertyDescriptor(target, prop)
      },
      ownKeys (target) {
        const Ctor = <typeof ActiveModel>target.constructor
        const getters = Ctor.getGetters() as Array<string | symbol>
        return Array.from(
          new Set(Reflect.ownKeys(target).concat(getters))
        ).filter((property) => !Ctor.fieldIsHidden(property as string))
      },
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
   * fields it puts back. Nested models are restored as fresh copies, so a reference you kept to
   * the old nested instance goes stale. With `history` enabled the whole transaction is ONE undo step.
   * @example
   * order.transaction((o) => {
   *   o.start = new Date('2026-05-10')
   *   o.end = new Date('2026-05-01')   // violates the invariant: everything is rolled back
   * })
   */
  transaction<T> (fn: (model: this) => T): T {
    const raw = rawOf.get(this) ?? this
    const Ctor = <typeof ActiveModel>raw.constructor
    const snapshot = Ctor.snapshot(raw)
    const rollback = () => {
      abortGroup(raw)
      Ctor.restore(raw, this, snapshot)
    }

    beginGroup(raw)
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
    for (const prop of Ctor.fieldNames()) {
      const before = Reflect.get(baseline, prop)
      const now = Reflect.get(raw, prop)
      if (!deepEqual(before, now)) {
        changed[String(prop)] = { from: Ctor.cloneValue(before), to: now }
      }
    }
    return changed
  }

  /** Names of the fields that differ from their initial value (see `changes()`) */
  dirtyFields (): string[] {
    return Object.keys(this.changes())
  }

  /** Whether one field differs from its initial value (see `changes()`) */
  isDirty (prop: string): boolean {
    return prop in this.changes()
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
    const props = prop === undefined ? this.dirtyFields() : [prop]
    runRestoring(() => {
      for (const name of props) {
        const before = Reflect.get(baseline, name)
        if (!deepEqual(before, Reflect.get(raw, name))) {
          Reflect.set(this, name, Ctor.cloneValue(before))
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
    const { getRaw } = useMeta(this)
    return getRaw()
  }

  /**
   *  Return touched state of model
   */
  isTouched () {
    const { isTouched } = useMeta(this)
    return isTouched()
  }

  constructor (data: ActiveModelSource = {}) {
    const { consumeRawConstruction, runInCreatingContext } = useMeta()
    const Ctor = <typeof ActiveModel>this.constructor
    if (consumeRawConstruction()) {
      return this
    }

    if (isPrimitiveValue(data)) {
      data = {}
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
      useEmitter(this).emit(EventType.created, { target: filled })
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
