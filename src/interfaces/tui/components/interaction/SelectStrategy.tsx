import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

export type SelectStrategyProps = {
  options: Array<{ id: string, label: string, isDefault?: boolean }>
  onSubmit: (optionId: string) => void
}

export const SelectStrategy: React.FC<SelectStrategyProps> = ({ options, onSubmit }) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useInput((input, key) => {
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
        onSubmit(selectedOption.id)
      }
    }
  })

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
