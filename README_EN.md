@alt-point/active-models
===

A set of tools written in `es6/TS` to make working with data-structures easier.

Problems this package tries to solve:

- [x] Implementing data structures with reactive attributes ([`ActiveModel`](#activemodel));
- [x] Managing the integrity of data structures (`ActiveModel.fillable`, `ActiveModel.hidden`, `ActiveModel.protected`);
- [x] Keeping track of runtime-types and data integrity of each class attribute;

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

# `ActiveModel`
Active model uses [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) behind the scenes.

Purpose: Structure integrity and type checks for incoming data from external sources/subsystems ([DTO](https://en.wikipedia.org/wiki/Data_transfer_object))

[Usage Example](docs/active-model.md)

[Example using decorators](docs/active-model-with-decorators.md)


You can use either static API or decorators:

Decorators
---
`@ActiveField(opts: ActiveFieldDescriptor)`

```ts
type ActiveFieldDescriptor = object & {
    setter?: Setter<any> // setter
    getter?: Getter<any> // getter
    validator?: Validator<any> // validation on setter
    readonly?: boolean // whether the attribute is read only
    hidden?: boolean // whether the attribute is hidden from listings 
    fillable?: boolean // whether the attribute can be set and updated
    protected?: boolean // true if deleting the attribute from the model is prohibited
    attribute?: any // default attribute value during instantiation
    value?: any // alias for `attribute`
}
```

>
> **Notice:**
> 
> In order or attributes (default values) to work, 
> you must create an instance using 
> `ActiveModel.create(data)` factory method, 
> or explicitly set values in the constructor like so:
>
> ```ts
> class MyModel extends ActiveModel {
>     constructor (data?: any) {
>         super(data)
>         if (data) {
>             this.fill(data)
>         }
>     }
> }
>```



Static Api:
---
### `static get $attributes`

*Default value:*  `{}`

*Description:* Default object template structure and value types. 
If no `data` was passed to the constructor, it will be set via `$attributes`

*Example:*

```js
static get $attributes () {
    return {
        id: '',
        login: '',
        password: '',
        createdAt: ''
    }                          
}
```
---
### `static get fillable`

*Default value*: ` [] `

*Description*: Array of attributes that can be set via constructor. If this array is empty, any attribute can be set. 
If this array is non-empty, then only the attributes that are in this array can be set.

*Example:*
```js
static get fillable () {
    return [
        'id',
        'password',
        'property',
        'createdAt'
    ]
}
```
---
### `static protected`

*Default value*: ` [] `

*Description*: Array of attributes that cannot be removed from this object.
If this array is empty, any attribute can be removed.

*Example*:
```js
static get protected () {
    return [
        'id',
        'login',
        'password',
        'createdAt'
    ]
}
```
---
### `static hidden`

*Default value*: ` [] `

*Description*: Array of attributes that should be hidden 
(ignored by `Object.keys`, `Reflect.ownKeys`, `JSON.stringify`, etc.)


*Example*:

```js
static get hidden () {
    return [
        'password'
    ]
}
```
---
### `static setter${PascalPropertyName}(model, prop, value, receiver)`

*Description*: Add a **static** method `setter + PascalCaseAttributeName` (separators `[-_.+*/:? ]` do not count) 
to a class that extends `ActiveModel` to define a setter for its attribute

*Example*:

```js
static setterMyIntegerPropertyName (model, prop, value = 0, receiver) {
    Reflect.set(model, prop, Number.parseInt(value), receiver)
}
``` 
---
### `static getter{PascalPropertyName}(model, prop)`


*Description*: Add a **static** method `getter + PascalCaseAttributeName` (separators [-_.+*/:? ] do not count)
to a class that extends `ActiveModel` to define a getter for its attribute

*Example*:

```js
static getterGoodsSumWeight (model) {
    return model.goods.reduce((a, { weight }) => a + weight, 0)        
}
```
---
### `static sanitize(data)`
*Description*: A static method to clean/sanitize the data passed to the constructor.

By default returns `lodash.cloneDeep(data)`.

***

CallableModel
---
A base class that uses [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
under the hood to be able to operate objects like functions.

Usage example:

```js
import { CallableModel } from '@alt-point/active-models'

class Notify extends CallableModel {
  // Define 
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
You can then create an instance of `Notify` as a `Nuxt.js/Vue.js` plugin and do:

```js
// plugin
export default (ctx, inject) => {
  ctx.$notify = new Notify()
  inject('notify', new Notify())
}


// inside the component you can now do: 
this.$notify.silent('Write notice to console!')
this.$notify('Alert!')
```

## `Enum`
An implementation of `enum` using `Map`

```js
const OrderStatuses = new Enum(['new', 'complete', 'shipping'], 'new')

OrderStatuses.values() // ['new', 'complete', 'shipping']
OrderStatuses.validate('foo') // will throw: Value must be one of: new, complete, shipping; Provided value: "foo"
OrderStatuses.default // 'new'

```

## TODO:
- [ ] More usage examples;
- [ ] Tests;
- [x] TS;
- [ ] Add `node.js` usage examples;
- [x] Translate to english and others languages;

### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
