import { resolve as resolveFsPath, relative as relativeFsPath, posix as posixPath } from 'node:path'
import type {
  ToolContext,
  WorkspacePathResolution,
  WorkspacePatternResolution,
  WorkspaceScope
} from '../../core/ports/tool.js'

/**
 * Resolve a tool file/directory path using scoped workspace semantics when available.
 * Falls back to legacy workspace-root relative behavior when resolver is missing.
 */
export async function resolveToolPath(
  ctx: ToolContext,
  rawPath: string,
  options: { defaultScope?: WorkspaceScope } = {}
): Promise<WorkspacePathResolution> {
  if (ctx.workspaceResolver) {
    return ctx.workspaceResolver.resolvePath(ctx.taskId, rawPath, options)
  }

  const { normalizedPath, rawLogicalPath } = normalizeLegacyScopedInput(rawPath, '.')
  const normalized = normalizedPath === '' ? '.' : normalizedPath
  return {
    scope: 'public',
    pathInScope: normalizeLegacyPath(normalizedPath),
    logicalPath: rawLogicalPath,
    scopeRootStorePath: '',
    storePath: normalized,
    absolutePath: resolveFsPath(ctx.baseDir, normalized)
  }
}

/**
 * Resolve a tool glob/search pattern using scoped workspace semantics when available.
 * Falls back to legacy workspace-root relative behavior when resolver is missing.
 */
export async function resolveToolPattern(
  ctx: ToolContext,
  rawPattern: string,
  options: { defaultScope?: WorkspaceScope } = {}
): Promise<WorkspacePatternResolution> {
  if (ctx.workspaceResolver) {
    return ctx.workspaceResolver.resolvePattern(ctx.taskId, rawPattern, options)
  }

  const { normalizedPath, rawLogicalPath } = normalizeLegacyScopedInput(rawPattern, '**/*')
  const normalized = normalizedPath === '' ? '**/*' : normalizedPath
  return {
    scope: 'public',
    patternInScope: normalizeLegacyPath(normalizedPath),
    logicalPattern: rawLogicalPath,
    scopeRootStorePath: '',
    storePattern: normalized,
    scopeRootAbsolutePath: resolveFsPath(ctx.baseDir)
  }
}

/**
 * Convert a workspace-root-relative path returned by ArtifactStore/glob/grep
 * back into a scope-prefixed logical path for user-facing output.
 */
export function mapStorePathToLogicalPath(
  resolution: Pick<WorkspacePathResolution, 'scope' | 'scopeRootStorePath'>,
  storePath: string
): string {
  const storePathPosix = normalizeStorePath(storePath)
  const rootPosix = normalizeStorePath(resolution.scopeRootStorePath)

  if (rootPosix === '' || rootPosix === '.') {
    const normalized = stripLeadingDot(storePathPosix)
    return `${resolution.scope}:/${normalized}`
  }

  const inScope = stripLeadingDot(normalizeStorePath(posixPath.relative(rootPosix, storePathPosix)))
  return `${resolution.scope}:/${inScope}`
}

/**
 * Convert an absolute path back to a scope-prefixed logical path.
 */
export function mapAbsolutePathToLogicalPath(
  resolution: Pick<WorkspacePathResolution, 'scope' | 'scopeRootStorePath'>,
  baseDir: string,
  absolutePath: string
): string {
  const storePath = normalizeStorePath(relativeFsPath(baseDir, absolutePath))
  return mapStorePathToLogicalPath(resolution, storePath)
}

function normalizeLegacyPath(path: string): string {
  if (path === '') return ''
  return stripLeadingDot(normalizeStorePath(path))
}

function normalizeStorePath(path: string): string {
  return path.replace(/\\/gu, '/')
}

function stripLeadingDot(path: string): string {
  if (path === '.' || path === '') return ''
  return path.replace(/^\.\/+/u, '')
}

function normalizeLegacyScopedInput(
  rawValue: string,
  defaultValue: string
): { normalizedPath: string; rawLogicalPath: string } {
  const trimmed = rawValue.trim()
  if (trimmed === '') {
    return { normalizedPath: defaultValue, rawLogicalPath: rawValue }
  }

  const scopedMatch = /^(private|shared|public):\/(.*)$/u.exec(trimmed)
  if (!scopedMatch) {
    return { normalizedPath: trimmed, rawLogicalPath: rawValue }
  }

  const pathWithoutPrefix = scopedMatch[2] ?? ''
  const normalizedPath = pathWithoutPrefix.replace(/^\/+/u, '')
  return {
    normalizedPath: normalizedPath === '' ? defaultValue : normalizedPath,
    rawLogicalPath: rawValue
  }
}
