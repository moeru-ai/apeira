import { GLOB_MARKDOWN_CODE } from '@antfu/eslint-config'
import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({
  react: true,
  unocss: true,
})
  .append({
    ignores: ['examples/copilotkit/src/components/ui/**'],
  })
  .append({
    rules: {
      '@masknet/jsx-prefer-test-id': 'off',
    },
  })
  .append({
    files: [GLOB_MARKDOWN_CODE],
    rules: {
      'sonarjs/unused-import': 'off',
    },
  })
