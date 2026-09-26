/** Marks a value object as immutable: model cloning shares it instead of copying it */
export const IMMUTABLE = Symbol.for('active-models.immutable')

export const markImmutable = (ctor: { prototype: object }): void => {
  Object.defineProperty(ctor.prototype, IMMUTABLE, { value: true })
}

export const isImmutable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[IMMUTABLE] === true
