---
layout: home

hero:
  name: "@alt-point/active-models"
  text: Reactive DTO models with Proxy
  tagline: Базовые классы на TS для упрощения работы со структурами данных — реактивные поля, контроль целостности, декларативная валидация.
  actions:
    - theme: brand
      text: Пример с decorators
      link: /active-model-with-decorators
    - theme: alt
      text: Справочник опций @ActiveField()
      link: /active-field-options
    - theme: alt
      text: GitHub
      link: https://github.com/alt-point/active-models

features:
  - title: "ActiveModel"
    details: Proxy-based модель с контролем целостности данных (fillable, hidden, protected, readonly) и типов в рантайме — для DTO из внешних источников.
  - title: "@ActiveField() decorators"
    details: setter, getter, validator, factory, hуки on/once — декларативное описание поведения каждого поля. Полный справочник опций с примерами.
  - title: "CallableModel"
    details: Базовый класс, с которым инстанс можно вызывать как функцию — удобно для Nuxt.js/Vue.js плагинов.
---

## Установка

::: code-group

```bash [yarn]
yarn add @alt-point/active-models
```

```bash [npm]
npm install --save @alt-point/active-models
```

```bash [bun]
bun add @alt-point/active-models
```

:::

## Документация

**Русский:**
- [Пример с decorators](/active-model-with-decorators) — базовый воркфлоу на примере модели заказа
- [Справочник опций `@ActiveField()`](/active-field-options) — каждая опция по отдельности, с примерами
- [Продвинутые возможности](/active-model-advanced) — валидаторы, хуки, `new`/`create`/`fill`, сериализация, `mapTo()`
- [Пример для Node.js-сервера](/node-example) — без Vue/Nuxt, на чистом `node:http`

**English:**
- [Decorators example](/active-model-with-decorators_EN)
- [`@ActiveField()` options reference](/active-field-options_EN)
- [Advanced features](/active-model-advanced_EN)
- [Node.js server example](/node-example_EN)
