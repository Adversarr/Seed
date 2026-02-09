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
  breadcrumb?: string[]
  activeAgentId?: string
  activeProfile?: string
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
  columns,
  breadcrumb,
  activeAgentId,
  activeProfile
}: Props) {
  // Mode indicator: show what bare text input will do
  const modeHint = focusedTask
    ? `→ /continue to "${focusedTask.title.slice(0, 30)}"`
    : '→ /new task'
  const isSubtask = focusedTask && focusedTask.depth > 0

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
          <Box flexDirection="column">
            {/* Mini-breadcrumb + mode indicator */}
            <Box>
              {isSubtask && breadcrumb && breadcrumb.length > 1 ? (
                <Text dimColor color="cyan">
                  {breadcrumb.join(' › ')} │{' '}
                </Text>
              ) : null}
              <Text dimColor>{modeHint}</Text>
            </Box>
            <InputPrompt
              inputValue={inputValue}
              onInputChange={onInputChange}
              onInputSubmit={onInputSubmit}
            />
          </Box>
        )}
      </Box>

      <StatusBar focusedTask={focusedTask} columns={columns} breadcrumb={breadcrumb} activeAgentId={activeAgentId} activeProfile={activeProfile} />
    </>
  )
}
