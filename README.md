@alt-point/active-models
===

Пакет с базовыми классами на `es6`/`TS` для упрощения работы со структурами данных.

Какие проблемы поможет решить?

- [x] Реализовать модели данных с реактивными свойствами ([`ActiveModel`](#activemodel));
- [x] Контролировать целостность структур данных (`ActiveModel.fillable`, `ActiveModel.hidden`, `ActiveModel.protected`);
- [x] Контролировать тип и целостность данных в каждом конкретном свойстве в рантайме;

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

**Назначение**: контроль целостности структуры и типов данных моделей приходящих из внешних источников/подсистем ([DTO](https://en.wikipedia.org/wiki/Data_transfer_object))

[Пример](docs/active-model.md), иллюстрирующий применение, [пример с декораторами](docs/active-model-with-decorators.md)


Есть ~~2 стула~~ 2 варианта, либо использовать статическое api, либо юзать декораторы:

@Decorators
---


`@ActiveField(opts: ActiveFieldDescriptor)`
####
```ts
type ActiveFieldDescriptor = object & {
    setter?: Setter<any> // ассессор на установку значения
    getter?: Getter<any> // ацессор на получение значения
    validator?: Validator<any> // валидатор на установку значения
    readonly?: boolean // поле модели будет доступно только на чтение
    hidden?: boolean // поле скрыто из перечисляемых свойств
    fillable?: boolean // поле доступно для установки и изменения
    protected?: boolean // запрещено удалять поле из модели
    attribute?: any // Значение по умолчанию для поля модели в момент создания объекта
    value?: any // алиас для `attribute`
}
```

>
> **Notice:**
>
> Для того, что бы были задействованы атрибуты (значения по умолчанию для полей модели) необходимо
> создавать экземпляр модели через фабричный метод `ActiveModel.create(data)`, либо же определить логику установки
> значений в конструкторе явно, например так
>
> ```ts
>  class SomeModeal extends ActiveModel {
>    constructor (data?: any) {
>        super(data)
>        if (data) {
>            this.fill(data)
>        }
>    }
>  }
>```


***


## `CallableModel`

Базовый класс, реализованный также через `Proxy`, чтобы можно было обращаться с объектом как с функцией.

Пример использования:

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

Дальше можем создать объект класса `Notify` как плагин в `Nuxt.js/Vue.js` и использовать:

```js
// плагин
export default (ctx, inject) => {
  ctx.$notify = new Notify()
  inject('notify', new Notify())
}


// в компоненте теперь можно юзать:
this.$notify.silent('Write notice to console!')
this.$notify('Alert!')
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
- [x] TS;
- [ ] Добавить примеры использования моделей на `node.js`;
- [ ] Translate to english and others languages;

### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.com](mailto:surrealistik@alt-point.com?subject=ActiveModels)
