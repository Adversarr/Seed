import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { ArtifactRef } from '../domain/task.js'
import type { TaskView } from './taskService.js'

function readFileRange(absolutePath: string, lineStart: number, lineEnd: number): string {
  const raw = readFileSync(absolutePath, 'utf8')
  const lines = raw.split('\n')
  const startIdx = Math.max(0, lineStart - 1)
  const endIdx = Math.min(lines.length - 1, lineEnd - 1)
  const slice = lines.slice(startIdx, endIdx + 1)
  const numbered = slice.map((line, i) => `${String(lineStart + i).padStart(4, ' ')}|${line}`)
  return numbered.join('\n')
}

function renderArtifactRef(baseDir: string, ref: ArtifactRef): string {
  if (ref.kind === 'file_range') {
    const abs = resolve(baseDir, ref.path)
    try {
      const content = readFileRange(abs, ref.lineStart, ref.lineEnd)
      return `## File: ${ref.path} (L${ref.lineStart}-L${ref.lineEnd})\n\`\`\`\n${content}\n\`\`\``
    } catch {
      return `## File: ${ref.path} (L${ref.lineStart}-L${ref.lineEnd})\n(file not found)`
    }
  }

  return `## Ref: ${ref.kind}\n(skipped)`
}

function tryReadFile(path: string): string | null {
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf8')
    }
  } catch {
    // Ignore
  }
  return null
}

export class ContextBuilder {
  readonly #baseDir: string

  constructor(baseDir: string) {
    this.#baseDir = baseDir
  }

  /**
   * Build system prompt for Tool Use workflow.
   */
  buildSystemPrompt(): string {
    const parts: string[] = []

    parts.push(`You are CoAuthor, an AI writing assistant that helps users with document editing and code tasks.

You have access to tools to read files, edit files, list directories, and run commands.
Use these tools to accomplish the user's task.

## Workflow
1. First, understand the task and confirm with the user if needed
2. Use tools to explore the workspace and gather information
3. Make changes using the editFile tool
4. Verify your changes work correctly

## Guidelines
- Always read files before editing to understand context
- Make focused, atomic changes
- For risky operations (file edits, commands), explain what you're about to do
- If you're unsure about something, ask the user for clarification`)

    // Try to load project-specific context files
    const outlinePath = resolve(this.#baseDir, 'OUTLINE.md')
    const outline = tryReadFile(outlinePath)
    if (outline) {
      parts.push(`\n## Project Outline\n${outline}`)
    }

    const briefPath = resolve(this.#baseDir, 'BRIEF.md')
    const brief = tryReadFile(briefPath)
    if (brief) {
      parts.push(`\n## Project Brief\n${brief}`)
    }

    const stylePath = resolve(this.#baseDir, 'STYLE.md')
    const style = tryReadFile(stylePath)
    if (style) {
      parts.push(`\n## Style Guide\n${style}`)
    }

    return parts.join('\n')
  }

  /**
   * Build initial messages for a task.
   */
  buildTaskMessages(task: TaskView): LLMMessage[] {
    const messages: LLMMessage[] = []

    // System prompt
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt()
    })

    // User task
    const taskParts: string[] = []
    taskParts.push(`# Task: ${task.title}`)
    
    if (task.intent) {
      taskParts.push(`\n${task.intent}`)
    }

    if (task.artifactRefs && task.artifactRefs.length > 0) {
      taskParts.push('\n## Referenced Files')
      for (const ref of task.artifactRefs) {
        taskParts.push(renderArtifactRef(this.#baseDir, ref))
      }
    }

    messages.push({
      role: 'user',
      content: taskParts.join('\n')
    })

    return messages
  }
}

