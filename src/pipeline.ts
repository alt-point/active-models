/**
 * The write pipeline of a field, as plain functions: normalizers, type coercion, declarative rules
 * and state transitions. `ActiveModel` runs it on every write; `validate()` reuses the rules.
 */
import type { ActiveModel } from './ActiveModel'

export type ValidationCode =
  | 'required'
  | 'type'
  | 'coerce'
  | 'min'
  | 'max'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'oneOf'
  | 'transition'
  | 'validator'
  | 'invariant'

/** One thing that is wrong with a value. */
export type ValidationIssue = {
  /** where: `name`, `address.city`, `items[2].title`; empty for a model-level invariant */
  path: string
  code: ValidationCode
  message: string
  /** the offending value (undefined for invariants) */
  value?: unknown
}

export type ValidationResult = {
  valid: boolean
  issues: ValidationIssue[]
}

/** Thrown when a write or `assertValid()` is refused; `issues` lists every reason. */
export class ValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor (issues: ValidationIssue[]) {
    super(issues.length === 1
      ? issues[0].message
      : `${issues.length} validation errors: ${issues.map((issue) => issue.message).join('; ')}`)
    this.name = 'ValidationError'
    this.issues = issues
  }
}

export type CoerceTo = 'string' | 'number' | 'integer' | 'boolean' | 'date'

export type ValueType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'array' | 'object'

export type Transform = (value: unknown, context: { model: ActiveModel, prop: string }) => unknown

export type FieldRules = {
  required?: boolean
  type?: ValueType
  min?: number | Date
  max?: number | Date
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  oneOf?: readonly unknown[] | Record<string, unknown>
}

export type Transitions = Record<string, readonly unknown[]>

export type PipelineConfig = {
  transforms: Transform[]
  coerce?: CoerceTo
  rules: FieldRules
  transitions?: Transitions
}

const isNil = (value: unknown): value is null | undefined => value === null || value === undefined

/** Values of a plain array, or of a TypeScript enum (numeric enums also carry reverse-mapping keys) */
export const allowedValues = (oneOf: readonly unknown[] | Record<string, unknown>): unknown[] => {
  if (Array.isArray(oneOf)) {
    return oneOf
  }
  const record = oneOf as Record<string, unknown>
  return Object.keys(record)
    .filter((key) => typeof record[record[key] as string] !== 'number')
    .map((key) => record[key])
}

/** Run the normalizers in order */
export const runTransforms = (config: PipelineConfig, value: unknown, model: ActiveModel, prop: string): unknown => {
  let result = value
  for (const transform of config.transforms) {
    result = transform(result, { model, prop })
  }
  return result
}

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  if (typeof value === 'boolean') return Number(value)
  return undefined
}

/**
 * Convert `value` to the wanted type. `null`/`undefined` pass through; a value that can't be converted
 * yields `{ ok: false }` so the caller can report it.
 */
export const coerceValue = (kind: CoerceTo, value: unknown): { ok: true, value: unknown } | { ok: false } => {
  if (isNil(value)) {
    return { ok: true, value }
  }
  switch (kind) {
    case 'string':
      return typeof value === 'object' && !(value instanceof Date)
        ? { ok: false }
        : { ok: true, value: value instanceof Date ? value.toISOString() : String(value) }
    case 'number':
    case 'integer': {
      const parsed = parseNumber(value)
      return parsed === undefined ? { ok: false } : { ok: true, value: parsed }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value }
      const text = String(value).trim().toLowerCase()
      if (text === 'true' || text === '1') return { ok: true, value: true }
      if (text === 'false' || text === '0') return { ok: true, value: false }
      return { ok: false }
    }
    case 'date': {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? { ok: false } : { ok: true, value }
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, value: date }
      }
      return { ok: false }
    }
  }
}

const isType = (type: ValueType, value: unknown): boolean => {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && !Number.isNaN(value)
    case 'integer': return Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'date': return value instanceof Date && !Number.isNaN(value.getTime())
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}

const describeValue = (value: unknown): string =>
  typeof value === 'string' ? JSON.stringify(value) : String(value)

/** Numbers and dates compare by their numeric value */
const comparable = (value: unknown): number => (value instanceof Date ? value.getTime() : (value as number))

const lengthOf = (value: unknown): number | undefined =>
  typeof value === 'string' || Array.isArray(value) ? value.length : undefined

/**
 * Every rule a value breaks. `null`/`undefined` only break `required` - an optional field
 * that is absent has nothing to check; `required` also rejects the empty string.
 */
export const ruleIssues = (rules: FieldRules, value: unknown, path: string, coerce?: CoerceTo): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationCode, message: string) => issues.push({ path, code, message, value })

  if (isNil(value) || (value === '' && rules.required)) {
    if (rules.required) {
      add('required', `"${path}" is required`)
    }
    return issues
  }

  const type = rules.type ?? coerce
  if (type && !isType(type, value)) {
    add('type', `"${path}" must be a ${type}, got ${describeValue(value)}`)
    return issues
  }
  if (rules.min !== undefined && comparable(value) < comparable(rules.min)) {
    add('min', `"${path}" must be at least ${describeValue(rules.min instanceof Date ? rules.min.toISOString() : rules.min)}`)
  }
  if (rules.max !== undefined && comparable(value) > comparable(rules.max)) {
    add('max', `"${path}" must be at most ${describeValue(rules.max instanceof Date ? rules.max.toISOString() : rules.max)}`)
  }
  const length = lengthOf(value)
  if (length !== undefined && rules.minLength !== undefined && length < rules.minLength) {
    add('minLength', `"${path}" must have at least ${rules.minLength} characters/items, has ${length}`)
  }
  if (length !== undefined && rules.maxLength !== undefined && length > rules.maxLength) {
    add('maxLength', `"${path}" must have at most ${rules.maxLength} characters/items, has ${length}`)
  }
  if (rules.pattern && typeof value === 'string' && !new RegExp(rules.pattern.source, rules.pattern.flags.replace('g', '')).test(value)) {
    add('pattern', `"${path}" does not match ${rules.pattern}`)
  }
  if (rules.oneOf && !allowedValues(rules.oneOf).includes(value)) {
    add('oneOf', `"${path}" must be one of ${allowedValues(rules.oneOf).map(describeValue).join(', ')}, got ${describeValue(value)}`)
  }
  return issues
}

/** Whether `transitions` lets a field go from `from` to `to` (a state with no entry is terminal) */
export const canTransition = (transitions: Transitions, from: unknown, to: unknown): boolean => {
  if (isNil(from) || Object.is(from, to)) {
    return true
  }
  const key = String(from)
  return Object.prototype.hasOwnProperty.call(transitions, key) && transitions[key].includes(to)
}

/** The states reachable from `from` (all keys when `from` is not set yet) */
export const nextStates = (transitions: Transitions, from: unknown): unknown[] => {
  if (isNil(from)) {
    return [...new Set([...Object.keys(transitions), ...Object.values(transitions).flat()])]
  }
  const key = String(from)
  return Object.prototype.hasOwnProperty.call(transitions, key) ? [...transitions[key]] : []
}
