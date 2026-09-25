import { ActiveModel } from './ActiveModel'
import type {
  ActiveFieldDescriptor,
  ActiveModelHookListener,
  AttributeValue,
  FactoryConfig,
  PropEvent,
} from './types'
import { getValue } from './utils'
import { useEmitter } from './emitter'
import { ActiveCollection } from './ActiveCollection'
import { ActiveMap } from './ActiveMap'
import { ActiveSet } from './ActiveSet'
import { isPlainObject } from './collectionCore'
import { isCollection } from './collectionRegistry'
import type { FieldRules, PipelineConfig, Transform } from './pipeline'

const defaultOpts: ActiveFieldDescriptor = {
  fillable: true,
  protected: true,
  value: undefined,
}

export function GetterMethod (property: string) {
  return function (
    target: typeof ActiveModel,
    prop: string,
    descriptor: TypedPropertyDescriptor<any>
  ) {
    target.defineGetter(property, descriptor.value)
  }
}

export function SetterMethod (property: string) {
  return function (
    target: typeof ActiveModel,
    prop: string | symbol,
    descriptor: TypedPropertyDescriptor<any>
  ) {
    target.defineSetter(property, descriptor.value)
  }
}

/**
 * Declare a static method as a model-level invariant: it receives the model and returns `false`
 * (or a message) when violated. Checked by `validate()`, `transaction()` and atomic `fill()`.
 * @param message - shown when the method returns `false`
 * @example
 * @InvariantMethod('end must not be before start')
 * static endAfterStart (trip: Trip) { return trip.end >= trip.start }
 */
export function InvariantMethod (message: string) {
  return function (
    target: typeof ActiveModel,
    _prop: string,
    descriptor: TypedPropertyDescriptor<any>
  ) {
    target.defineInvariant(message, descriptor.value)
  }
}

export function isHidden () {
  return function (target: ActiveModel, prop: string) {
    ; (<typeof ActiveModel>target.constructor).addToHidden(prop)
  }
}

export function isFillable () {
  return function (target: ActiveModel, prop: string) {
    ; (<typeof ActiveModel>target.constructor).addToFillable(prop)
  }
}

export function isProtected () {
  return function (target: ActiveModel, prop: string) {
    ; (<typeof ActiveModel>target.constructor).addToProtected(prop)
  }
}

const validateModelType = (Model: typeof ActiveModel, prop: string) => {
  if (!Model) {
    throw new ReferenceError(
      `Missing required factory model for prop "${prop}"!`
    )
  }
  if (!(Model.prototype instanceof ActiveModel)) {
    console.warn(
      `Model factory for prop "${prop}" must be instanceof ActiveModel!`,
      Model
    )
    throw new Error(
      `Model factory for prop "${prop}" must be instanceof ActiveModel!`
    )
  }
}

const factoryDecorator = (
  target: ActiveModel,
  prop: string,
  factory?: FactoryConfig,
  _isOptional?: boolean
) => {
  if (!factory) {
    return
  }
  const Ctor = <typeof ActiveModel>target.constructor
  if (Array.isArray(factory)) {
    const [Model, DefaultValueFactory] = factory

    validateModelType(Model, prop)

    Ctor.defineSetter(prop, (m, p, v, r) => {
      if (Array.isArray(v)) {
        return Reflect.set(m, p, Model.createFromCollectionLazy(v), r)
      }

      const defaultValue = getValue(DefaultValueFactory)
      if (v && v !== defaultValue) {
        return Reflect.set(m, p, Model.createLazy(v), r)
      }

      return Reflect.set(m, p, defaultValue, r)
    })
    return
  }

  const Model = factory
  validateModelType(Model, prop)
  Ctor.defineSetter(prop, (m, p, v, r) => {
    const value = Array.isArray(v)
      ? Model.createFromCollectionLazy(v)
      : Model.createLazy(v)
    return Reflect.set(m, p, value, r)
  })
}

type ContainerKind = 'collection' | 'map' | 'set'

/**
 * Turn whatever is assigned to a `collection` / `map` / `set` field into the container:
 * an array/iterable becomes one, `null`/`undefined` an empty one, one of the same model stays as is.
 */
const toContainer = (kind: ContainerKind, Model: typeof ActiveModel, value: unknown, options?: any) => {
  const create = (items: Iterable<unknown>) =>
    kind === 'collection'
      ? ActiveCollection.create(Model, items, options)
      : kind === 'map'
        ? ActiveMap.create(Model, options, items)
        : ActiveSet.create(Model, items, options)

  const same = kind === 'collection' ? ActiveCollection : kind === 'map' ? ActiveMap : ActiveSet
  if (isCollection(value) && value instanceof same && (value as { model: unknown }).model === Model) {
    return value
  }
  if (value === null || value === undefined) {
    return create([])
  }
  if (kind === 'map' && value instanceof Map) {
    return create(Array.from(value.values()))
  }
  if (kind === 'map' && isPlainObject(value)) {
    return create(Object.values(value))
  }
  if (typeof value === 'object' && Symbol.iterator in value) {
    return create(value as Iterable<unknown>)
  }
  throw new TypeError(`A ${kind} of ${Model.name} expects ${kind === 'map' ? 'an array, a Map or an object' : 'an array'}, got ${typeof value}`)
}

const containerDecorator = (
  target: ActiveModel,
  prop: string,
  kind: ContainerKind,
  config: unknown,
  hasOwnDefault: boolean
) => {
  const [Model, options] = Array.isArray(config) ? config : [config, undefined]
  validateModelType(Model, prop)
  const Ctor = <typeof ActiveModel>target.constructor

  Ctor.defineSetter(prop, (m, p, v, r) => Reflect.set(m, p, toContainer(kind, Model, v, options), r))
  if (!hasOwnDefault) {
    Ctor.defineAttribute(prop, () => toContainer(kind, Model, undefined, options))
  }
}

