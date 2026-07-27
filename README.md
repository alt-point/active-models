@alt-point/active-models
===

[![npm version](https://img.shields.io/npm/v/@alt-point/active-models.svg)](https://www.npmjs.com/package/@alt-point/active-models)
[![npm downloads](https://img.shields.io/npm/dm/@alt-point/active-models.svg)](https://www.npmjs.com/package/@alt-point/active-models)
[![CI](https://github.com/alt-point/active-models/actions/workflows/ci.yml/badge.svg)](https://github.com/alt-point/active-models/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@alt-point/active-models.svg)](https://github.com/alt-point/active-models/blob/master/LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)

Пакет с базовыми классами на `TS` для упрощения работы со структурами данных.

**[📖 Документация](https://alt-point.github.io/active-models/)**

Какие проблемы поможет решить?

#### Реактивные модели данных с контролируемыми свойствами

Как реализовать модель данных, в которой каждое свойство можно перехватывать при чтении, записи и
удалении — без ручного написания геттеров/сеттеров для каждого поля? [`ActiveModel`](#activemodel)
оборачивает инстанс в `Proxy` и предоставляет декоратор `@ActiveField()`, который на уровне одного поля
позволяет задать `setter`/`getter`, значение по умолчанию, а также подписаться на события изменения через
`on`/`once`.

#### Целостность структуры данных

Как защититься от того, что внешние данные (например, ответ API) случайно перезапишут защищённое поле,
удалят обязательный атрибут или добавят в модель лишние ключи, которых там быть не должно? Опции
`fillable`, `readonly`, `protected` и `hidden` в `@ActiveField()` дают точечный контроль: `fillable: false`
и `readonly: true` запрещают изменение значения после создания, `protected` не даёт удалить свойство через
`delete`, а `hidden` исключает поле из перечисления (`Object.keys`, `JSON.stringify`), оставляя его при
этом доступным напрямую.

#### Контроль типов и целостности данных в рантайме

TypeScript проверяет типы только на этапе компиляции, а данные из внешних источников (API, localStorage,
WebSocket) приходят в рантайме и типами не гарантированы. `validator` в `@ActiveField()` выполняется при
каждой попытке установить значение и бросает исключение, если данные не подходят под ожидаемый
тип/формат; `factory` дополнительно позволяет автоматически оборачивать вложенные структуры в собственные
`ActiveModel`, сохраняя типизацию и валидацию на любом уровне вложенности.

#### Подписка на изменения данных в свойствах модели

Как узнать, что конкретное поле модели изменилось, было обнулено или удалено — не оборачивая каждое
присваивание в собственный код? События `beforeSetValue`, `afterSetValue`, `nulling`,
`beforeDeletingAttribute` (через `on`/`once` в декораторе), а также `touched`/`created` на уровне всего
инстанса (`model.emitter.on(...)`) дают единую точку для side-эффектов: логирования, синхронизации с UI,
инвалидации кэша и т. п.

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


bun

```bash
bun add @alt-point/active-models
```

## `ActiveModel`

Класс реализован с использованием [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy).

**Назначение**: контроль целостности структуры и типов данных моделей приходящих из внешних источников/подсистем ([DTO](https://en.wikipedia.org/wiki/Data_transfer_object))

[Пример](docs/active-model-with-decorators.md), иллюстрирующий применение

Дополнительно:
- [Справочник опций `@ActiveField()`](docs/active-field-options.md) — каждая опция по отдельности: что делает, на что влияет, с примерами
- [Жизненный цикл модели](docs/model-lifecycle.md) — все события от создания до удаления, с диаграммой
- [Продвинутые возможности](docs/active-model-advanced.md) — валидаторы, хуки `on`/`once`, разница между `new Model()`/`create()`/`fill()`, сериализация, `mapTo()`
- [Пример для Node.js-сервера](docs/node-example.md) — без Vue/Nuxt, на чистом `node:http`


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
    factory?: typeof ActiveModel | [typeof ActiveModel, () => ActiveModel] // Фабрика (extends ActiveModel) для обработки значения. Массивы так же обрабатывает.
    on?: // листенеры на события модельки, цепляются на конкретное свойство
      beforeSetValue?: ({ target, prop, value, oldValue }) => void // вызовется перед установкой значение 
      afterSetValue?: ({ target, prop, value, oldValue }) => void // сразу после установки значения
      beforeDeletingAttribute?: ({ target, prop }) => void // перед удалением свойства из модели
      nulling?: ({ target, prop, value, oldValue }) => void  // если у свойства было значение и вместо него установили null
    once?: // всё тоже самое, что и в on
}
```

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

## TODO:
- [ ] add more examples for more platforms;


### Credits
[Alex D. Bubenchikov](https://t.me/surrealistik), [surrealistik@alt-point.ru](mailto:surrealistik@alt-point.com?subject=ActiveModels)
