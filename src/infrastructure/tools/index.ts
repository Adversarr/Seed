/**
 * Built-in Tools Index
 *
 * Re-exports all built-in tools and provides a registration function.
 */

import type { ToolRegistry } from '../../core/ports/tool.js'
import type { LLMClient, LLMProfile } from '../../core/ports/llmClient.js'
import { readFileTool } from './readFile.js'
import { editFileTool } from './editFile.js'
import { listFilesTool } from './listFiles.js'
import { runCommandTool, createRunCommandTool } from './runCommand.js'
import { globTool } from './globTool.js'
import { grepTool } from './grepTool.js'
import { createWebSearchTool } from './webSearch.js'
import { createWebFetchTool } from './webFetch.js'
import { hasProfile } from './webSubagentClient.js'

export { readFileTool } from './readFile.js'
export { editFileTool } from './editFile.js'
export { listFilesTool } from './listFiles.js'
export { runCommandTool, createRunCommandTool } from './runCommand.js'
export { globTool } from './globTool.js'
export { grepTool } from './grepTool.js'
export { createWebSearchTool } from './webSearch.js'
export { createWebFetchTool } from './webFetch.js'
export { createActivateSkillTool, registerActivateSkillTool } from './activateSkill.js'
export {
  createTodoUpdateTool,
  registerTodoUpdateTool
} from './todoUpdate.js'
export {
  createSubtasksTool,
  listSubtaskTool,
  registerAgentGroupTools
} from './agentGroupTools.js'
export type { AgentGroupToolDeps } from './agentGroupTools.js'
export type { ActivateSkillToolDeps } from './activateSkill.js'

/**
 * Register all built-in tools in the given registry.
 */
export function registerBuiltinTools(registry: ToolRegistry, config?: {
  runCommand?: { maxOutputLength?: number; defaultTimeout?: number }
  web?: {
    llm: LLMClient
    profile?: LLMProfile
    onSkip?: (message: string) => void
  }
}): void {
  registry.register(readFileTool)
  registry.register(editFileTool)
  registry.register(listFilesTool)
  registry.register(createRunCommandTool(config?.runCommand))
  registry.register(globTool)
  registry.register(grepTool)

  if (config?.web) {
    const provider = config.web.llm.provider
    if (provider !== 'bailian' && provider !== 'volcengine') {
      // Generic OpenAI-compatible and fake providers do not expose web tools.
      return
    }

    const webProfile = config.web.profile ?? 'research_web'
    if (!hasProfile(config.web.llm, webProfile)) {
      const warn = config.web.onSkip ?? ((message: string) => console.warn(message))
      warn(
        `[tools] web tools disabled: profile "${webProfile}" is missing. ` +
        `Add it to SEED_LLM_PROFILES_JSON or WORKDIR/profiles.json to enable web_search/web_fetch.`,
      )
    } else if (provider === 'bailian') {
      registry.register(createWebSearchTool({ llm: config.web.llm, profile: webProfile }))
      registry.register(createWebFetchTool({ llm: config.web.llm, profile: webProfile }))
    } else if (provider === 'volcengine') {
      registry.register(createWebSearchTool({ llm: config.web.llm, profile: webProfile }))
    }
  }

  // Task-aware tool registration happens in createApp (requires TaskService deps).
  // registerTodoUpdateTool is intentionally excluded from generic built-ins.
}