const RULE_KEYS = ['required', 'type', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'oneOf'] as const

/**
 * Turn the declarative options of a field (normalizers, coercion, rules, transitions)
 * into its write pipeline; `undefined` when none was given.
 */
const buildPipeline = (options: ActiveFieldDescriptor): PipelineConfig | undefined => {
  const transforms: Transform[] = []
  if (options.trim) {
    transforms.push((value) => (typeof value === 'string' ? value.trim() : value))
  }
  if (options.lowercase) {
    transforms.push((value) => (typeof value === 'string' ? value.toLowerCase() : value))
  }
  if (options.uppercase) {
    transforms.push((value) => (typeof value === 'string' ? value.toUpperCase() : value))
  }
  if (options.transform) {
    transforms.push(...(Array.isArray(options.transform) ? options.transform : [options.transform]))
  }

  const rules: FieldRules = {}
  for (const key of RULE_KEYS) {
    if (options[key] !== undefined) {
      (rules as Record<string, unknown>)[key] = options[key]
    }
  }

  const hasRules = Object.keys(rules).length > 0
  if (transforms.length === 0 && !options.coerce && !hasRules && !options.transitions) {
    return undefined
  }
  return { transforms, coerce: options.coerce, rules, transitions: options.transitions }
}

export function ActiveFactory (
  factory: FactoryConfig,
  // Stryker disable next-line BooleanLiteral: reserved parameter, currently unused
  isOptional: boolean = false
) {
  return function (target: ActiveModel, prop: string): void {
    const Ctor = <typeof ActiveModel>target.constructor

    // fail fast: an undefined factory is usually a circular import, and would otherwise silently do nothing
    validateModelType(Array.isArray(factory) ? factory[0] : factory, prop)

    Ctor.addToFillable(prop)

    factoryDecorator(target, prop, factory, isOptional)
  }
}

/**
 * Declare a class property as a model field.
 * @param opts - field options (see {@link ActiveFieldDescriptor}); a bare non-object value is shorthand for `{ value }`
 */
export function ActiveField<_T extends ActiveModel> (
  opts?: ActiveFieldDescriptor | AttributeValue
) {
  if (typeof opts !== 'object' || opts === null || opts === undefined) {
    opts = {
      value: opts as AttributeValue,
    }
  }

  const options: ActiveFieldDescriptor = Object.assign({}, defaultOpts, opts)

  return function (target: ActiveModel, prop: string): void {
    const Ctor = <typeof ActiveModel>target.constructor

    Ctor.addToFields(prop)

    if (options.fillable) {
      Ctor.addToFillable(prop)
    }

    if (options.hidden) {
      Ctor.addToHidden(prop)
    }

    if (options.protected) {
      Ctor.addToProtected(prop)
    }

    if (options.readonly) {
      Ctor.addToReadonly(prop)
    }

    if (options.attribute || options.value) {
      Ctor.defineAttribute(prop, options.attribute || options.value)
    }

    const containers = [options.collection, options.map, options.set].filter(Boolean).length
    if (options.factory && options.collection) {
      throw new Error(`Field "${prop}": use either factory or collection, not both`)
    }
    if (containers + (options.factory ? 1 : 0) > 1) {
      throw new Error(`Field "${prop}": use only one of factory, collection, map or set`)
    }

    if (options.setter && !options.factory && containers === 0) {
      Ctor.defineSetter(prop, options.setter)
    }

    // Stryker disable next-line BooleanLiteral: reserved parameter, currently unused
    factoryDecorator(target, prop, options.factory, false)

    const hasOwnDefault = Boolean(options.attribute || options.value)
    if (options.collection) containerDecorator(target, prop, 'collection', options.collection, hasOwnDefault)
    if (options.map) containerDecorator(target, prop, 'map', options.map, hasOwnDefault)
    if (options.set) containerDecorator(target, prop, 'set', options.set, hasOwnDefault)

    if (options.getter) {
      Ctor.defineGetter(prop, options.getter)
    }

    if (options.validator) {
      Ctor.defineValidator(prop, options.validator)
    }

    const pipeline = buildPipeline(options)
    if (pipeline) {
      Ctor.definePipeline(prop, pipeline)
    }

    if (options.on) {
      const { addListener } = useEmitter(Ctor)

      for (const [eventName, listener] of Object.entries(
        options.on as Record<PropEvent, ActiveModelHookListener>
      )) {
        addListener(eventName as PropEvent, (payload) => {
          // Stryker disable next-line OptionalChaining: field-hook payloads and listeners always exist
          if (payload?.prop === prop) {
            // Stryker disable next-line OptionalChaining: field-hook payloads and listeners always exist
            listener?.(payload)
          }
        })
      }
    }

    if (options.once) {
      const { addListener } = useEmitter(Ctor)
      for (const [eventName, listener] of Object.entries(
        options.once as Record<PropEvent, ActiveModelHookListener>
      )) {
        // unsubscribe on the first event for THIS prop, not on the first event of any prop
        const off = addListener(eventName as PropEvent, (payload) => {
          // Stryker disable next-line OptionalChaining: field-hook payloads and listeners always exist
          if (payload?.prop === prop) {
            off()
            // Stryker disable next-line OptionalChaining: field-hook payloads and listeners always exist
            listener?.(payload)
          }
        })
      }
    }
  }
}
