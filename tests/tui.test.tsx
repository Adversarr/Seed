import React from 'react'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { render } from 'ink-testing-library'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { JsonlAuditLog } from '../src/infra/jsonlAuditLog.js'
import { DefaultToolRegistry } from '../src/infra/toolRegistry.js'
import { DefaultToolExecutor } from '../src/infra/toolExecutor.js'
import { FakeLLMClient } from '../src/infra/fakeLLMClient.js'
import { MainTui } from '../src/tui/main.js'
import { TaskService, EventService, InteractionService } from '../src/application/index.js'
import { ContextBuilder } from '../src/application/contextBuilder.js'
import { DefaultCoAuthorAgent } from '../src/agents/defaultAgent.js'
import { AgentRuntime } from '../src/agents/runtime.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

describe('TUI', () => {
  test('renders tasks list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const eventsPath = join(dir, 'events.jsonl')
    const auditLogPath = join(dir, 'audit.jsonl')
    
    const store = new JsonlEventStore({ eventsPath })
    store.ensureSchema()
    store.append('t1', [{ 
      type: 'TaskCreated', 
      payload: { 
        taskId: 't1', 
        title: 'hello',
        intent: '',
        priority: 'foreground' as const,
        agentId: DEFAULT_AGENT_ACTOR_ID,
        authorActorId: DEFAULT_USER_ACTOR_ID 
      } 
    }])
    
    const baseDir = dir
    const auditLog = new JsonlAuditLog({ auditLogPath })
    const toolRegistry = new DefaultToolRegistry()
    const toolExecutor = new DefaultToolExecutor(toolRegistry, auditLog)
    const llm = new FakeLLMClient()
    
    const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    const eventService = new EventService(store)
    const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)
    const contextBuilder = new ContextBuilder(taskService, toolRegistry)
    
    const agent = new DefaultCoAuthorAgent({ contextBuilder })
    const agentRuntime = new AgentRuntime(
      store,
      taskService,
      interactionService,
      toolRegistry,
      toolExecutor,
      auditLog,
      llm
    )
    
    const app = { 
      baseDir, 
      storePath: eventsPath,
      auditLogPath,
      store,
      auditLog,
      toolRegistry,
      toolExecutor,
      llm,
      taskService,
      eventService,
      interactionService,
      contextBuilder,
      agent,
      agentRuntime
    }

    const { lastFrame } = render(<MainTui app={app} />)

    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toMatch(/Tasks/)
    expect(lastFrame()).toMatch(/hello/)

    rmSync(dir, { recursive: true, force: true })
  })
})
