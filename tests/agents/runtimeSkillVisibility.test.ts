import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../../src/infrastructure/persistence/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infrastructure/persistence/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infrastructure/persistence/jsonlConversationStore.js'
import { TaskService } from '../../src/application/services/taskService.js'
import { RuntimeManager } from '../../src/agents/orchestration/runtimeManager.js'
import { ConversationManager } from '../../src/agents/orchestration/conversationManager.js'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infrastructure/tools/toolExecutor.js'
import { DefaultSkillRegistry } from '../../src/infrastructure/skills/skillRegistry.js'
import { SkillManager } from '../../src/infrastructure/skills/skillManager.js'
import { registerActivateSkillTool } from '../../src/infrastructure/tools/activateSkill.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { DEFAULT_USER_ACTOR_ID } from '../../src/core/entities/actor.js'
import type { Agent, AgentOutput } from '../../src/agents/core/agent.js'
import type { ToolGroup } from '../../src/core/ports/tool.js'
import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'

const mockArtifactStore: ArtifactStore = {
  readFile: async () => '',
  readFileRange: async () => '',
  listDir: async () => [],
  writeFile: async () => {},
  exists: async () => false,
  mkdir: async () => {},
  glob: async () => [],
  stat: async () => null
}

async function createRuntimeHarness(dir: string, skillRegistry: DefaultSkillRegistry, skillManager?: SkillManager) {
  const store = new JsonlEventStore({
    eventsPath: join(dir, 'events.jsonl'),
    projectionsPath: join(dir, 'projections.jsonl')
  })
  await store.ensureSchema()

  const conversationStore = new JsonlConversationStore({
    conversationsPath: join(dir, 'conversations.jsonl')
  })
  await conversationStore.ensureSchema()

  const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
  const toolRegistry = new DefaultToolRegistry()
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const llm = new FakeLLMClient()

  const conversationManager = new ConversationManager({
    conversationStore,
    auditLog,
    toolRegistry,
    toolExecutor,
    artifactStore: mockArtifactStore
  })

  const outputHandler = new OutputHandler({
    toolExecutor,
    toolRegistry,
    artifactStore: mockArtifactStore,
    conversationManager
  })

  const runtimeManager = new RuntimeManager({
    store,
    taskService,
    llm,
    toolRegistry,
    skillRegistry,
    skillManager,
    baseDir: dir,
    conversationManager,
    outputHandler
  })

  return {
    taskService,
    runtimeManager,
    toolRegistry,
    conversationStore,
  }
}

