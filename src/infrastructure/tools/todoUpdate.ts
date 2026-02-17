import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolRegistry } from '../../core/ports/tool.js'
import type { TaskService, TaskTodoItemInput } from '../../application/services/taskService.js'

export type TodoUpdateToolDeps = {
  taskService: TaskService
}

export function createTodoUpdateTool(deps: TodoUpdateToolDeps): Tool {
  return {
    name: 'todoUpdate',
    description: 'Replace the current task todo list with the provided full list and return the next pending todo item. If all items are complete, returns "All todo complete".',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Full todo list for the current task. This call replaces previous todos.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional todo ID. If omitted, ID is derived from title and index.' },
              title: { type: 'string', description: 'Todo title (required, non-empty after trim).' },
              description: { type: 'string', description: 'Optional todo description.' },
              status: { type: 'string', enum: ['pending', 'completed'], description: 'Todo status. Defaults to pending.' }
            },
            required: ['title']
          }
        }
      },
      required: ['todos']
    },
    riskLevel: 'safe',
    group: 'edit',

    async execute(args: Record<string, unknown>, ctx: ToolContext) {
      const toolCallId = `tool_${nanoid(12)}`
      try {
        const todos = ((args.todos as TaskTodoItemInput[] | undefined) ?? [])
        const result = await deps.taskService.updateTodoList(ctx.taskId, todos)
        return {
          toolCallId,
          output: result,
          isError: false
        }
      } catch (error) {
        return {
          toolCallId,
          output: { error: error instanceof Error ? error.message : String(error) },
          isError: true
        }
      }
    }
  }
}

export function registerTodoUpdateTool(toolRegistry: ToolRegistry, deps: TodoUpdateToolDeps): void {
  toolRegistry.register(createTodoUpdateTool(deps))
}
