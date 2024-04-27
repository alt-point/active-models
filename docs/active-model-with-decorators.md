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

```typescript

import { ActiveModel, Enum, ActiveField } from '@alt-point/active-models'
import { Good } from './models'

enum OrderStatuses { 
  new = 'new',
  complete = 'complete',
  shipping = 'shipping' 
}

export class Order extends ActiveModel {
  
  @ActiveField()
  id?: string = undefined
  
  @ActiveField({
    value: () => [], // что бы не шарился стейт, лучше фабрику передавать для комплексных значений
    // можно через сеттер, это грамоздко, но контрольно
    setter (model: Order, prop: string, value: Array<Good | object> = [], receiver :any) {
      return Reflect.set(model, prop, Good.createFromCollectionLazy(value), receiver)
    },
    // либо через фабрику
   factory: [Good, () => []]
  })
  goods: Array<Good> = []  
  
  @ActiveField(OrderStatuses.new)
  status: OrderStatuses = OrderStatuses.new
  
  @ActiveField({
   on: {
     afterSetValue ({ target, prop, value }) {
       Reflect.set(target, 'userId', value?.id) // после установки значения в свойство user, фиксируем его идентификатор в значение поля `userId`
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

```typescript

import { Order } from './models'

class Api {
    readonly $client: HTTPClient //  http клиент, в нашем случае будет @nuxt/http

    async ordersList () {
      // Получаем по api масив заказов, используем асинхронную фабрику
      return await Order.asyncCreateFromCollectionLazy(this.$client.$get<Order[]>('orders/'))
    }

    ordersCreate (model: Order) {
      return Order.asyncCreateLazy( //  вслучае, если после созданяия нам возвращается модель, а не только идентификатор
        this.$client.$post<Order>('orders/', 
          Order.createLazy(model) // приводим тип к структуре в рантайме через ленивую фабрику
        )
      )    
    }
    
    ordersRead (id: string) {
      return Order.asyncCreateLazy(athis.$client.$get<Order>(`orders/${id}/`))
    }
    
    async ordersUpdate (id: string, model: Order) {
      return Order.asyncCreateLazy(
        this.$client.$patch<Order>(`orders/${id}/`, 
          Order.createLazy(model)
        )
      )    
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
        this.model = Order.create(this.value) // create - разорвёт все ссылки, создаст чистый объект. craeteLazy - поверит на причастность к конструктору и пропустит, если объект уже является инстансом класcа
        return
      }
      
      this.loading = true
      this.model = await this.$api.ordersRead(this.id)        
      this.loading = false    
    }
  }


}
```
