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
  id: string = ''
  
  @ActiveField({
    fillable: true,
    value: [],
    setter (model: Order, prop: string, value: Array<Good | object> = [], receiver :any) {
      value = (Array.isArray(value) ? value : [])
        .map(item => Good.create(item))
      Reflect.set(model, prop, value, receiver)
    }
  })
  goods: Array<Good> = []  
  
  @ActiveField({
    fillable: true,
    validator (model, prop, value) {
      OrderStatuses.validate(value)
    }
  })
  status: string = OrderStatuses.default

  @ActiveField({
    fillable: true
  })
  createdAt: string = ''
  
  @ActiveField({
    fillable: true
  })
  updatedAt: string = ''
  
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
      return (await this.$client.$get('orders/')).map(o => Order.create(o))
    }

    async ordersCreate (model = new Order()) {
      return Order.create(await this.$client.$post('orders/', Order.create(model)))    
    }
    
    async ordersRead (id: string) {
      return Order.create(await this.$client.$get(`orders/${id}/`))
    }

    async ordersUpdate (id: string, model: Order) {
      return Order.create(await this.$client.$patch(`orders/${id}/`, Order.create(model)))    
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
        this.model = Order.create(this.value)
        return
      }
      
      this.loading = true
      this.model = Order.create(await this.$api.ordersRead(this.id))        
      this.loading = false    
    }
  }


}
```
