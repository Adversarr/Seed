import type { App } from '../app/createApp.js'

export type CommandContext = {
  app: App
  refresh: () => Promise<void>
  setStatus: (status: string) => void
  setReplayOutput: (output: string[]) => void
  focusedTaskId: string | null
  setFocusedTaskId: (id: string | null) => void
  setShowTasks: (show: boolean) => void
  setShowVerbose: (show: boolean | ((previous: boolean) => boolean)) => void
}

export async function handleCommand(line: string, ctx: CommandContext) {
  const trimmed = line.trim()
  if (!trimmed) return

  if (!trimmed.startsWith('/')) {
    ctx.setStatus('Command must start with /, type /help for available commands')
    return
  }

  const parts = trimmed.slice(1).split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1)
  const argString = args.join(' ')

  try {
    switch (command) {
      case 'new':
      case 'n': {
        const title = argString
        if (!title) {
          ctx.setStatus('Usage: /new <title>')
          return
        }
        const task = await ctx.app.taskService.createTask({ title, agentId: ctx.app.agent.id })
        ctx.setFocusedTaskId(task.taskId)
        await ctx.refresh()
        ctx.setStatus(`Task created and focused: ${task.taskId}`)
        return
      }

      case 'tasks':
      case 'ls':
      case 'list': {
        await ctx.refresh()
        ctx.setShowTasks(true)
        ctx.setStatus('Task list updated')
        return
      }

      case 'cancel':
      case 'c': {
        const targetId = args[0] || ctx.focusedTaskId
        if (!targetId) {
          ctx.setStatus('No focused task. Usage: /cancel [taskId]')
          return
        }
        // If args[0] was provided, reasoning is the rest, else it's all args? 
        // Design: /cancel [taskId]
        // Let's assume reason is optional 2nd arg or not supported in simplified version yet.
        // The original code supported reason.
        // Let's support: /cancel <taskId> [reason] OR /cancel (uses focused)
        
        let taskId = targetId
        let reason: string | undefined = undefined

        if (args.length > 0) {
           // check if args[0] looks like an ID or reason? 
           // For simplicity, if args[0] is provided, it's the ID.
           taskId = args[0]
           reason = args.slice(1).join(' ') || undefined
        } else {
           // No args, use focused
           taskId = ctx.focusedTaskId!
        }

        await ctx.app.taskService.cancelTask(taskId, reason)
        await ctx.refresh()
        ctx.setStatus(`Task cancelled: ${taskId}`)
        return
      }

      case 'replay':
      case 'r':
      case 'log': { // keep 'log' for backward compat or just redirect
        const targetId = args[0] || ctx.focusedTaskId
        // Original: log replay [streamId]
        // New: /replay [taskId]
        const events = ctx.app.eventService.replayEvents(targetId || undefined)
        ctx.setReplayOutput(events.map((e) => `${e.id} ${e.streamId}#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`))
        ctx.setStatus(`Replayed ${events.length} events`)
        return
      }

      case 'help':
      case 'h':
      case '?': {
        ctx.setStatus('Commands: /new <title>, /tasks, /cancel [id], /replay [id], /verbose [on|off], /exit')
        return
      }

      case 'verbose': {
        const arg = (args[0] ?? '').toLowerCase()
        const shouldEnable = arg === 'on' || arg === '1' || arg === 'true'
        const shouldDisable = arg === 'off' || arg === '0' || arg === 'false'

        if (!arg) {
          ctx.setShowVerbose((previous: boolean) => !previous)
          ctx.setStatus('Verbose output toggled')
          return
        }

        if (shouldEnable) {
          ctx.setShowVerbose(true)
          ctx.setStatus('Verbose output enabled')
          return
        }

        if (shouldDisable) {
          ctx.setShowVerbose(false)
          ctx.setStatus('Verbose output disabled')
          return
        }

        ctx.setStatus('Usage: /verbose [on|off]')
        return
      }

      case 'exit':
      case 'q':
      case 'quit': {
        process.exit(0)
      }

      default: {
        ctx.setStatus(`Unknown command: /${command}`)
      }
    }
  } catch (e) {
    ctx.setStatus(e instanceof Error ? e.message : String(e))
  }
}
