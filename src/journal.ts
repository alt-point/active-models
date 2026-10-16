import { isRestoring } from './meta'

/*
 * The journal behind `transaction()`. While a transaction is open on a model, every write to it, to a model
 * nested anywhere below it and every change of a container it holds records a closure that undoes it; a
 * rollback runs them newest first. Nothing is recorded while no transaction is open.
 */

/**
 * child (a nested model, a container, an item) -> what holds it. Held weakly: a dropped container must stay
 * collectable while its items live on.
 */
const parentOf = new WeakMap<object, WeakRef<object>>()

/** one `WeakRef` per parent, shared by all its children */
const refs = new WeakMap<object, WeakRef<object>>()

type Journal = { undo: Array<() => void>, starts: number[] }

/** a model with an open transaction -> its records; one start per nesting level */
const journals = new WeakMap<object, Journal>()

/** open transactions, over all models: the no-transaction path checks this number and allocates nothing */
let open = 0

/**
 * Remember who holds `child`, so that a change of it reaches the transactions open above it.
 * shortcut: one parent per child - a child moved elsewhere keeps the last one and an instance held by two models
 * only the one it was attached to last; keep a set of parents if instances shared between trees need both rolled back
 */
export const setParent = (child: object, parent: object) => {
  let ref = refs.get(parent)
  if (!ref) {
    ref = new WeakRef(parent)
    refs.set(parent, ref)
  }
  parentOf.set(child, ref)
}

/** Whether a change right now must be journaled: a transaction is open and no rollback is running */
export const isJournaling = (): boolean => open > 0 && !isRestoring()

export const beginJournal = (root: object) => {
  let journal = journals.get(root)
  if (!journal) {
    journal = { undo: [], starts: [] }
    journals.set(root, journal)
  }
  journal.starts.push(journal.undo.length)
  open++
}

/** Close the innermost transaction on `root`; its records stay for an enclosing one */
export const commitJournal = (root: object) => {
  const journal = journals.get(root)!
  journal.starts.pop()
  if (journal.starts.length === 0) {
    journals.delete(root)
  }
  open--
}

/** Undo the innermost transaction on `root`: run its records newest first */
export const rollbackJournal = (root: object) => {
  const journal = journals.get(root)!
  const start = journal.starts.pop()!
  const { undo } = journal
  try {
    for (let i = undo.length - 1; i >= start; i--) {
      undo[i]()
    }
  } finally {
    undo.length = start
    if (journal.starts.length === 0) {
      journals.delete(root)
    }
    open--
  }
}

/** Record how to undo a change of `node` in every transaction open on it or on what holds it */
export const journal = (node: object, undo: () => void) => {
  if (!isJournaling()) {
    return
  }
  // one record shared by all those transactions: the first rollback to run it spends it for the others, so an
  // enclosing transaction never re-applies what a nested one already undid
  let spent = false
  const record = () => {
    if (!spent) {
      spent = true
      undo()
    }
  }
  const seen = new Set<object>() // nested models can form reference cycles
  for (let current: object | undefined = node; current && !seen.has(current); current = parentOf.get(current)?.deref()) {
    seen.add(current)
    journals.get(current)?.undo.push(record)
  }
}
