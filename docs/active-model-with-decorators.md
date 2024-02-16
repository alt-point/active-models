`ActiveModel`
===

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

---

```ts

import { ActiveModel, Enum, ActiveField } from '@alt-point/active-models'
import { Good } from './models'

// Мы хотим контролировать то, что проставляется в поле status, потому определяем enum
export const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

export default class Order extends ActiveModel {
  
  @ActiveField({
    fillable: true
  })
  id?: string = undefined
  
  @ActiveField({
    value: () => [], // что бы не шарился стейт, лучше фабрику передавать для комплексных значений
    // можно через сеттер, это грамоздко, но контрольно
    setter (model: Order, prop: string, value: Array<Good | object> = [], receiver :any) {
      value = (Array.isArray(value) ? value : [])
        .map(item => Good.createLazy(item))
      return Reflect.set(model, prop, value, receiver)
    },
    // либо через фабрику
   factory: [Good, () => []]
  })
  goods: Array<Good> = []  
  
  @ActiveField({
    validator (model, prop, value) {
      OrderStatuses.validate(value)
    }
  })
  status: string = OrderStatuses.default
  
  @ActiveField({
   on: {
     afterSetValue ({ target, prop, value }) {
       Reflect.set(target, 'userId', value?.id)
     }
   }
  })
  user?: User
  
  @ActiveField()
  userId?: string // да, это можно было сделать через геттер, это просто пример для иллюстрации функций
 
  @ActiveField()
  createdAt: string = ''
  
  @ActiveField()
  updatedAt?: string
  
  // Можем сразу подсчитывать количество товаров в заказе
  get goodsCount () {
    return this.goods.length
  }

  // Также можем посчитать вес заказа
  get weight () {
    return this.goods.reduce((a, { weight }) => a + weight, 0)
  }
}

````

В `api`: 

```ts

import { Order } from './models'

class Api {
    $client //  http клиент, в нашем случае будет @nuxt/http

    async ordersList () {
      return await Order.asyncCreateFromCollectionLazy(this.$client.$get('orders/'))
    }

    async ordersCreate (model = new Order()) {
      return Order.createLazy(await this.$client.$post('orders/', Order.createLazy(model)))    
    }
    
    async ordersRead (id: string) {
      return Order.createLazy(await this.$client.$get(`orders/${id}/`))
    }

    async ordersUpdate (id: string, model: Order) {
      return Order.createLazy(await this.$client.$patch(`orders/${id}/`, Order.createLazy(model)))    
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
      this.$emit('save', this.model.clone())      
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
        this.model = Order.create(this.value) // create - разорвёт все ссылки, создаст чистый объект. craeteLazy - поверит на причастность к конструктору и пропустит, если объект является уже инстансом класа
        return
      }
      
      this.loading = true
      this.model = Order.create(await this.$api.ordersRead(this.id))        
      this.loading = false    
    }
  }


}
```
