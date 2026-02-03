/**
 * Domain Layer - Ports
 *
 * ArtifactStore abstracts file/asset access for future adapters.
 * V0 may still use direct fs access in tools/services; this port defines the target boundary.
 */

export interface ArtifactStore {
  readFile(path: string): Promise<string>
  readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string>
  getRevision(path: string): Promise<string>
  listDir(path: string): Promise<string[]>
  writeFile(path: string, content: string): Promise<void>
}

