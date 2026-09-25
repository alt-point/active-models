/**
 * Instances of a `CallableModel` subclass are functions: calling one invokes `__call`.
 *
 * Built on a plain function whose prototype is swapped to the subclass
 * prototype, not on `extends Function` + `super()` - the latter constructs
 * code dynamically and is blocked by a strict Content-Security-Policy.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class CallableModel {
  __call (..._args: any[]): any {
    throw new TypeError('Method "__call" must be implemented')
  }

  protected constructor () {
    const callable = function (this: unknown, ...args: any[]) {
      return (callable as unknown as CallableModel).__call(...args)
    }
    Object.setPrototypeOf(callable, new.target.prototype)
    return callable as unknown as CallableModel
  }
}

// keep Function.prototype members (call, apply, bind, name, length) available
Object.setPrototypeOf(CallableModel.prototype, Function.prototype)

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface CallableModel extends Function {}
