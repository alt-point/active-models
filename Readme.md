@alt-point/active-models
===

Пакет с базовыми классами на `es6` для упрощения работы со структурами данных.

Какие проблемы поможет решить?

- [x] Внедрить в модели данных с реактивными свойствами ([`ActiveModel`](#activemodel));

- [x] Контролировать целостность структур данных (`ActiveModel.$attributes`, `ActiveModel.setter${PascalPropertyName}`, `ActiveModel.getter${PascalPropertyName}`);

- [x] Контролировать тип данных в каждом конкретном свойстве (`ActiveModel.validate${PascalPropertyName}`);

- [x] Реагировать на изменение данных внутри модели *налету*;

Installation
---

yarn

```bash
yarn add @alt-point/active-models
```

npm

```bash
npm install --save @alt-point/active-models
```

## `ActiveModel`

Класс реализован с использованием [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy).
Даёт возможность на уровне дочерних классов добавлять обработчики, вызываемые в момент запроса и установки значения свойств объекта (`setter`, `getter`).


**Мотивация**

Если в проекте моделей данных много, либо они используются в разных местах одни и те же, 
 то логично для этого использовать классы, описывающие эти структуры данных и их взаимоотношения.

Классический случай модель `Order` используется в листинге заказов, 
при *создании заказа* (`create`), при *обновлении заказа* (`update`), при *чтении данных заказа* (`read`), 
а так же в вызовах api.

В компонентах:

 - Листинг заказов;
 - Просмотр одного заказа;
 - Создание заказа;
 - Обновление данных заказа;

В `api` (*условно*):

- `ordersList()` - возвращает массив с объектами заказов;
- `ordersCreate(model)` - ждёт, что в него передадут данные модели заказа;
- `ordersRead(id)` - по `id` запрашивает с бекенда модель заказа;
- `ordersUpdate(id, model)` - по `id` обновляет модель данных на бекенде;

Итого, мы имеем в 8 местах в проекте работу с одинаковой моделью данных.

---

Как этот кейс можно решить с помощью `ActiveModel`

```js

import { ActiveModel, Enum } from '@alt-point/active-models'
import { Good } from './models'
// Мы хотим контролировать то, что проставляется в поле status, потому определяем enum
export const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

export default class Order extends ActiveModel {
  // Контролируем, что из сырых данных, переданных в конструктор, мы заберём только этот список полей
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
      createdAt: '',
      updatedAt: ''
    } 
  }
  
  // В свойстве goods мы хотим, чтобы были только объекты класса Goods
  //
  static setterGoods (model, prop, value = [], receiver) {
    value = (Array.isArray(value) ? value : [])
      .map(item => !(item instanceof Good) ? new Good(item) : item)
    Reflect.set(model, prop, value, receiver)
  }

  // Можем сразу подсчитывать количество товаров в заказе
  static getterGoodsCount (model) {
    return model.goods.length
  }

  // Также можем посчитать вес заказа
  static getterWeight (model) {
    return model.goods.reduce((a, { weight }) => a + weight, 0)
  }
  
  // Если передадим некорректное значение статуса, получим исключение 
  static validateStatus (model, prop, value) {
    OrderStatuses.validate(value)
  }

}

````

В `api`: 

```js

import { Order } from './models'

class Api {
    $client //  http клиент, в нашем случае будет @nuxt/http

    async ordersList () {
      return (await this.$client.$get('orders/')).map(o => new Order(o))
    }

    async ordersCreate (model = new Order()) {
      return new Order(await this.$client.$post('orders/', new Order(model)))    
    }
    
    async ordersRead (id) {
      return new Order(await this.$client.$get(`orders/${id}/`))
    }

    async ordersUpdate (id, model) {
      return new Order(await this.$client.$patch(`orders/${id}/`, new Order(model)))    
    }

}
  ///


```

Теперь мы можем быть уверены, что в компонентах будут именно те структуры данных, которые мы ожидаем.
На примере фрагмента компонента создания/редактирования заказа:

```js
import { Order } from './models'

export default {
  name: 'OrderForm',
  props: {
    // Если работаем с данными с сервера, передаём айдишник
    id: {
      type: String,
      default () {
        return ''
      }
    },
    // если работаем как с инпутом с v-model, принимаем модель целиком
    value: {
      type: Order,
      default () {
        return new Order()
      }
    },
    // по умолчанию работаем в "серверном" режиме
    serverMode: {
      type: Boolean,
      default () {
        return true
      }
    }
  },
  model: {
    prop: 'value',
    event: 'save'
  },  
  data () {
    return {
      model: new Order(),      
      loading: false
    }
  },
  watch: {
    id: {
      immediate: true,
      handler (n, p) {
        if (!this.serverMode) {
          return
        }
        if (n === p) {
          return false
        }
    
        this.load()
      }
    },
    value: {
      immediate: true,
      handler (n, p) {
        if (this.serverMode) {
          return
        }
        if (JSON.stringify(n) !== JSON.stringify(p) || JSON.stringify(n) !== JSON.stringify(this.model)) {
          this.load()
        }
      }
    }
  },
  methods: {
    saveModel () {
      // Эмитим данные модели внаружу  
      this.$emit('save', new Order(this.model))      
    },
    // обработчик сохранения формы
    async save () {
      if (!this.serverMode) {
        this.saveModel()
        return
      }    
      this.loading = true
      
      try {
        if (this.id) {
          const result = await this.$api.ordersUpdate(this.id, this.model)
          this.$emit('update', result)
        } else {
          const result = await this.$api.ordersCreate(this.model)
          this.$emit('create', result)
        }
        
        await this.saveModel()
        
        this.loading = false
      } catch (e) {
        // eslint-disable-next-line
        console.warn(e)
        this.loading = false
      }
    },
    async load () {
      // если нет айдишника - заполняем model из props.value
      if (!this.id) {
        this.model = new Order(this.value)
        return
      }
      
      this.loading = true
      this.model = new Order(await this.$api.ordersRead(this.id))        
      this.loading = false    
    }
  }


}
```


***
 

## `CallableModel`

Базовый класс, реализованный также через `Proxy`, чтобы можно было обращаться с объектом как с функцией.

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

Дальше можем создать объект класса `Notify` как плагин в `Nuxt.js/Vue.js` и использовать:

```js
// плагин
export default (ctx, inject) => {
  ctx.$notify = new Notify()
  inject('notify', new Notify())
}

// в компоненте теперь можно юзать: 
this.$notify.silent('Я зачем-то пишу в консоли')
this.$notify('Я ору алертом!')
```

## `Enum`
`enum` реализованный на `Map`

```js

const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

OrderStatuses.values() // ['new', 'complete', 'shipping']
OrderStatuses.validate('G-gurda') // throw Value must be include one of type: new, complete, 'shipping; Provide value "G-gurda"
OrderStatuses.default // 'new'

```

## TODO:
- [ ] Добавить больше примеров использования;

- [ ] Добавить примеры использования моделей на `node.js`;


### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
