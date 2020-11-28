@alt-point/active-models
===

Пакет с базовыми классами на `es6` для упрощения работы со структурами данных.

Какие проблемы поможет решить?

- [x] Реализовать модели данных с реактивными свойствами ([`ActiveModel`](#activemodel));
- [x] Контролировать целостность структур данных (`ActiveModel.$attributes`, `ActiveModel.fillable`, `ActiveModel.hidden`, `ActiveModel.required`);
- [x] Контролировать тип данных в каждом конкретном свойстве (`ActiveModel.validate${PascalPropertyName}`);

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
Даёт возможность на уровне дочерних классов добавлять обработчики, вызываемые в момент запроса и установки значения 
свойств объекта (`setter`, `getter`).

[Пример](docs/active-model.md), иллюстрирующий применение

#### `$attributes`

*Default value:*  `{}`

*Description:* Структура объекта по умолчанию, а так же значения свойств по умолчанию. Даже если значение не 
передано в `data` в конструкторе, будет установлено из `$attributes`

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

#### `fillable`

*Default value*: ` [] `

*Description*: Массив имён свойств, которые могут быть установлены через конструктор. Если массив пуст, 
то можно устанавливать любые свойства.

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

#### `required`

*Default value*: ` [] `

*Description*: Массив имён свойств, которые запрещено удалять у объекта, если массив пустой, 
то удалять можно любые свойства. 

*Example*:
```js
    static get required () {
        return [
            'id',
            'login',
            'password',
            'createdAt'
        ]
    }
```

#### `hidden`

*Default value*: ` [] `

*Description*: Массив имён свойств, которые не должны быть перечисляемыми, а следовательно и не будут попадать в `JSON.stringify`

*Example*:

```js
    static get hidden () {
        return [
            'password'
        ]
    }

```

#### `static setter${PascalPropertyName}(model, prop, value, receiver)`

*Description*: Для того что бы определить *сеттер* для свойства модели необходимо добавить классу, унаследованному от `ActiveModel`
 **статический** метод с префиксом `setter` + имя в `PascalCase` свойства (разделители `[-_.+*/:? ]` не будут учитываться)
 
*Example*:

```js
    setterMyIntegerPropertyName (model, prop, value = 0, receiver) {
        Reflect.set(model, prop, Number.parseInt(value), receiver)
    }
``` 
   

#### `static getter{PascalPropertyName}(model, prop)`
*Description*: Для того что бы определить *геттер* для свойства модели необходимо добавить классу, унаследованному от `ActiveModel` 
**статический** метод с префиксом `getter` + имя в `PascalCase` свойства (разделители `[-_.+*/:? ]` не будут учитываться)


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
- [ ] Тесты;
- [ ] TS?;
- [ ] Добавить примеры использования моделей на `node.js`;
- [ ] Перевести на английский readme;

### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
