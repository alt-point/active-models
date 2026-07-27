import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: '@alt-point/active-models',
  description: 'Reactive DTO models with Proxy and more useful classes, decorators, and hooks',
  base: '/active-models/',
  cleanUrls: true,
  themeConfig: {
    // shared across all locales
    socialLinks: [
      { icon: 'github', link: 'https://github.com/alt-point/active-models' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@alt-point/active-models' },
    ],
    search: {
      provider: 'local',
    },
  },
  locales: {
    root: {
      label: 'Русский',
      lang: 'ru',
      link: '/',
      themeConfig: {
        nav: [
          { text: 'Главная', link: '/' },
          { text: 'Пример с decorators', link: '/active-model-with-decorators' },
          { text: 'Жизненный цикл', link: '/model-lifecycle' },
          { text: 'GitHub', link: 'https://github.com/alt-point/active-models' },
        ],
        sidebar: [
          {
            text: 'Руководство',
            items: [
              { text: 'Пример с decorators', link: '/active-model-with-decorators' },
              { text: 'Справочник опций @ActiveField()', link: '/active-field-options' },
              { text: 'Жизненный цикл модели', link: '/model-lifecycle' },
              { text: 'Продвинутые возможности', link: '/active-model-advanced' },
              { text: 'Пример для Node.js-сервера', link: '/node-example' },
            ],
          },
        ],
        outline: {
          label: 'На этой странице',
        },
        docFooter: {
          prev: 'Предыдущая страница',
          next: 'Следующая страница',
        },
        darkModeSwitchLabel: 'Тема',
        returnToTopLabel: 'Наверх',
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Decorators example', link: '/en/active-model-with-decorators' },
          { text: 'Lifecycle', link: '/en/model-lifecycle' },
          { text: 'GitHub', link: 'https://github.com/alt-point/active-models' },
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'Decorators example', link: '/en/active-model-with-decorators' },
              { text: '@ActiveField() options reference', link: '/en/active-field-options' },
              { text: 'Model lifecycle', link: '/en/model-lifecycle' },
              { text: 'Advanced features', link: '/en/active-model-advanced' },
              { text: 'Node.js server example', link: '/en/node-example' },
            ],
          },
        ],
      },
    },
  },
}))
