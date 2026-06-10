import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/apeira/',
  description: 'A stream-first agent runtime for TypeScript.',
  srcExclude: ['adr/**', 'spark/**'],

  themeConfig: {
    nav: [
      { link: '/getting-started', text: 'Getting Started' },
      { link: '/guide/first-turn', text: 'Guide' },
      { link: '/plugins/', text: 'Plugins' },
    ],

    search: { provider: 'local' },

    sidebar: [
      {
        items: [
          { link: '/getting-started', text: 'Overview' },
          { link: '/installation', text: 'Installation' },
        ],
        text: 'Getting Started',
      },
      {
        items: [
          { link: '/guide/first-turn', text: 'First Turn' },
          { link: '/guide/runners', text: 'Runners' },
          { link: '/guide/agent-lifecycle', text: 'Agent Lifecycle' },
          { link: '/guide/events', text: 'Events' },
        ],
        text: 'Guide',
      },
      {
        items: [
          { link: '/plugins/', text: 'Overview' },
          { link: '/plugins/compact', text: 'Compact' },
          { link: '/plugins/common-tools', text: 'Common Tools' },
          { link: '/plugins/hitl', text: 'HITL' },
          { link: '/plugins/mcp', text: 'MCP' },
          { link: '/plugins/roleplay', text: 'Roleplay' },
          { link: '/plugins/skills', text: 'Skills' },
          { link: '/plugins/ag-ui', text: 'AG-UI' },
        ],
        text: 'Plugins',
      },
      {
        items: [

          { link: '/advanced/plugin-api', text: 'Plugin API' },
        ],
        text: 'Advanced',
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moeru-ai/apeira' },
    ],
  },

  title: 'Apeira',
})
