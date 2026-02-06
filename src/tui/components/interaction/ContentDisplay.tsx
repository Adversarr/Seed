import React from 'react'
import { Text } from 'ink'
import { DiffView } from '../DiffView.js'

export type ContentDisplayProps = {
  display: {
    contentKind?: string
    content?: any
  }
}

export const ContentDisplay: React.FC<ContentDisplayProps> = ({ display }) => {
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
