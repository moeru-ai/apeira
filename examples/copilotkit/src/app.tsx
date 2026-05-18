import { CopilotChat } from '@copilotkit/react-core/v2'

import '@copilotkit/react-ui/v2/styles.css'

export const App = () => (
  <CopilotChat
    labels={{
      welcomeMessageText: 'Hi! How can I assist you today?',
    }}
  />
)
