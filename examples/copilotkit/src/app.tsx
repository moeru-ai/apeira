/* eslint-disable @masknet/jsx-prefer-test-id */
/* eslint-disable @masknet/browser-no-persistent-storage */

import { createAgent } from '@apeira/core'
import { agui } from '@apeira/plugin-ag-ui'
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from '@copilotkit/react-core/v2'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useMemo } from 'react'

import { BrowserApeiraAgent } from './utils/agent'
import { AGENT_ID, AGENT_NAME, DEFAULT_BASE_URL, DEFAULT_INSTRUCTIONS, DEFAULT_MODEL } from './utils/const'

import '@copilotkit/react-ui/v2/styles.css'

export const App = () => {
  const [baseURL, setBaseURL] = useLocalStorage('apeira:copilotkit:base-url', DEFAULT_BASE_URL)
  const [apiKey, setApiKey] = useLocalStorage('apeira:copilotkit:api-key', '')
  const [model, setModel] = useLocalStorage('apeira:copilotkit:model', DEFAULT_MODEL)

  const apeiraAgent = useMemo(() => createAgent({
    instructions: DEFAULT_INSTRUCTIONS,
    name: AGENT_NAME,
    options: {
      apiKey,
      baseURL,
      model,
    },
    plugins: [
      {
        name: 'browser-storage',
        storage: localStorage,
      },
      agui(),
    ],
  }), [apiKey, model])

  const copilotAgent = useMemo(
    () => new BrowserApeiraAgent({ agent: apeiraAgent }),
    [apeiraAgent],
  )

  return (
    <div style={{
      display: 'grid',
      gap: 12,
      gridTemplateRows: 'auto 1fr',
      height: '100dvh',
      padding: 16,
    }}
    >
      <div style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: 'minmax(0, 1fr) 220px',
      }}
      >
        <input
          autoComplete="off"
          onChange={event => setBaseURL(event.target.value)}
          placeholder="OpenAI API Base URL"
          value={baseURL}
        />
        <input
          autoComplete="off"
          onChange={event => setApiKey(event.target.value)}
          placeholder="OpenAI API Key"
          type="password"
          value={apiKey}
        />
        <input
          autoComplete="off"
          onChange={event => setModel(event.target.value)}
          placeholder="Model"
          value={model}
        />
      </div>

      <div style={{ minHeight: 0 }}>
        <CopilotKitProvider agents__unsafe_dev_only={{ [AGENT_ID]: copilotAgent }}>
          <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId="default">
            <CopilotChat
              labels={{
                welcomeMessageText: apiKey.length > 0
                  ? 'Hi! Ask anything.'
                  : 'Set an OpenAI API key to start chatting.',
              }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      </div>
    </div>
  )
}
