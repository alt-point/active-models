`ActiveModel`
===

If your project has a lot of data models, or the same models are used throughout the project,
then it makes sense to create classes that represent these data structures and their relations.

Takel the classic example of `Order`.
The same class is used:
- In listings;
- In order creation (`create`);
- In order updates (`update`);
- To update the existing order;
- To display details or perform API calls

In components:

- Order list;
- Get data of concrete order;
- Create a new order;
- Update the existing order;

In API (*template methods*):

- `ordersList()` - Get a list of `Order` objects;
- `ordersCreate(model)` - create a new `Order`. Concrete Order details are provided by `model`;
- `ordersRead(id)` - uses `id` to fetch an `Order` from backend;
- `ordersUpdate(id, model)` - uses `id` to update existing `Order` on backend with data from `model`;

Overall, this sums up to 8 places inside our project where we use the same data model

---

This can be easily solved by using `ActiveModel`

```js
import { ActiveModel, Enum } from '@alt-point/active-models'
import { Item } from './models'

// We need to have control of Order status, thus we define an enum
export const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

export default class Order extends ActiveModel {
  // Here we make sure to only use these attributes from the raw incoming data 
  static get fillable () {
    return [
      'items',
      'id',
      'status',
      'createdAt',
      'updatedAt'  
    ]  
  }
  
  // Define a default object structure
  static get $attributes () {
    return {
      items: [],
      id: '',
      status: OrderStatuses.default,
      createdAt: '',
      updatedAt: ''
    } 
  }
  
  // We want only instances of `Item` class to be inside of this array 
  static setterGoods (model, prop, value = [], receiver) {
    value = (Array.isArray(value) ? value : [])
      .map(item => !(item instanceof Item) ? new Item(item) : item)
    Reflect.set(model, prop, value, receiver)
  }

  // We can easily count the amount of `Item`s inside our Order
  static getterItemsCount (model) {
    return model.items.length
  }

  // We can easily calculate the weight of the Order
  static getterWeight (model) {
    return model.items.reduce((a, { weight }) => a + weight, 0)
  }
  
  // If we pass illegal value for Status, this will throw
  static validateStatus (model, prop, value) {
    OrderStatuses.validate(value)
  }
}
````

Inside of API:

```js
import { Order } from './models'

class Api {
    $client //  http-client, `@nuxt/http` in this case

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

This way we can be sure the components are working with the correct data types.

This is an example of a component for creating/updating an `Order`

```js
import { Order } from './models'

export default {
  name: 'OrderForm',
  props: {
    // If data is incoming from the backend, we need to use an id
    id: {
      type: String,
      default () {
        return ''
      }
    },
    // In case we need it for a v-model input, we need a whole class
    value: {
      type: Order,
      default () {
        return new Order()
      }
    },
    // the default is `serverMode`
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
      // emit data  
      this.$emit('save', new Order(this.model))      
    },
    // handler of form saving
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
      // if id === null, fill model from props.value
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
