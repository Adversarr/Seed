import type { App } from '../app/createApp.js'

export type Props = {
  app: App
}

export type PlainStaticEntry = {
  id: string
  variant: 'plain'
  lines: string[]
  color?: string
  dim?: boolean
  bold?: boolean
}

export type MarkdownStaticEntry = {
  id: string
  variant: 'markdown'
  prefix?: string
  content: string
  color?: string
  dim?: boolean
  bold?: boolean
}

export type StaticEntry = PlainStaticEntry | MarkdownStaticEntry

export type TaskView = {
  taskId: string
  title: string
  status: string
  parentTaskId?: string
  agentId: string
  childTaskIds?: string[]
  depth: number
  summary?: string
  failureReason?: string
}
