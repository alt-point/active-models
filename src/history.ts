/**
 * Undo/redo bookkeeping: per model instance, a stack of steps, each a list of field changes.
 * Kept outside the instance (like the rest of the internal state) so nothing leaks into
 * enumeration or serialization.
 */

export type Change = { prop: string | symbol, from: unknown, to: unknown }

type State = {
  limit: number
  undo: Change[][]
  redo: Change[][]
  /** while set, recorded changes are collected here and become ONE step (see `commitGroup`) */
  group?: { depth: number, changes: Change[] }
}

const DEFAULT_LIMIT = 100
const histories = new WeakMap<object, State>()

export const enableHistory = (raw: object, limit: number = DEFAULT_LIMIT) => {
  histories.set(raw, { limit, undo: [], redo: [] })
}

export const hasHistory = (raw: object): boolean => histories.has(raw)

/** A new write happened: it becomes a step (or joins the open group) and invalidates redo */
export const recordChange = (raw: object, change: Change) => {
  const state = histories.get(raw)
  if (!state) {
    return
  }
  if (state.group) {
    state.group.changes.push(change)
    return
  }
  pushStep(state, [change])
}

const pushStep = (state: State, step: Change[]) => {
  state.undo.push(step)
  if (state.undo.length > state.limit) {
    state.undo.shift()
  }
  state.redo.length = 0
}

/** Everything recorded until `commitGroup` / `abortGroup` becomes a single step */
export const beginGroup = (raw: object) => {
  const state = histories.get(raw)
  if (!state) {
    return
  }
  if (state.group) {
    state.group.depth++
  } else {
    state.group = { depth: 1, changes: [] }
  }
}

export const commitGroup = (raw: object) => {
  const state = histories.get(raw)
  if (!state?.group || --state.group.depth > 0) {
    return
  }
  const { changes } = state.group
  state.group = undefined
  if (changes.length > 0) {
    pushStep(state, changes)
  }
}

export const abortGroup = (raw: object) => {
  const state = histories.get(raw)
  if (!state?.group || --state.group.depth > 0) {
    return
  }
  state.group = undefined
}

export const canUndo = (raw: object): boolean => (histories.get(raw)?.undo.length ?? 0) > 0

export const canRedo = (raw: object): boolean => (histories.get(raw)?.redo.length ?? 0) > 0

export const clearHistory = (raw: object) => {
  const state = histories.get(raw)
  if (state) {
    state.undo.length = 0
    state.redo.length = 0
  }
}

/**
 * Move one step between the stacks. `apply` performs the writes: undoing writes `from` (last change
 * first), redoing writes `to` (first change first).
 */
export const step = (
  raw: object,
  direction: 'undo' | 'redo',
  apply: (prop: string | symbol, value: unknown) => void
): boolean => {
  const state = histories.get(raw)
  const from = direction === 'undo' ? state?.undo : state?.redo
  const to = direction === 'undo' ? state?.redo : state?.undo
  const changes = from?.pop()
  if (!state || !changes) {
    return false
  }
  if (direction === 'undo') {
    for (let i = changes.length - 1; i >= 0; i--) {
      apply(changes[i].prop, changes[i].from)
    }
  } else {
    for (const change of changes) {
      apply(change.prop, change.to)
    }
  }
  to!.push(changes)
  return true
}
