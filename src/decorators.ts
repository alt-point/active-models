import { ActiveModel } from './ActiveModel'
import type {
  ActiveFieldDescriptor,
  ActiveModelHookListener,
  AttributeValue,
  CollectionOptions,
  FactoryConfig,
  PropEvent,
} from './types'
import { getValue } from './utils'
import { useEmitter } from './emitter'
import { ActiveCollection } from './ActiveCollection'
import { isCollection } from './collectionRegistry'

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

/**
 * Turn whatever is assigned to a `collection` field into an `ActiveCollection`:
 * an array/iterable becomes one, `null`/`undefined` an empty one, a collection of the same model stays as is.
 */
const toCollection = (Model: typeof ActiveModel, value: unknown, options?: CollectionOptions) => {
  if (isCollection(value) && value.model === Model) {
    return value
  }
  if (value === null || value === undefined) {
    return ActiveCollection.create(Model, [], options)
  }
  if (typeof value === 'object' && Symbol.iterator in value) {
    return ActiveCollection.create(Model, value as Iterable<unknown>, options)
  }
  throw new TypeError(`A collection of ${Model.name} expects an array, got ${typeof value}`)
}

const collectionDecorator = (
  target: ActiveModel,
  prop: string,
  config: ActiveFieldDescriptor['collection'],
  hasOwnDefault: boolean
) => {
  if (!config) {
    return
  }
  const [Model, options] = Array.isArray(config) ? config : [config, undefined]
  validateModelType(Model, prop)
  const Ctor = <typeof ActiveModel>target.constructor

  Ctor.defineSetter(prop, (m, p, v, r) => Reflect.set(m, p, toCollection(Model, v, options), r))
  if (!hasOwnDefault) {
    Ctor.defineAttribute(prop, () => ActiveCollection.create(Model, [], options))
  }
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

    if (options.factory && options.collection) {
      throw new Error(`Field "${prop}": use either factory or collection, not both`)
    }

    if (options.setter && !options.factory && !options.collection) {
      Ctor.defineSetter(prop, options.setter)
    }

    // Stryker disable next-line BooleanLiteral: reserved parameter, currently unused
    factoryDecorator(target, prop, options.factory, false)

    collectionDecorator(target, prop, options.collection, Boolean(options.attribute || options.value))

    if (options.getter) {
      Ctor.defineGetter(prop, options.getter)
    }

    if (options.validator) {
      Ctor.defineValidator(prop, options.validator)
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
