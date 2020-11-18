Active Models
===
Доступные модули в пакете:

- `ActiveModel`
- `Enum`
- `CallableModel` 

`ActiveModel`
---

Class based wrapper для объектов с ацессорами (`setter`/`getter`) реализованованный через добавление `Proxy`.

Назначение: получаем возможность контролировать целостность данных, да и сами данные на уровне модели, а не в контроллерах/компонентах/etc.
Например в `vue` зачастую при работе с api, либо просто с компонентами, vuex требуется контролировать структуру данных, 
которая передаётся в запросах, либо хранится/изменяется в каком-то стейте.

Если в проекте моделей данных много, либо они используются в разных местах одни и те же, то логично для этого использоватть класса.

Например, классический случай модель `Order` используется в листинге заказов, 
при *создании заказа* (`create`), при *обновлении заказа* (`update`), при *чтение данных заказа* (`read`), 
а так же в вызовах api (да, можно вызовы api сложить в vuex например, я так не делаю, ну либо комбинирую подходы).
Итого, мы имеем в 3-х местах одинаковую структуру данных, а так же дополнительно хотим быть уверены что во всём взаимодействии с бекендом 
у нас полнейший порядок и мы отправляем и получаем именно такие структуры данных, которые надо, а не что получится.

Решение: Создаём класс унаследованный от `ActiveModel`

```js

import { ActiveModel, Enum } from '@alt-point/active-models'

// Мы хотим контролировать то, что проставляется в поле status, потому определяем enum
export const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

export default class Order extends {
  // Контролируем, что из сырых данных переданных в конструктор мы заберём только этот список полей
  static get fillable () {
    return [
      'goods',
      'id',
      'status'  
    ]  
  }
  
  // Определяем дефолтную структуру объекта
  static get $attributes () {
    return {
      goods: [],
      id: '',
      status: OrderStatuses.default,      
    } 
  }
  
  // В свойстве goods, мы хотим что бы были только объекты класса Goods
  //
  static setterGoods (model, prop, value = [], receiver) {
    value = (Array.isArray(value) ? value : [])
      .map(item => !(item instanceof Order) ? new Order(item) : item)
    Reflect.set(model, prop, value, receiver)
  }

  // Можем сразу подсчитывать количество товаров в заказе
  static getterGoodsCount (model) {
    return model.goods.length
  }

  // Так же можем посчитать вес заказа
  static getterWeight (model) {
    return model.goods.reduce((a, { weight }) => a + weight, 0)
  }
  
  // Если предадим некорректное значение статуса, получим исключение 
  static validateStatus (model, prop, value) {
    OrderStatuses.validate(value)
  }

}

````
 

`CallableModel`
---

Базовый класс, реализованный так же через `Proxy` что бы можно было обращаться с обектом как с функцией.

Пример использования:

```js

import { CallableModel } from '@alt-point/active-models'

class Notify extends CallableModel {
  // Теперь можем обработать вызов объекта как функции
  __call (...args) {
      return this.success(...args)
  }
  
  success (successMessage) {
     alert(successMessage)
  }
  
  silent (message) {
    console.log('Silent message:' + message)
  }

}
```

Дальше можем прихреначить объект класса `Notify` как плагин в нухт например и юзать так

```js
// плагин
export default (ctx, inject) => {
  ctx.$notify = new Notify()
  inject('notify', new Notify())
}

// в компоненте теперь можно юзать так: 
this.$notify.silent('Я зачем-то пишу в консоли')
this.$notify('Я ору алертом!')
```

`Enum`
---

`enum` реализованный на `Map`

```js

const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

OrderStatuses.values() // ['new', 'complete', 'shipping']
OrderStatuses.validate('G-gurda') // throw Value must be include one of type: new, complete, 'shipping; Provide value "G-gurda"
OrderStatuses.default // 'new'

```
