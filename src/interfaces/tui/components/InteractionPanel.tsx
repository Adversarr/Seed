import React from 'react'
import { Box, Text } from 'ink'
import { ContentDisplay, INTERACTION_STRATEGIES } from './interaction/index.js'
import type { UserInteractionRequestedPayload } from '../../../core/events/events.js'

export type InteractionPanelProps = {
  pendingInteraction: UserInteractionRequestedPayload
  onSubmit: (optionId?: string, inputValue?: string) => void
}

export const InteractionPanel: React.FC<InteractionPanelProps> = ({
  pendingInteraction,
  onSubmit
}) => {
  const { display, options, kind } = pendingInteraction
  const Strategy = INTERACTION_STRATEGIES[kind]

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" padding={1}>
      <Text color="yellow" bold>
        [INTERACTION] {display.title}
      </Text>
      <Box marginY={1}>
        <Text>{display.description}</Text>
      </Box>

      <ContentDisplay display={display} />

      {Strategy ? (
        <Strategy options={options} onSubmit={onSubmit} />
      ) : (
        <Text color="red">Unknown interaction kind: {kind}</Text>
      )}
    </Box>
  )
}
