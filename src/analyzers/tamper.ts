export type TamperKind = 'hook-drift' | 'stryker-disable' | 'test-runner-drift' | 'workflow-drift'

export type TamperViolation = {
  file: string
  kind: TamperKind
  detail: string
  /** Workflow edits are visible but do not fail the check. Branch protection is the real gate. */
  blocking: boolean
}

export type TamperChange = {
  file: string
  before: string
  after: string
}

const HOOKS = new Set(['.husky/pre-commit', 'hooks/pre-commit'])

function norm(file: string): string {
  return file.replace(/\\/g, '/')
}

export function isHookPath(file: string): boolean {
  const path = norm(file)
  return HOOKS.has(path) || path.endsWith('/.husky/pre-commit')
}

export function isWorkflowPath(file: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(norm(file))
}

export function isRunnerConfig(file: string): boolean {
  const base = norm(file).split('/').pop() ?? ''
  return /^vitest\.config\./.test(base) || /^vite\.config\./.test(base) || /^stryker\.config\./.test(base) || base.startsWith('stryker.conf')
}

export function tamperCandidate(file: string): boolean {
  return isHookPath(file) || isWorkflowPath(file) || isRunnerConfig(file) || /\.(ts|tsx|js|jsx|mjs|cjs|dart|go)$/.test(file)
}

function disableCount(source: string): number {
  return source.match(/stryker\s+disable/gi)?.length ?? 0
}

function globs(source: string, key: 'include' | 'exclude'): string[] {
  const found: string[] = []
  const blocks = source.matchAll(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`, 'g'))
  for (const block of blocks) {
    for (const item of block[1].matchAll(/['"`]([^'"`]+)['"`]/g)) found.push(item[1])
  }
  return found
}

/**
 * Drift between a branch and its base that turns a check off. Config
 * weakening is a separate analyzer; this covers hooks, Stryker comments,
 * and test-runner globs.
 */
export function detectTamper(changes: TamperChange[]): TamperViolation[] {
  const violations: TamperViolation[] = []
  for (const change of changes) {
    const file = norm(change.file)
    if (isHookPath(file) && change.before !== '' && change.before !== change.after) {
      violations.push({
        file,
        kind: 'hook-drift',
        blocking: true,
        detail: change.after === '' ? 'pre-commit hook deleted' : 'pre-commit hook modified relative to the base branch',
      })
    }

    const added = disableCount(change.after) - disableCount(change.before)
    if (added > 0) {
      violations.push({
        file,
        kind: 'stryker-disable',
        blocking: true,
        detail: `${added} new \`Stryker disable\` comment${added === 1 ? '' : 's'}`,
      })
    }

    if (isRunnerConfig(file)) {
      const removedInclude = globs(change.before, 'include').filter(g => !globs(change.after, 'include').includes(g))
      const addedExclude = globs(change.after, 'exclude').filter(g => !globs(change.before, 'exclude').includes(g))
      if (removedInclude.length > 0 || addedExclude.length > 0) {
        const parts = []
        if (removedInclude.length > 0) parts.push(`include dropped ${removedInclude.join(', ')}`)
        if (addedExclude.length > 0) parts.push(`exclude added ${addedExclude.join(', ')}`)
        violations.push({
          file,
          kind: 'test-runner-drift',
          blocking: true,
          detail: parts.join('; '),
        })
      }
    }

    if (isWorkflowPath(file) && change.before !== change.after) {
      violations.push({
        file,
        kind: 'workflow-drift',
        blocking: false,
        detail: 'vibecheck workflow changed (reported only; branch protection decides whether CI can be edited)',
      })
    }
  }
  return violations
}
