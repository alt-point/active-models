import { ActiveModel } from './ActiveModel'
import deepEqual from 'fast-deep-equal/es6'
import { cloneDeep } from "lodash"
type State = {
  creating: boolean
  isDirty: boolean
  initialState?: ActiveModel | undefined
  raw?: any
}
const sharedState = new WeakMap<ActiveModel,State>()
export const sanitizedValues = new WeakSet()

let creating = false

export function markSanitized (value: {}) {
  sanitizedValues.add(value)
}
export function checkSanitized (value: {}) {
  if (!value || typeof value !== 'object') return true
  return sanitizedValues.has(value)
}

const upsertState = (instance: ActiveModel, data: Partial<State>) => {
  if(!sharedState.has(instance)) {
    sharedState.set(instance, {
      creating: false,
      isDirty: false
    })
  }
  const record = sharedState.get(instance)!
  for (const [p, v] of Object.entries(data) as [keyof State, any][]) {
    record[p] = v
  }
}

export const startCreating = () => {
  creating = true
}

export const endCreating = () => {
  creating = false
}

export const isCreating = (): boolean => {
  return creating
}

export const isNotCreating = (): boolean => {
  return !creating
}

const onCreating = () => {

}

export const saveInitialState = (instance: ActiveModel, initialState: ActiveModel) => {
  initialState = deepFreeze(cloneDeep(initialState))
  upsertState(instance, { initialState })
}

export const saveRaw = (instance: ActiveModel, raw: any) => {
  raw = deepFreeze(cloneDeep(raw))
  upsertState(instance, { raw })
}

export const isTouched = (instance: ActiveModel) => {
  const meta = sharedState.get(instance)
  if (!meta) {
    return undefined
  }
  
  const { initialState} = meta
  
  return deepEqual(instance, initialState)
}


function deepFreeze(value: any) {
  if (!((value && typeof value === "object") || typeof value === "function")) {
    return value
  }
  const propNames = Reflect.ownKeys(value);
  
  for (const name of propNames) {
    const v = value[name]
    if ((v && typeof value === "object") || typeof v === "function") {
      deepFreeze(v);
    }
  }
  
  return Object.freeze(value);
}

const requiredInstance = (instance?: ActiveModel) => {
  if (!instance) {
    throw new Error(`Instance extends ActiveModel is required for this method!`)
  }
  
  return instance
}

export const useMeta = (instance?: ActiveModel) => {
  let inst = instance
  return {
    setInstance: (instance: ActiveModel) => {
      inst = instance
    },
    startCreating,
    endCreating,
    isCreating,
    isNotCreating,
    saveInitialState: (initialState: ActiveModel) =>  saveInitialState(requiredInstance(inst), initialState),
    saveRaw: (raw: any) => saveRaw(requiredInstance(inst), raw),
    isTouched: () => isTouched(requiredInstance(inst))
  }
}

