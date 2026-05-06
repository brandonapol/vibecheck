import type { Config } from '../config/schema.js'

export type ConfigWeakeningViolation = {
  field: string
  before: unknown
  after: unknown
  detail: string
}

const ENFORCEMENT_RANK: Record<string, number> = {
  block: 3,
  warn: 2,
  comment: 1,
}

export function detectConfigWeakening(
  before: Config,
  after: Config,
): ConfigWeakeningViolation[] {
  const violations: ConfigWeakeningViolation[] = []

  if (before.mutation.enabled && !after.mutation.enabled) {
    violations.push({
      field: 'mutation.enabled',
      before: true,
      after: false,
      detail: 'Mutation analyzer was disabled',
    })
  }

  if (after.mutation.threshold < before.mutation.threshold) {
    violations.push({
      field: 'mutation.threshold',
      before: before.mutation.threshold,
      after: after.mutation.threshold,
      detail: `Mutation threshold reduced from ${before.mutation.threshold} to ${after.mutation.threshold}`,
    })
  }

  if (after.mutation.perFileThreshold < before.mutation.perFileThreshold) {
    violations.push({
      field: 'mutation.perFileThreshold',
      before: before.mutation.perFileThreshold,
      after: after.mutation.perFileThreshold,
      detail: `Per-file threshold reduced from ${before.mutation.perFileThreshold} to ${after.mutation.perFileThreshold}`,
    })
  }

  const addedExcludes = after.mutation.exclude.filter(
    e => !before.mutation.exclude.includes(e),
  )
  if (addedExcludes.length > 0) {
    violations.push({
      field: 'mutation.exclude',
      before: before.mutation.exclude,
      after: after.mutation.exclude,
      detail: `New exclusions added: ${addedExcludes.join(', ')}`,
    })
  }

  const removedIncludes = before.mutation.include.filter(
    e => !after.mutation.include.includes(e),
  )
  if (removedIncludes.length > 0) {
    violations.push({
      field: 'mutation.include',
      before: before.mutation.include,
      after: after.mutation.include,
      detail: `Include patterns removed: ${removedIncludes.join(', ')}`,
    })
  }

  if (before.semanticDiff.enabled && !after.semanticDiff.enabled) {
    violations.push({
      field: 'semanticDiff.enabled',
      before: true,
      after: false,
      detail: 'Semantic diff analyzer was disabled',
    })
  }

  const beforeRank = ENFORCEMENT_RANK[before.semanticDiff.enforcement] ?? 0
  const afterRank = ENFORCEMENT_RANK[after.semanticDiff.enforcement] ?? 0
  if (afterRank < beforeRank) {
    violations.push({
      field: 'semanticDiff.enforcement',
      before: before.semanticDiff.enforcement,
      after: after.semanticDiff.enforcement,
      detail: `Enforcement downgraded from '${before.semanticDiff.enforcement}' to '${after.semanticDiff.enforcement}'`,
    })
  }

  return violations
}