describe('Runtime skill visibility', () => {
  test('applies per-agent skill allowlist rules to AgentContext.skills', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-runtime-skills-'))
    const seenSkillNamesByAgent = new Map<string, string[]>()
    const skillRegistry = new DefaultSkillRegistry()
    skillRegistry.registerOrReplace({
      name: 'alpha',
      description: 'alpha skill',
      location: 'skills/alpha',
      skillFilePath: join(dir, 'skills', 'alpha', 'SKILL.md'),
    })
    skillRegistry.registerOrReplace({
      name: 'beta',
      description: 'beta skill',
      location: 'skills/beta',
      skillFilePath: join(dir, 'skills', 'beta', 'SKILL.md'),
    })

    function makeAgent(id: string, allowlist: readonly string[] | undefined): Agent {
      return {
        id,
        displayName: id,
        description: id,
        toolGroups: [] as readonly ToolGroup[],
        skillAllowlist: allowlist,
        defaultProfile: 'fast',
        async *run(_task, context) {
          seenSkillNamesByAgent.set(id, context.skills.list().map((skill) => skill.name).sort())
          yield { kind: 'done', summary: 'captured' } as AgentOutput
        }
      }
    }

    try {
      const { taskService, runtimeManager } = await createRuntimeHarness(dir, skillRegistry)

      runtimeManager.registerAgent(makeAgent('agent_all_default', undefined))
      runtimeManager.registerAgent(makeAgent('agent_none', []))
      runtimeManager.registerAgent(makeAgent('agent_alpha_only', ['alpha']))
      runtimeManager.registerAgent(makeAgent('agent_all_explicit', ['*']))

      const { taskId: allDefaultTaskId } = await taskService.createTask({
        title: 'all-default',
        agentId: 'agent_all_default'
      })
      const { taskId: noneTaskId } = await taskService.createTask({
        title: 'none',
        agentId: 'agent_none'
      })
      const { taskId: alphaOnlyTaskId } = await taskService.createTask({
        title: 'alpha-only',
        agentId: 'agent_alpha_only'
      })
      const { taskId: allExplicitTaskId } = await taskService.createTask({
        title: 'all-explicit',
        agentId: 'agent_all_explicit'
      })

      await runtimeManager.executeTask(allDefaultTaskId)
      await runtimeManager.executeTask(noneTaskId)
      await runtimeManager.executeTask(alphaOnlyTaskId)
      await runtimeManager.executeTask(allExplicitTaskId)

      expect(seenSkillNamesByAgent.get('agent_all_default')).toEqual(['alpha', 'beta'])
      expect(seenSkillNamesByAgent.get('agent_none')).toEqual([])
      expect(seenSkillNamesByAgent.get('agent_alpha_only')).toEqual(['alpha'])
      expect(seenSkillNamesByAgent.get('agent_all_explicit')).toEqual(['alpha', 'beta'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('blocks activation of invisible skills during runtime execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-runtime-skill-activation-'))
    mkdirSync(join(dir, 'skills', 'alpha'), { recursive: true })
    mkdirSync(join(dir, 'skills', 'beta'), { recursive: true })
    writeFileSync(
      join(dir, 'skills', 'alpha', 'SKILL.md'),
      ['---', 'name: alpha', 'description: alpha skill', '---', '', '# Alpha'].join('\n'),
      'utf8'
    )
    writeFileSync(
      join(dir, 'skills', 'beta', 'SKILL.md'),
      ['---', 'name: beta', 'description: beta skill', '---', '', '# Beta'].join('\n'),
      'utf8'
    )

    const skillRegistry = new DefaultSkillRegistry()
    const skillManager = new SkillManager({ baseDir: dir, registry: skillRegistry })
    await skillManager.discoverWorkspaceSkills()

    const activationAgent: Agent = {
      id: 'agent_activation_probe',
      displayName: 'Activation Probe',
      description: 'Calls activateSkill for an invisible skill.',
      toolGroups: ['meta'] as readonly ToolGroup[],
      skillAllowlist: ['alpha'],
      defaultProfile: 'fast',
      async *run(_task, context) {
        expect(context.skills.list().map((skill) => skill.name)).toEqual(['alpha'])
        yield {
          kind: 'tool_call',
          call: {
            toolCallId: 'tc-activate',
            toolName: 'activateSkill',
            arguments: { name: 'beta' }
          }
        } as AgentOutput
        yield { kind: 'done', summary: 'done' } as AgentOutput
      }
    }

    try {
      const { taskService, runtimeManager, toolRegistry, conversationStore } = await createRuntimeHarness(
        dir,
        skillRegistry,
        skillManager
      )
      registerActivateSkillTool(toolRegistry, { skillManager })
      runtimeManager.registerAgent(activationAgent)

      const { taskId } = await taskService.createTask({
        title: 'activation-visibility-check',
        agentId: activationAgent.id
      })

      await runtimeManager.executeTask(taskId)

      const messages = await conversationStore.getMessages(taskId)
      const toolMessage = messages.find((message) => message.role === 'tool' && message.toolCallId === 'tc-activate')
      expect(toolMessage?.toolName).toBe('activateSkill')
      const parsed = JSON.parse(String(toolMessage?.content ?? '{}'))
      expect(parsed).toMatchObject({
        error: 'Unknown or unavailable skill: beta',
        availableSkills: ['alpha'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
