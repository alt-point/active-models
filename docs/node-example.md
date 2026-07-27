`ActiveModel`: пример для Node.js-сервера
===

Все предыдущие примеры завязаны на Vue/Nuxt. Здесь — минимальный пример без какого-либо фронтенд-фреймворка:
HTTP API на чистом `node:http`, без Express и без каких-либо дополнительных зависимостей.

Задача: маленький REST-эндпоинт для задач (`Task`), где `id` и `createdAt` генерируются на сервере и
клиент не может их подделать, даже если пришлёт их в теле запроса.

## Модель

```ts
// models/Task.ts
import { randomUUID } from 'node:crypto'
import { ActiveModel, ActiveField } from '@alt-point/active-models'

export class Task extends ActiveModel {
  // readonly один сам по себе разрешает установить значение ОДИН РАЗ из data
  // (через create()/конструктор) — то есть клиент мог бы передать id в body
  // и "занять" эту единственную попытку записи. Для по-настоящему
  // server-only поля добавляем fillable: false — тогда единственный
  // источник значения — инициализатор поля класса ниже, data полностью
  // игнорируется. Подробности — в active-model-advanced.md, раздел `readonly`.
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

## HTTP-сервер

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
      // Валидатор в Task ловит НЕВЕРНЫЙ тип/значение title, но не отсутствие
      // ключа целиком (он не вызывается для полей, которых нет во входных
      // данных, — подробности в active-model-advanced.md). Обязательность
      // поля поэтому проверяем явно, до вызова create().
      if (!body || typeof body.title !== 'string' || !body.title.trim()) {
        throw new TypeError('"title" is required and must be a non-empty string')
      }
      // Даже если клиент пришлёт { id: '...', createdAt: '...' } в body,
      // это будет молча проигнорировано — оба поля readonly + fillable: false.
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

## Проверка

```bash
curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Buy milk", "id": "spoofed-id", "createdAt": "2000-01-01"}'
# → 201, id и createdAt в ответе будут настоящими, сгенерированными сервером,
#   а не теми, что прислал клиент

curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{}'
# → 400 { "error": "\"title\" is required and must be a non-empty string" }
```

## Что здесь показано

- **`readonly` + `fillable: false` для полей, генерируемых сервером** (`id`, `createdAt`) — надёжный
  способ гарантировать, что клиент не сможет подменить идентификатор или дату создания через тело
  запроса. Один `readonly` для этого недостаточен: он разрешает установить значение один раз из `data`
  при создании, и без `fillable: false` этой единственной попыткой мог бы воспользоваться клиент.
  Подробнее — в [active-model-advanced.md](active-model-advanced.md), раздел `readonly`.
- **`validator`, который бросает исключение при неверном значении** — но не при отсутствующем ключе:
  валидатор не вызывается для полей, которых просто нет во входных данных, поэтому проверку "поле
  обязательно" делаем явно, до `Task.create(body)` (подробности и почему — там же, в
  active-model-advanced.md). Валидатор в модели остаётся полезен как защита от значений неверного типа.
- **`JSON.stringify(task)`** — работает "из коробки" благодаря встроенному `toJSON()`; если бы в модели
  было `hidden`-поле (например, внутренний служебный флаг), оно бы не попало в ответ клиенту.
