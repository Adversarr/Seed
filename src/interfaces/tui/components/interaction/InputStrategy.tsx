import React, { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

export type InputStrategyProps = {
  onSubmit: (value: string) => void
}

export const InputStrategy: React.FC<InputStrategyProps> = ({ onSubmit }) => {
  const [inputValue, setInputValue] = useState('')

  return (
    <Box marginTop={1}>
      <Text color="green" bold>{'> '}</Text>
      <TextInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={onSubmit}
      />
    </Box>
  )
}
