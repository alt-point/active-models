# Mapping

Реализован базовый маппинг на хендлерах.

Преобразование модели к цели (из одной модели к другой, из модели к сценарию/состоянию). К какой угодно, хоть к символу.


```sharedSymbols.ts

export const CommitToServer = Symbol.for('ServerSend')
```

### Моделька создания и обновления Продукта

```typescript
export class ProductCreateOrUpdate extends ActiveModel {
  @ActiveField()
  name: string = ''

  @ActiveField()
  description: string = ''
  
  @ActiveField()
  price: number = 0 
}

```

### Полная модель `Product`

```typescript
import { ActiveModel, ActiveField } from '@alt-point/active-models/src'

export class Product extends ProductCreate {
  @ActiveField()
  id: string = ''

  @ActiveField({
    factory: [User, () => User]
  })
  creator: User = new User()
  
  @ActiveField()
  createdAt: string = ''

  @ActiveField()
  updatedAt: string = ''
}
```


### Пример маппинга

Сервер написан на dotnet с entity framework автомапингом к моделям, т.е. он крайне чувствителен 
к передаваемым данным (не будем рассуждать о программистах, которые такое выкатывают в продакшен)

#### Регистрация обработчиков

```typescript

/**
 * Преобразование к нужному типу, мы знаем что поля совпадают  
 */
Product.mapTo(ProductCreateOrUpdate, (model: Product) => {
  return ProductCreateOrUpdate.create(model)
})

/**
 * Общий сценарий отправки на сервер
 */
Product.mapTo(CommitToServer, (model: Product) => {
  // Пример переиспользования маппинга
  if (model.hasMapping(ProductCreateOrUpdate)) {
    return model.mapTo(ProductCreateOrUpdate)
  }
  
  // Явное определение 
  return ProductCreateOrUpdate.create(model)
})

```

#### Вызов обработчиков

Базовая отправка на сервер.

```typescript
import { CommitToServer } from '@/sharedSymbols'
...
  sendToServer (model: ActiveModel) {
    let requestPayload = model
    if (model.hasMapping(CommitToServer)) {
      requestPayload = requestPayload.mapTo(CommitToServer) // имеем глобальную обработку перед отправкой на сервер
    }
  }
...

```
