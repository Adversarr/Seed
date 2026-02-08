import React from 'react'
import { Box, Text } from 'ink'
import type { UserInteractionRequestedPayload } from '../../domain/events.js'
import type { TaskView } from '../types.js'
import { InteractionPanel } from './InteractionPanel.js'
import { StatusBar } from './StatusBar.js'
import { InputPrompt } from './InputPrompt.js'

type Props = {
  separatorLine: string
  statusLine: string
  pendingInteraction: UserInteractionRequestedPayload | null
  onInteractionSubmit: (optionId?: string, inputValue?: string) => void
  inputValue: string
  onInputChange: (value: string) => void
  onInputSubmit: (value: string) => void
  focusedTask: TaskView | undefined
  columns: number
}

export function InteractionPane({
  separatorLine,
  statusLine,
  pendingInteraction,
  onInteractionSubmit,
  inputValue,
  onInputChange,
  onInputSubmit,
  focusedTask,
  columns
}: Props) {
  return (
    <>
      <Text dimColor>{separatorLine}</Text>
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">{statusLine || ' '}</Text>

        {pendingInteraction ? (
          <InteractionPanel
            pendingInteraction={pendingInteraction}
            onSubmit={onInteractionSubmit}
          />
        ) : (
          <InputPrompt
            inputValue={inputValue}
            onInputChange={onInputChange}
            onInputSubmit={onInputSubmit}
          />
        )}
      </Box>

      <StatusBar focusedTask={focusedTask} columns={columns} />
    </>
  )
}
