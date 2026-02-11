import React from 'react'
import { Text, Box } from 'ink'

export type DiffViewProps = {
  content: string
}

export const DiffView: React.FC<DiffViewProps> = ({ content }) => {
  const lines = content.split('\n')

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        let color = 'white'
        if (line.startsWith('+')) color = 'green'
        else if (line.startsWith('-')) color = 'red'
        else if (line.startsWith('@')) color = 'cyan'

        return (
          <Text key={index} color={color}>
            {line}
          </Text>
        )
      })}
    </Box>
  )
}
