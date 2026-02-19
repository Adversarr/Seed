import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

type LayerViolation = {
  importerPath: string
  line: number
  moduleSpecifier: string
  resolvedPath: string
}

type AnalysisResult = {
  violations: LayerViolation[]
}

function walkFiles(rootDir: string, predicate: (filePath: string) => boolean): string[] {
  if (!existsSync(rootDir)) {
    return []
  }

  const stack = [rootDir]
  const output: string[] = []

  while (stack.length > 0) {
    const currentDir = stack.pop()!
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (predicate(fullPath)) {
        output.push(fullPath)
      }
    }
  }

  return output.sort()
}

function isTypeScriptFile(filePath: string): boolean {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    return false
  }
  return !filePath.endsWith('.d.ts')
}

function parseSourceFile(filePath: string): ts.SourceFile {
  const content = readFileSync(filePath, 'utf8')
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function getLineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return position.line + 1
}

function resolveImportTarget(importerPath: string, moduleSpecifier: string, repoRoot: string): string | null {
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/') && !moduleSpecifier.startsWith('src/')) {
    return null
  }

  const unresolved = moduleSpecifier.startsWith('src/')
    ? path.resolve(repoRoot, moduleSpecifier)
    : path.resolve(path.dirname(importerPath), moduleSpecifier)

  const candidates = new Set<string>()
  candidates.add(unresolved)
  candidates.add(`${unresolved}.ts`)
  candidates.add(`${unresolved}.tsx`)
  candidates.add(path.join(unresolved, 'index.ts'))
  candidates.add(path.join(unresolved, 'index.tsx'))

  if (moduleSpecifier.endsWith('.js') || moduleSpecifier.endsWith('.mjs') || moduleSpecifier.endsWith('.cjs')) {
    candidates.add(unresolved.replace(/\.(mjs|cjs|js)$/u, '.ts'))
    candidates.add(unresolved.replace(/\.(mjs|cjs|js)$/u, '.tsx'))
  }

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate)
    if (existsSync(normalized)) {
      return normalized
    }
  }

  return null
}

function isUnderDir(targetPath: string, dirPath: string): boolean {
  const relative = path.relative(dirPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function analyzeLayerBoundaries(repoRoot: string): AnalysisResult {
  const srcRoot = path.join(repoRoot, 'src')
  const infrastructureRoot = path.join(srcRoot, 'infrastructure')
  const restrictedRoots = [
    path.join(srcRoot, 'core'),
    path.join(srcRoot, 'application'),
    path.join(srcRoot, 'agents'),
  ]

  const restrictedFiles = restrictedRoots.flatMap((rootDir) => walkFiles(rootDir, isTypeScriptFile))
  const violations: LayerViolation[] = []

  for (const filePath of restrictedFiles) {
    const sourceFile = parseSourceFile(filePath)

    const inspectModuleSpecifier = (moduleSpecifierNode: ts.StringLiteralLike): void => {
      const moduleSpecifier = moduleSpecifierNode.text
      const resolvedPath = resolveImportTarget(filePath, moduleSpecifier, repoRoot)
      if (!resolvedPath) {
        return
      }
      if (!isUnderDir(resolvedPath, infrastructureRoot)) {
        return
      }

      violations.push({
        importerPath: filePath,
        line: getLineNumber(sourceFile, moduleSpecifierNode),
        moduleSpecifier,
        resolvedPath,
      })
    }

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        inspectModuleSpecifier(statement.moduleSpecifier)
        continue
      }

      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        inspectModuleSpecifier(statement.moduleSpecifier)
      }
    }
  }

  return { violations }
}

function toRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/gu, '/')
}

export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  const rootFlagIndex = argv.indexOf('--root')
  const repoRoot =
    rootFlagIndex >= 0 && argv[rootFlagIndex + 1]
      ? path.resolve(argv[rootFlagIndex + 1]!)
      : process.cwd()

  const result = analyzeLayerBoundaries(repoRoot)
  if (result.violations.length === 0) {
    console.log('No layer boundary violations found for src/core, src/application, and src/agents.')
    return 0
  }

  console.error('Disallowed layer imports detected:')
  for (const violation of result.violations) {
    const importerPath = toRelativePath(repoRoot, violation.importerPath)
    const resolvedPath = toRelativePath(repoRoot, violation.resolvedPath)
    console.error(
      `- ${importerPath}:${violation.line} imports "${violation.moduleSpecifier}" (resolved to ${resolvedPath})`
    )
  }
  return 1
}

const isMainModule =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  process.exitCode = runCli()
}
