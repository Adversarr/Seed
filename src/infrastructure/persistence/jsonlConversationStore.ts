/**
 * Infrastructure Layer - JSONL Conversation Store (Async)
 *
 * Stores LLM conversation history per task in an append-only JSONL file.
 * Enables state recovery across UIP pauses, app restarts, and crashes.
 *
 * Design: async I/O, write-through cache, AsyncMutex for write serialisation.
 */

import { appendFile, readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import type { LLMMessage } from '../../core/ports/llmClient.js'
import type {
  ConversationStore,
  StoredConversationEntry
} from '../../core/ports/conversationStore.js'
import { ConversationEntrySchema } from '../../core/ports/conversationStore.js'
import { AsyncMutex } from '../asyncMutex.js'

// ============================================================================
// Internal Types
// ============================================================================

type JsonlConversationRow = {
  id: number
  taskId: string
  index: number
  message: unknown
  createdAt: string
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Implementation
// ============================================================================

export class JsonlConversationStore implements ConversationStore {
  readonly #conversationsPath: string
  readonly #mutex = new AsyncMutex()

  // Write-through cache
  #rowsCache: JsonlConversationRow[] = []
  #maxId = 0
  #taskIndices = new Map<string, number>() // taskId → current max index
  #cacheLoaded = false

  constructor(opts: { conversationsPath: string }) {
    this.#conversationsPath = opts.conversationsPath
  }

  // ======================== Schema ========================

  async ensureSchema(): Promise<void> {
    await mkdir(dirname(this.#conversationsPath), { recursive: true })
    if (!(await fileExists(this.#conversationsPath))) {
      await writeFile(this.#conversationsPath, '')
    }
  }

  // ======================== Append ========================

  async append(taskId: string, message: LLMMessage): Promise<StoredConversationEntry> {
    await this.#ensureCacheLoaded()

    return await this.#mutex.runExclusive(async () => {
      const now = new Date().toISOString()
      this.#maxId += 1

      const currentIndex = this.#taskIndices.get(taskId) ?? -1
      const nextIndex = currentIndex + 1
      this.#taskIndices.set(taskId, nextIndex)

      const row: JsonlConversationRow = {
        id: this.#maxId,
        taskId,
        index: nextIndex,
        message,
        createdAt: now
      }

      try {
        await appendFile(this.#conversationsPath, `${JSON.stringify(row)}\n`)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      this.#rowsCache.push(row)

      return {
        id: row.id,
        taskId,
        index: nextIndex,
        message,
        createdAt: now
      }
    })
  }

  // ======================== Reads ========================

  async getMessages(taskId: string): Promise<LLMMessage[]> {
    await this.#ensureCacheLoaded()
    return this.#rowsCache
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => a.index - b.index)
      .map((r) => this.#parseMessage(r.message))
      .filter((message): message is LLMMessage => message !== null)
  }

  async readAll(fromIdExclusive = 0): Promise<StoredConversationEntry[]> {
    await this.#ensureCacheLoaded()
    return this.#rowsCache
      .filter((r) => r.id > fromIdExclusive)
      .map((r) => this.#rowToStoredEntry(r))
      .filter((entry): entry is StoredConversationEntry => entry !== null)
  }

  // ======================== Mutators ========================

  async truncate(taskId: string, keepLastN: number): Promise<void> {
    await this.#ensureCacheLoaded()

    await this.#mutex.runExclusive(async () => {
      const taskRows = this.#rowsCache
        .filter((r) => r.taskId === taskId)
        .sort((a, b) => a.index - b.index)

      if (taskRows.length <= keepLastN) return

      const rowsToRemove = new Set(
        taskRows.slice(0, taskRows.length - keepLastN).map((r) => r.id)
      )

      this.#rowsCache = this.#rowsCache.filter((r) => !rowsToRemove.has(r.id))
      await this.#rewriteFile(this.#rowsCache)
      this.#rebuildMetaFromRows(this.#rowsCache)
    })
  }

  async clear(taskId: string): Promise<void> {
    await this.#ensureCacheLoaded()

    await this.#mutex.runExclusive(async () => {
      this.#rowsCache = this.#rowsCache.filter((r) => r.taskId !== taskId)
      await this.#rewriteFile(this.#rowsCache)
      this.#taskIndices.delete(taskId)
      this.#rebuildMetaFromRows(this.#rowsCache)
    })
  }

  // ======================== Cache ========================

  async #ensureCacheLoaded(): Promise<void> {
    if (this.#cacheLoaded) return
    this.#rowsCache = await this.#readRowsFromDisk()
    this.#rebuildMetaFromRows(this.#rowsCache)
    this.#cacheLoaded = true
  }

  #rebuildMetaFromRows(rows: JsonlConversationRow[]): void {
    this.#maxId = rows.length > 0 ? Math.max(...rows.map((r) => r.id)) : 0
    this.#taskIndices.clear()
    for (const row of rows) {
      const currentMax = this.#taskIndices.get(row.taskId) ?? -1
      if (row.index > currentMax) {
        this.#taskIndices.set(row.taskId, row.index)
      }
    }
    this.#cacheLoaded = true
  }

  // ======================== Disk I/O ========================

  async #readRowsFromDisk(): Promise<JsonlConversationRow[]> {
    if (!(await fileExists(this.#conversationsPath))) return []
    const raw = await readFile(this.#conversationsPath, 'utf8')
    const rows: JsonlConversationRow[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        rows.push(JSON.parse(trimmed) as JsonlConversationRow)
      } catch {
        continue
      }
    }
    return rows
  }

  async #rewriteFile(rows: JsonlConversationRow[]): Promise<void> {
    const content = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '')
    try {
      await writeFile(this.#conversationsPath, content)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  // ======================== Helpers ========================

  #parseMessage(raw: unknown): LLMMessage | null {
    const parsed = ConversationEntrySchema.pick({ message: true }).safeParse({ message: raw })
    if (!parsed.success) return null
    return parsed.data.message as LLMMessage
  }

  #rowToStoredEntry(row: JsonlConversationRow): StoredConversationEntry | null {
    const message = this.#parseMessage(row.message)
    if (!message) return null
    return {
      id: row.id,
      taskId: row.taskId,
      index: row.index,
      message,
      createdAt: row.createdAt
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createConversationStore(
  conversationsPath: string
): Promise<ConversationStore> {
  const store = new JsonlConversationStore({ conversationsPath })
  await store.ensureSchema()
  return store
}
