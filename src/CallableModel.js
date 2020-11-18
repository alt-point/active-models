export default class Callable extends Function {
  constructor () {
    super()
    return new Proxy(this, {
      apply: (target, thisArg, args) => target.__call(...args)
    })
  }
}
