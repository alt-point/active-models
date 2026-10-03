// Run after `bun run build`: loads the BUILT package the way a consumer does (by subpath, in ESM and in CJS) and
// checks that the entries share one copy of every class - code splitting must not duplicate ActiveModel, the
// emitter or the registries, or `instanceof` and events would silently break between entries.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const PKG = '@alt-point/active-models'
const require = createRequire(import.meta.url)

const loaders = {
  esm: (name) => import(`${PKG}/${name}`),
  cjs: async (name) => require(`${PKG}/${name}`),
}

const run = async (label, load) => {
  const { ActiveModel } = await load('ActiveModel')
  const { ActiveField } = await load('decorators')
  const { ActiveCollection } = await load('ActiveCollection')
  const { ActiveMap } = await load('ActiveMap')
  const { ActiveSet } = await load('ActiveSet')
  const { isCollection } = await load('collectionRegistry')
  const { ValidationError } = await load('pipeline')
  const { EventType } = await load('types')
  const { Money } = await load('scalars/Money')
  const { Decimal } = await load('scalars/Decimal')
  const { LocalDate } = await load('scalars/LocalDate')
  const { CallableModel } = await load('CallableModel')
  await load('utils')
  await load('Enum')
  await load('scalars/immutable')

  const define = (Model, fields) => {
    for (const [prop, options] of Object.entries(fields)) ActiveField(options)(Model.prototype, prop)
    return Model
  }

  const Task = define(class Task extends ActiveModel {}, { id: { value: 0 }, title: { value: '' } })
  const Board = define(class Board extends ActiveModel {}, {
    tasks: { container: ActiveCollection.field(Task, { sortBy: 'id' }) },
    byId: { container: ActiveMap.field(Task, { key: 'id' }) },
    tags: { container: ActiveSet.field(Task, { unique: 'id' }) },
    total: { coerce: Money, min: Money.of(1, 'USD') },
    rate: { coerce: Decimal },
    due: { coerce: LocalDate },
  })

  const board = Board.create({
    tasks: [{ id: 2 }, { id: 1 }], byId: [{ id: 7 }], tags: [{ id: 9 }],
    total: '19.99 USD', rate: '0.1', due: '2026-09-25',
  })
  assert.ok(board instanceof ActiveModel, `${label}: model is an ActiveModel`)
  assert.ok(board.tasks instanceof ActiveCollection && isCollection(board.tasks), `${label}: collection registered once`)
  assert.ok(board.byId instanceof ActiveMap && isCollection(board.byId), `${label}: map registered once`)
  assert.ok(board.tags instanceof ActiveSet && isCollection(board.tags), `${label}: set registered once`)
  assert.deepEqual(board.tasks.map((t) => t.id), [1, 2], `${label}: sorted`)
  assert.equal(board.total.toString(), '19.99 USD')
  assert.equal(board.rate.add('0.2').toString(), '0.3')
  assert.equal(board.due.addMonths(5).toString(), '2027-02-25')

  assert.throws(() => { board.total = '0.50 USD' }, (error) => error instanceof ValidationError, `${label}: one ValidationError class`)

  let touched = 0
  board.on(EventType.touched, () => { touched++ })
  board.tasks[0].title = 'changed'
  assert.ok(touched >= 1, `${label}: touched bubbles from an item of a collection to the board`)
  assert.equal(typeof CallableModel, 'function')
  console.log(`ok  ${label}`)
}

for (const [label, load] of Object.entries(loaders)) await run(label, load)

for (const forbidden of [PKG, `${PKG}/index`, `${PKG}/meta`, `${PKG}/emitter`]) {
  await assert.rejects(import(forbidden), (error) => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || error.code === 'ERR_MODULE_NOT_FOUND',
    `${forbidden} must not be importable`)
}
console.log('ok  no root entry and no internals')
