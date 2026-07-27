import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '@alt-point/active-models',
  description: 'Reactive DTO models with Proxy and more useful classes, decorators, and hooks',
  base: '/active-models/',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide (RU)', link: '/active-model-with-decorators' },
      { text: 'Guide (EN)', link: '/active-model-with-decorators_EN' },
      { text: 'GitHub', link: 'https://github.com/alt-point/active-models' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@alt-point/active-models' },
    ],
    sidebar: [
      {
        text: 'Русский',
        items: [
          { text: 'Пример с decorators', link: '/active-model-with-decorators' },
          { text: 'Справочник опций @ActiveField()', link: '/active-field-options' },
          { text: 'Продвинутые возможности', link: '/active-model-advanced' },
          { text: 'Пример для Node.js-сервера', link: '/node-example' },
        ],
      },
      {
        text: 'English',
        items: [
          { text: 'Decorators example', link: '/active-model-with-decorators_EN' },
          { text: '@ActiveField() options reference', link: '/active-field-options_EN' },
          { text: 'Advanced features', link: '/active-model-advanced_EN' },
          { text: 'Node.js server example', link: '/node-example_EN' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/alt-point/active-models' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@alt-point/active-models' },
    ],
    search: {
      provider: 'local',
    },
  },
})
