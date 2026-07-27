`ActiveModel`: a Node.js server example
===

Every other example in these docs is tied to Vue/Nuxt. Here's a minimal example with no frontend
framework at all: an HTTP API built on plain `node:http`, no Express, no extra dependencies.

The goal: a small REST endpoint for tasks (`Task`), where `id` and `createdAt` are generated on the
server and the client can't spoof them even by sending its own values in the request body.

## The model

```ts
// models/Task.ts
import { randomUUID } from 'node:crypto'
import { ActiveModel, ActiveField } from '@alt-point/active-models'

export class Task extends ActiveModel {
  // readonly by itself allows a value to be set ONCE from data (via create()
  // or the constructor) — meaning a client could pass id in the body and
  // "claim" that one allowed write. For a genuinely server-only field we
  // also add fillable: false, so the only possible source of the value is
  // the class-field initializer below and data is fully ignored. Details in
  // active-model-advanced.md, the `readonly` section.
  @ActiveField({ readonly: true, fillable: false })
  id: string = randomUUID()

  @ActiveField({
    validator (model, prop, value) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError('"title" is required and must be a non-empty string')
      }
    }
  })
  title: string = ''

  @ActiveField()
  done: boolean = false

  @ActiveField({ readonly: true, fillable: false })
  createdAt: string = new Date().toISOString()
}
```

## The HTTP server

```ts
// server.ts
import { createServer, type IncomingMessage } from 'node:http'
import { Task } from './models/Task'

const tasks = new Map<string, Task>()

function readJsonBody (req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'POST' && req.url === '/tasks') {
    try {
      const body = await readJsonBody(req)
      // Task's validator catches a WRONG type/value for title, but not a
      // missing key entirely (it isn't called for fields absent from the
      // input — see active-model-advanced.md for details). So we check
      // required-ness explicitly, before calling create().
      if (!body || typeof body.title !== 'string' || !body.title.trim()) {
        throw new TypeError('"title" is required and must be a non-empty string')
      }
      // Even if the client sends { id: '...', createdAt: '...' } in the body,
      // it's silently ignored — both fields are readonly + fillable: false.
      const task = Task.create(body)
      tasks.set(task.id, task)
      res.writeHead(201)
      res.end(JSON.stringify(task))
    } catch (e) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: (e as Error).message }))
    }
    return
  }

  if (req.method === 'GET' && req.url === '/tasks') {
    res.writeHead(200)
    res.end(JSON.stringify([...tasks.values()]))
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(3000, () => {
  console.log('Listening on http://localhost:3000')
})
```

## Trying it out

```bash
curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Buy milk", "id": "spoofed-id", "createdAt": "2000-01-01"}'
# → 201, the id and createdAt in the response are the real, server-generated
#   ones — not the ones the client sent

curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{}'
# → 400 { "error": "\"title\" is required and must be a non-empty string" }
```

## What this demonstrates

- **`readonly` + `fillable: false` for server-generated fields** (`id`, `createdAt`) — a reliable way to
  guarantee the client can't spoof the identifier or creation date through the request body. `readonly`
  alone isn't enough here: it allows one value to be set from `data` at creation, and without
  `fillable: false` a client could claim that one write for itself. See
  [active-model-advanced.md](active-model-advanced.md), the `readonly` section, for details.
- **A `validator` that throws on an invalid value** — but not on a missing key: the validator isn't
  called for fields that are simply absent from the input, so the "field is required" check is done
  explicitly, before `Task.create(body)` (details and why, in the same advanced doc). The model's
  validator remains useful as a guard against wrong-type values.
- **`JSON.stringify(task)`** — works out of the box thanks to the built-in `toJSON()`; if the model had
  a `hidden` field (say, an internal-only flag), it would never make it into the response sent to the client.
