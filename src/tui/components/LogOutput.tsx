import React from 'react'
import { Box, Text, Static } from 'ink'
import type { StaticEntry } from '../types.js'
import { renderMarkdownToTerminalText } from '../utils.js'

type Props = {
  entries: StaticEntry[]
  width: number
}

export function LogOutput({ entries, width }: Props) {
  return (
    <Static items={entries}>
      {(entry) => (
        <Box key={entry.id} flexDirection="column" paddingX={1}>
          {entry.variant === 'plain' ? (
            entry.lines.map((line, index) => (
              <Text
                key={`${entry.id}-${index}`}
                color={entry.color}
                dimColor={entry.dim}
                bold={entry.bold}
              >
                {line}
              </Text>
            ))
          ) : (
            <Text color={entry.color} dimColor={entry.dim} bold={entry.bold}>
              {entry.prefix ?? ''}
              {renderMarkdownToTerminalText(entry.content, width - 4)}
            </Text>
          )}
        </Box>
      )}
    </Static>
  )
}
