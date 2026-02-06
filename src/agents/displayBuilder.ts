import { nanoid } from 'nanoid'
import { createPatch } from 'diff'
import type { InteractionDisplay } from '../domain/events.js'
import type { ToolCallRequest } from '../domain/ports/tool.js'
import type { AgentInteractionRequest } from './agent.js'

// ============================================================================
// Display Builder - Pure functions for building UIP interaction displays
// ============================================================================

/**
 * Build a display object for a risky tool confirmation request.
 *
 * Produces tool-specific previews:
 * - `editFile` → unified diff
 * - `runCommand` → command summary
 * - fallback → JSON args preview
 */
export function buildRiskyToolDisplay(toolCall: ToolCallRequest): InteractionDisplay {
  const baseDisplay = {
    title: 'Confirm Risky Operation',
    description: `The agent wants to execute a potentially risky operation using ${toolCall.toolName}.`
  }

  if (toolCall.toolName === 'editFile') {
    const args = toolCall.arguments as Record<string, string>
    const path = args.path
    const oldString = args.oldString || ''
    const newString = args.newString || ''

    const diff = createPatch(path, oldString, newString)

    return {
      ...baseDisplay,
      description: `Agent requests to edit file: ${path}`,
      contentKind: 'Diff',
      content: diff
    }
  }

  if (toolCall.toolName === 'runCommand') {
    const args = toolCall.arguments as Record<string, any>
    const command = args.command
    const cwd = args.cwd || '(workspace root)'
    const timeout = args.timeout || 30000

    const content = [
      `Command: ${command}`,
      `CWD: ${cwd}`,
      `Timeout: ${timeout}ms`
    ].join('\n')

    return {
      ...baseDisplay,
      contentKind: 'PlainText',
      content
    }
  }

  // Default fallback
  const argsPreview = JSON.stringify(toolCall.arguments, null, 2)
  return {
    ...baseDisplay,
    contentKind: 'Json',
    content: argsPreview
  }
}

/**
 * Build a standard UIP confirmation request for a risky tool call.
 *
 * Used by agents to request user approval before executing risky tools.
 * Returns a complete AgentInteractionRequest with a unique ID.
 */
export function buildConfirmInteraction(toolCall: ToolCallRequest): AgentInteractionRequest {
  return {
    interactionId: `ui_${nanoid(12)}`,
    kind: 'Confirm',
    purpose: 'confirm_risky_action',
    display: buildRiskyToolDisplay(toolCall),
    options: [
      { id: 'approve', label: 'Approve', style: 'danger' },
      { id: 'reject', label: 'Reject', style: 'default', isDefault: true }
    ]
  }
}
