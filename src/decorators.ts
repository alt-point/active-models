import { ActiveModel } from './'
import type { Validator, ActiveFieldDescriptor, Getter, Setter } from './types'

const defaultOpts: ActiveFieldDescriptor = {
  fillable: true,
  hidden: false,
  protected: true,
  attribute: ''
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

/**
 *
 * @param Ctor
 * @constructor
 */
export function ActiveClass <T extends { new (...args: any[]): {}, [key: string]: any }>(Ctor: T) {
  if (Ctor.__activeModeActivate) {
    return Ctor
  }
  Object.defineProperty(Ctor,'__activeModeActivate', {
    value: true
  })
  Object.defineProperty(Ctor,'__setters__', { value: new Map<string, Setter<any>>() } )
  Object.defineProperty(Ctor,'__getters__', { value: new Map<string, Getter<any>>() } )
  Object.defineProperty(Ctor,'__attributes__', { value: new Map<string, any>() } )
  Object.defineProperty(Ctor,'__validators__', { value: new Map<string, Validator<any>>() } )
  Object.defineProperty(Ctor,'__fillable__', { value: new Set<string>() } )
  Object.defineProperty(Ctor,'__protected__', { value: new Set<string>() } )
  Object.defineProperty(Ctor,'__readonly__', { value: new Set<string>() } )
  Object.defineProperty(Ctor,'__hidden__', { value: new Set<string>() } )
  return Ctor
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
      .addToFillable(prop)
  }
}


/**
 * Decorate class property
 * @constructor
 * @param opts<ActiveFieldDescriptor>
 * @param opts.setter?: Setter<any> - setter for property
 * @param opts.getter?: Getter<any> - getter for property
 * @param opts.validator?: Validator<any>
 * @param opts.readonly?: boolean - property access readonly
 * @param opts.hidden?: boolean - property hide in own keys
 * @param opts.fillable?: boolean - property can be filled in
 * @param opts.protected?: boolean - property protected from deleting
 * @param opts.attribute?: any - default value for creating
 * @param opts.value?: any - alias for opts.attribute
 */
export function ActiveField(opts: ActiveFieldDescriptor = defaultOpts) {
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

    if (options.setter) {
      Ctor.defineSetter(prop, options.setter)
    }

    if (options.getter) {
      Ctor.defineGetter(prop, options.getter)
    }

    if (options.validator) {
      Ctor.defineValidator(prop, options.validator)
    }

  }
}
