import { transformerTwoslash } from '@shikijs/vitepress-twoslash'
import { extendConfig } from '@voidzero-dev/vitepress-theme/config'

export default extendConfig({
  description: 'stream-first Agent Runtime.',
  head: [['link', { href: 'https://github.com/moeru-ai.png', rel: 'icon', type: 'image/png' }]],
  markdown: {
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            types: ['node'],
          },
        },
      }),
    ],
    languages: ['js', 'jsx', 'ts', 'tsx', 'sh', 'bash', 'shell'],
  },
  srcExclude: ['adr/**', 'spark/**'],

  themeConfig: {
    nav: [
      { link: '/overview', text: 'Get Started' },
      { link: '/guide/agent', text: 'Guide' },
      { link: '/plugins/', text: 'Plugins' },
      { link: '/references/', text: 'References' },
    ],

    search: { provider: 'local' },

    sidebar: [
      {
        items: [
          { link: '/overview', text: 'Overview' },
          { link: '/quickstart', text: 'Quickstart' },
        ],
        text: 'Getting Started',
      },
      {
        items: [
          { link: '/guide/agent', text: 'Agent' },
          { link: '/guide/input', text: 'Input' },
          { link: '/guide/state', text: 'State' },
          { link: '/guide/event', text: 'Event' },
          { link: '/guide/tools', text: 'Tools' },
          { link: '/guide/runner', text: 'Runner' },
          { link: '/guide/storage', text: 'Storage' },
          { link: '/guide/entry', text: 'Entry' },
          { link: '/guide/session', text: 'Session' },
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
          { link: '/references/', text: 'Overview' },
          { link: '/references/agent-channel', text: 'AgentChannel' },
          { link: '/references/agent-plugin', text: 'AgentPlugin' },
          { link: '/references/agent-queue', text: 'AgentQueue' },
          { link: '/references/agent-state-manager', text: 'AgentStateManager' },
        ],
        text: 'References',
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moeru-ai/apeira' },
    ],

    variant: 'voidzero',
  },

  title: 'Apeira',
})
