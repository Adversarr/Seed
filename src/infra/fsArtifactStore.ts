import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ArtifactStore } from '../domain/ports/artifactStore.js'

export class FsArtifactStore implements ArtifactStore {
  readonly #baseDir: string

  constructor(baseDir: string) {
    this.#baseDir = baseDir
  }

  private _resolve(path: string): string {
    return resolve(this.#baseDir, path)
  }

  async readFile(path: string): Promise<string> {
    return readFile(this._resolve(path), 'utf8')
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
    // Return relative paths or just names? 
    // The interface says "string[]". Usually listDir returns file names in that dir.
    // Let's return names for now, or relative paths? 
    // Standard "ls" returns names.
    return entries.map(e => e.name)
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(this._resolve(path), content, 'utf8')
  }
}
