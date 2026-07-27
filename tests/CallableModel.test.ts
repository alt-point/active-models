import { describe, expect, it } from 'vitest'
import { CallableModel } from '../src'

describe('CallableModel', () => {
  it('invokes __call when the instance is called as a function', () => {
    class Notify extends CallableModel {
      __call (...args: any[]) {
        return 'called with: ' + args.join(',')
      }
    }

    // @ts-expect-error protected ctor is a compile-time-only guard
    const notify: any = new Notify()
    expect(notify('hi', 'there')).toBe('called with: hi,there')
  })

  it('throws when __call is not implemented by the subclass', () => {
    class Bare extends CallableModel {}

    // @ts-expect-error protected ctor is a compile-time-only guard
    const bare: any = new Bare()
    expect(() => bare()).toThrow('Method "__call" must be implemented')
  })

  it('delegates to other instance methods from __call', () => {
    class Notify extends CallableModel {
      log: string[] = []
      __call (message: string) {
        return this.success(message)
      }
      success (message: string) {
        this.log.push(message)
        return message
      }
    }

    // @ts-expect-error protected ctor is a compile-time-only guard
    const notify: any = new Notify()
    notify('Alert!')
    expect(notify.log).toEqual(['Alert!'])
  })
})
