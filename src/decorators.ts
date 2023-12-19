import { ActiveModel } from './'
import type { ActiveFieldDescriptor, FactoryConfig } from './types'
import { getValue } from './utils'

const defaultOpts: ActiveFieldDescriptor = {
  fillable: true
}

export function GetterMethod(property: string) {
  return function (target: typeof ActiveModel,  prop: string, descriptor: TypedPropertyDescriptor<any>) {
    target.defineGetter(property, descriptor.value)
  }
}

export function SetterMethod(property: string) {
  return function (target: typeof ActiveModel, prop: string | symbol, descriptor: TypedPropertyDescriptor<any>) {
    target.defineSetter(property, descriptor.value)
  }
}

export function isHidden () {
  return function (target: ActiveModel, prop: string) {
    (<typeof ActiveModel>target.constructor)
    .addToHidden(prop)
  }
}

export function isFillable () {
  return function (target: ActiveModel, prop: string) {
    (<typeof ActiveModel>target.constructor)
      .addToFillable(prop)
  }
}

export function isProtected () {
  return function (target: ActiveModel, prop: string) {
    (<typeof ActiveModel>target.constructor)
      .addToProtected(prop)
  }
}

const factoryDecorator = (target: ActiveModel, prop: string, factory?: FactoryConfig, isOptional?: boolean) => {
  if (!factory) {
    return
  }
  const Ctor = <typeof ActiveModel>target.constructor
  if (Array.isArray(factory)) {
    const [Model, DefaultValueFactory] = factory

    Ctor.defineSetter(prop, (m, p, v, r) => {
      if (Array.isArray(v)) {
        return Reflect.set(m,p, Model.createFromCollectionLazy(v), r)
      }

      const defaultValue = getValue(DefaultValueFactory)
      if (v && v !== defaultValue) {
        return Reflect.set(m,p, Model.createLazy(v), r)
      }

      return Reflect.set(m,p, defaultValue, r)
    })
    return
  }

  const Model = factory
  Ctor.defineSetter(prop, (m, p, v, r) => {
    const value = Array.isArray(v) ? Model.createFromCollectionLazy(v) : (v ? Model.createLazy(v) : v)
    return Reflect.set(m, p, value, r)
  })

}

export function ActiveFactory (factory: FactoryConfig, isOptional: boolean = false) {
  return function (target: ActiveModel, prop: string): void {
    factoryDecorator(target, prop, factory, isOptional)
  }
}

/**
 * Decorate class property
 * @constructor
 * @param opts<ActiveFieldDescriptor>
 */
export function ActiveField<T extends ActiveModel>(opts: ActiveFieldDescriptor = defaultOpts) {
  const options: ActiveFieldDescriptor = Object.assign({ fillable: true, protected: true }, opts)
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

    if (options.attribute || options.value) {
      Ctor.defineAttribute(prop, options.attribute || options.value)
    }

    if (options.setter && !options.factory) {
      Ctor.defineSetter(prop, options.setter)
    }

    factoryDecorator(target, prop, options.factory, false)

    if (options.getter) {
      Ctor.defineGetter(prop, options.getter)
    }

    if (options.validator) {
      Ctor.defineValidator(prop, options.validator)
    }

  }
}
