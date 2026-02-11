import React from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

type Props = {
  inputValue: string
  onInputChange: (value: string) => void
  onInputSubmit: (value: string) => void
}

export function InputPrompt({ inputValue, onInputChange, onInputSubmit }: Props) {
  return (
    <Box>
      <Text color="cyan">{'> '}</Text>
      <TextInput value={inputValue} onChange={onInputChange} onSubmit={onInputSubmit} />
    </Box>
  )
}
