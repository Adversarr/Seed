import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { DiffView } from './DiffView.js'
import type { UserInteractionRequestedPayload } from '../../domain/events.js'

export type InteractionPanelProps = {
  pendingInteraction: UserInteractionRequestedPayload
  onSubmit: (optionId?: string, inputValue?: string) => void
}

export const InteractionPanel: React.FC<InteractionPanelProps> = ({
  pendingInteraction,
  onSubmit
}) => {
  const { display, options, kind } = pendingInteraction
  // For Select/Confirm
  const [selectedIndex, setSelectedIndex] = useState(0)
  // For Input
  const [inputValue, setInputValue] = useState('')

  useInput((input, key) => {
    // Only handle navigation for Select/Confirm
    if (kind === 'Confirm' || kind === 'Select') {
      if (!options || options.length === 0) return

      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1))
      }
      if (key.downArrow) {
        setSelectedIndex(Math.min(options.length - 1, selectedIndex + 1))
      }
      if (key.return) {
        const selectedOption = options[selectedIndex]
        if (selectedOption) {
          onSubmit(selectedOption.id, undefined)
        }
      }
    }
  })

  const renderContent = () => {
    if (display.contentKind === 'Diff' && typeof display.content === 'string') {
      return <DiffView content={display.content} />
    }
    if (display.content) {
      const text = typeof display.content === 'string' 
        ? display.content 
        : JSON.stringify(display.content, null, 2)
      return <Text>{text}</Text>
    }
    return null
  }

  const renderControls = () => {
    if (kind === 'Input') {
      return (
        <Box marginTop={1}>
          <Text color="green" bold>{'> '}</Text>
          <TextInput 
            value={inputValue} 
            onChange={setInputValue} 
            onSubmit={(val) => onSubmit(undefined, val)} 
          />
        </Box>
      )
    }

    if ((kind === 'Confirm' || kind === 'Select') && options) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Options (Use Arrow Keys + Enter):</Text>
          {options.map((option, index) => {
            const isSelected = index === selectedIndex
            return (
              <Text key={option.id} color={isSelected ? 'blue' : 'white'} bold={isSelected}>
                {isSelected ? '> ' : '  '}
                {option.label}
                {option.isDefault ? ' (Default)' : ''}
              </Text>
            )
          })}
        </Box>
      )
    }

    return null
  }

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" padding={1}>
      <Text color="yellow" bold>
        [INTERACTION] {display.title}
      </Text>
      <Box marginY={1}>
        <Text>{display.description}</Text>
      </Box>

      {renderContent()}
      {renderControls()}
    </Box>
  )
}
