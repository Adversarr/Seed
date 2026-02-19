import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolRegistry, ToolResult } from '../../core/ports/tool.js'
import type { SkillSessionManager } from '../../core/ports/skill.js'
import { sanitizeSkillName } from '../../core/entities/skill.js'

export type ActivateSkillToolDeps = {
  skillManager: SkillSessionManager
}

export function createActivateSkillTool(deps: ActivateSkillToolDeps): Tool {
  return {
    name: 'activateSkill',
    description:
      'Activate a discovered skill by name. On first activation per task, user confirmation is required. Returns skill instructions and mounted resource location.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name from the available skill catalog in the system prompt.',
        },
      },
      required: ['name'],
    },
    riskLevel: (args: Record<string, unknown>, ctx: ToolContext) => {
      const rawName = typeof args.name === 'string' ? args.name : ''
      const normalizedName = sanitizeSkillName(rawName)
      if (!normalizedName) return 'safe'

      const visibleSkill = deps.skillManager.getVisibleSkill(ctx.taskId, normalizedName)
      if (!visibleSkill) return 'safe'

      return deps.skillManager.isActivationConsentRequired(ctx.taskId, normalizedName)
        ? 'risky'
        : 'safe'
    },
    group: 'meta',

    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`
      const rawName = typeof args.name === 'string' ? args.name : ''
      const normalizedName = sanitizeSkillName(rawName)

      if (!normalizedName) {
        return {
          toolCallId,
          output: { error: 'Skill name is required' },
          isError: true,
        }
      }

      const visibleSkills = deps.skillManager.listVisibleSkills(ctx.taskId)
      const visibleSkillNames = visibleSkills.map((skill) => skill.name).sort()
      const visibleSkill = deps.skillManager.getVisibleSkill(ctx.taskId, normalizedName)

      if (!visibleSkill) {
        return {
          toolCallId,
          output: {
            error: `Unknown or unavailable skill: ${normalizedName}`,
            availableSkills: visibleSkillNames,
          },
          isError: true,
        }
      }

      try {
        const activation = await deps.skillManager.activateSkill(ctx.taskId, visibleSkill.name)
        return {
          toolCallId,
          output: {
            success: true,
            skill: {
              name: activation.name,
              description: activation.description,
              location: activation.location,
            },
            alreadyActivated: activation.alreadyActivated,
            mountPath: activation.mountPath,
            folderStructure: activation.folderStructure,
            instructions: activation.body,
          },
          isError: false,
        }
      } catch (error) {
        return {
          toolCallId,
          output: {
            error: error instanceof Error ? error.message : String(error),
            availableSkills: visibleSkillNames,
          },
          isError: true,
        }
      }
    },
  }
}

export function registerActivateSkillTool(
  toolRegistry: ToolRegistry,
  deps: ActivateSkillToolDeps
): void {
  toolRegistry.register(createActivateSkillTool(deps))
}
