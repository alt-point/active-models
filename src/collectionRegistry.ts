import type { ActiveCollection } from './ActiveCollection'

/**
 * Marks collection instances (proxy and raw target) so `ActiveModel` can recognise one
 * without importing the class itself.
 */
const registry = new WeakSet<object>()

export const registerCollection = (...instances: object[]) => {
  for (const instance of instances) {
    registry.add(instance)
  }
}

/** Whether `value` is an `ActiveCollection` */
export const isCollection = (value: unknown): value is ActiveCollection<any> =>
  typeof value === 'object' && value !== null && registry.has(value)
