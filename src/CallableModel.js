/**
 * Callable class
 */
export default class CallableModel extends Function {
  __call () {
    throw new TypeError('Method "__call" must be implemented')
  }

  constructor () {
    super()
    if (!Object.prototype.hasOwnProperty.call(this, '__call') && typeof this.__call === 'function') {
      throw new TypeError('Class mast be implement method "__call"')
    }

    return new Proxy(this, {
      apply: (target, thisArg, args) => target.__call(...args)
    })
  }
}
