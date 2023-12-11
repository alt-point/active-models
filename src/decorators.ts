import { ActiveModel } from './'
import type { ActiveFieldDescriptor } from './types'

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


/**
 * Decorate class property
 * @constructor
 * @param opts<ActiveFieldDescriptor>
 */
export function ActiveField<T extends ActiveModel>(opts: ActiveFieldDescriptor = defaultOpts) {
  const options: ActiveFieldDescriptor = Object.assign({ fillable: true, protected: true }, opts)
  return function (target: ActiveModel, prop: string): void {
    const Ctor = <typeof ActiveModel>target.constructor

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
    
    if (options.factory) {
      if (Array.isArray(options.factory)) {
        const [Model, DefaultValue ] = options.factory
        
        Ctor.defineSetter(prop, (m, p, v, r) => {
          const value = Array.isArray(v) ? Model.createFromCollection(v) : v && v !== DefaultValue ? Model.create(v) : DefaultValue
          return Reflect.set(m,p, value, r)
        })
      } else {
        const Model = options.factory
        Ctor.defineSetter(prop, (m, p, v, r) => {
          const value = Array.isArray(v) ? Model.createFromCollection(v) : (v ? Model.create(v) : v)
          return Reflect.set(m, p, value, r)
        })
      }
      
    }
    
    if (options.getter) {
      Ctor.defineGetter(prop, options.getter)
    }

    if (options.validator) {
      Ctor.defineValidator(prop, options.validator)
    }

  }
}
