import { readFile, writeFile, readdir, mkdir, access, stat, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, sep, relative } from 'node:path'
import { glob } from 'glob'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'

const PROTECTED_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  '.seed/events.jsonl',
  '.seed/audit.jsonl',
  '.seed/conversations.jsonl',
  '.seed/server.lock'
])

const PROTECTED_DIR_PREFIXES = ['.git', '.agents', '.codex']

export class FsArtifactStore implements ArtifactStore {
  readonly #baseDir: string
  #realBaseDir: string | undefined

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir)
  }

  /** Resolve real base dir lazily (B29). */
  async #getRealBaseDir(): Promise<string> {
    if (!this.#realBaseDir) {
      this.#realBaseDir = await realpath(this.#baseDir)
    }
    return this.#realBaseDir
  }

  private _resolve(path: string): string {
    const resolved = resolve(this.#baseDir, path)
    if (resolved !== this.#baseDir && !resolved.startsWith(this.#baseDir + sep)) {
      throw new Error(`Access denied: Path '${path}' resolves outside base directory`)
    }
    return resolved
  }

  private _assertMutablePathAllowed(originalPath: string, resolvedPath: string): void {
    const relativePath = relative(this.#baseDir, resolvedPath).replaceAll(sep, '/')
    if (relativePath === '' || relativePath === '.') {
      throw new Error(`Access denied: Path '${originalPath}' targets protected internal path`)
    }

    if (PROTECTED_FILES.has(relativePath)) {
      throw new Error(`Access denied: Path '${originalPath}' targets protected internal path`)
    }

    for (const prefix of PROTECTED_DIR_PREFIXES) {
      if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) {
        throw new Error(`Access denied: Path '${originalPath}' targets protected internal path`)
      }
    }

    if (relativePath === '.seed' || relativePath.startsWith('.seed/')) {
      // Keep task workspaces writable; block all other internal .seed paths.
      if (relativePath !== '.seed/workspaces' && !relativePath.startsWith('.seed/workspaces/')) {
        throw new Error(`Access denied: Path '${originalPath}' targets protected internal path`)
      }
    }
  }

  /** Additional symlink-aware check after resolving real path (B29). */
  private async _resolveAndVerify(path: string): Promise<string> {
    const resolved = this._resolve(path)
    try {
      const realBase = await this.#getRealBaseDir()
      const realResolved = await realpath(resolved)
      if (realResolved !== realBase && !realResolved.startsWith(realBase + sep)) {
        throw new Error(`Access denied: Path '${path}' follows symlink outside base directory`)
      }
    } catch (e) {
      // Re-throw access denied
      if (e instanceof Error && e.message.startsWith('Access denied')) throw e
      // ENOENT is expected for new files; the string check above is sufficient
    }
    return resolved
  }

  async readFile(path: string): Promise<string> {
    return readFile(await this._resolveAndVerify(path), 'utf8')
  }

  async readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string> {
    const content = await this.readFile(path)
    const lines = content.split('\n')
    // lineStart and lineEnd are 1-based inclusive
    const startIdx = Math.max(0, lineStart - 1)
    const endIdx = Math.min(lines.length - 1, lineEnd - 1)
    
    // Safety check: if start > end or start out of bounds, return empty or handle gracefully
    if (startIdx > endIdx) return ''
    
    const slice = lines.slice(startIdx, endIdx + 1)
    return slice.join('\n')
  }

  async listDir(path: string): Promise<string[]> {
    const absPath = this._resolve(path)
    const entries = await readdir(absPath, { withFileTypes: true })
    return entries.map(e => e.name)
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = this._resolve(path)
    this._assertMutablePathAllowed(path, resolved)
    await writeFile(resolved, content, 'utf8')
  }

  async exists(path: string): Promise<boolean> {
    // Validate path first - throws if access denied
    const resolved = this._resolve(path)
    try {
      await access(resolved, constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    const resolved = this._resolve(path)
    this._assertMutablePathAllowed(path, resolved)
    await mkdir(resolved, { recursive: true })
  }

  async glob(pattern: string, options?: { ignore?: string[] }): Promise<string[]> {
    // pattern is relative to baseDir
    // we use glob package which supports cwd
    // return paths relative to baseDir (as glob does by default when cwd is set)
    const matches = await glob(pattern, { 
      cwd: this.#baseDir,
      nodir: false,
      ignore: options?.ignore
    })
    return matches
  }

  async stat(path: string): Promise<{ isDirectory: boolean; size: number; mtime: Date } | null> {
    // Validate path first - throws if access denied
    const resolved = this._resolve(path)
    try {
      const s = await stat(resolved)
      return { 
        isDirectory: s.isDirectory(),
        size: s.size,
        mtime: s.mtime
      }
    } catch {
      return null
    }
  }
}
