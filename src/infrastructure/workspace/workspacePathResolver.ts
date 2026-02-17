import { resolve as resolveFsPath, posix as posixPath } from 'node:path'
import type { TaskService, TaskView } from '../../application/services/taskService.js'
import type {
  WorkspacePathResolver as WorkspacePathResolverPort,
  WorkspacePathResolution,
  WorkspacePatternResolution,
  WorkspaceScope
} from '../../core/ports/tool.js'

const PRIVATE_SCOPE_ROOT = 'private'
const SHARED_SCOPE_ROOT = 'shared'
const PUBLIC_SCOPE_ROOT = 'public'

type ParsedScopedValue = {
  scope: WorkspaceScope
  pathInScope: string
}

/**
 * Default resolver implementing scoped workspace path rules.
 *
 * Key guarantees:
 * - Unscoped paths default to private scope.
 * - public:/ resolves under WORKDIR/public.
 * - shared:/ is only available to group members:
 *   - any descendant task
 *   - root task only after it has at least one child task
 */
export class DefaultWorkspacePathResolver implements WorkspacePathResolverPort {
  readonly #baseDir: string
  readonly #taskService: TaskService

  constructor(opts: { baseDir: string; taskService: TaskService }) {
    this.#baseDir = opts.baseDir
    this.#taskService = opts.taskService
  }

  async resolvePath(
    taskId: string,
    rawPath: string,
    options: { defaultScope?: WorkspaceScope } = {}
  ): Promise<WorkspacePathResolution> {
    const parsed = this.#parseScopedValue(rawPath, options.defaultScope ?? 'private', false)
    const scopeRootStorePath = await this.#resolveScopeRoot(taskId, parsed.scope)

    const storePath = joinStorePath(scopeRootStorePath, parsed.pathInScope)

    return {
      scope: parsed.scope,
      pathInScope: parsed.pathInScope,
      logicalPath: this.toLogicalPath(parsed.scope, parsed.pathInScope),
      scopeRootStorePath,
      storePath,
      absolutePath: resolveFsPath(this.#baseDir, storePath)
    }
  }

  async resolvePattern(
    taskId: string,
    rawPattern: string,
    options: { defaultScope?: WorkspaceScope } = {}
  ): Promise<WorkspacePatternResolution> {
    const parsed = this.#parseScopedValue(rawPattern, options.defaultScope ?? 'private', true)
    const scopeRootStorePath = await this.#resolveScopeRoot(taskId, parsed.scope)
    const patternInScope = parsed.pathInScope === '' ? '**/*' : parsed.pathInScope

    return {
      scope: parsed.scope,
      patternInScope,
      logicalPattern: this.toLogicalPath(parsed.scope, patternInScope),
      scopeRootStorePath,
      storePattern: joinStorePath(scopeRootStorePath, patternInScope),
      scopeRootAbsolutePath: resolveFsPath(this.#baseDir, scopeRootStorePath === '' ? '.' : scopeRootStorePath)
    }
  }

  toLogicalPath(scope: WorkspaceScope, pathInScope: string): string {
    return pathInScope === '' ? `${scope}:/` : `${scope}:/${pathInScope}`
  }

  #parseScopedValue(
    rawValue: string,
    defaultScope: WorkspaceScope,
    isPattern: boolean
  ): ParsedScopedValue {
    const trimmed = rawValue.trim()
    if (trimmed === '') {
      throw new Error('Path must be non-empty')
    }

    const explicitMatch = /^(private|shared|public):\/(.*)$/u.exec(trimmed)
    const scope = (explicitMatch?.[1] as WorkspaceScope | undefined) ?? defaultScope
    const valueWithoutPrefix = explicitMatch?.[2] ?? trimmed

    if (valueWithoutPrefix.includes('\0')) {
      throw new Error('Path must not contain null bytes')
    }

    // `/foo` should be interpreted as scope-relative, not filesystem-absolute.
    const withoutLeadingSlash = valueWithoutPrefix.replace(/^\/+/u, '')

    return {
      scope,
      pathInScope: isPattern
        ? normalizePatternInScope(withoutLeadingSlash)
        : normalizePathInScope(withoutLeadingSlash)
    }
  }

  async #resolveScopeRoot(taskId: string, scope: WorkspaceScope): Promise<string> {
    if (scope === 'public') {
      return PUBLIC_SCOPE_ROOT
    }

    if (scope === 'private') {
      return joinStorePath(PRIVATE_SCOPE_ROOT, taskId)
    }

    const group = await this.#resolveGroupContext(taskId)
    if (!group.sharedAllowed) {
      throw new Error('shared:/ is not available for this task (task is not in an agent group)')
    }
    return joinStorePath(SHARED_SCOPE_ROOT, group.rootTaskId)
  }

  async #resolveGroupContext(taskId: string): Promise<{ rootTaskId: string; sharedAllowed: boolean }> {
    const currentTask = await this.#requireTask(taskId)

    // Root task: shared access is only unlocked after at least one child exists.
    if (!currentTask.parentTaskId) {
      return {
        rootTaskId: currentTask.taskId,
        sharedAllowed: (currentTask.childTaskIds?.length ?? 0) > 0
      }
    }

    // Descendants are always in a group by definition.
    let root = currentTask
    const visited = new Set<string>([currentTask.taskId])
    while (root.parentTaskId) {
      const next = await this.#requireTask(root.parentTaskId)
      if (visited.has(next.taskId)) {
        throw new Error(`Task hierarchy cycle detected while resolving group for ${taskId}`)
      }
      visited.add(next.taskId)
      root = next
    }

    return {
      rootTaskId: root.taskId,
      sharedAllowed: true
    }
  }

  async #requireTask(taskId: string): Promise<TaskView> {
    const task = await this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found for workspace resolution: ${taskId}`)
    }
    return task
  }

}

function normalizePathInScope(pathInScope: string): string {
  if (pathInScope === '' || pathInScope === '.') return ''

  const normalized = posixPath.normalize(pathInScope.replace(/\\/gu, '/'))
  if (normalized === '.') return ''

  assertNoTraversal(normalized)
  return normalized
}

function normalizePatternInScope(patternInScope: string): string {
  if (patternInScope === '' || patternInScope === '.') return ''

  const normalized = patternInScope.replace(/\\/gu, '/').replace(/\/+/gu, '/')
  assertNoTraversal(normalized)
  return normalized
}

function assertNoTraversal(value: string): void {
  const segments = value.split('/')
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(`Path must not escape scope root: ${value}`)
    }
  }
}

function joinStorePath(root: string, suffix: string): string {
  if (root === '') {
    return suffix === '' ? '.' : suffix
  }
  if (suffix === '') {
    return root
  }
  return posixPath.join(root, suffix)
}
