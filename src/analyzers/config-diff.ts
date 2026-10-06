import type { Config } from '../config/schema.js'
import { resolveLanguages } from '../languages/registry.js'
import type { ResolvedLanguage } from '../languages/types.js'

export type ConfigWeakeningViolation = {
  field: string
  before: unknown
  after: unknown
  detail: string
}

const COMMIT_ENFORCEMENT_RANK: Record<string, number> = { block: 2, warn: 1, off: 0 }

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

  if (after.threshold < before.threshold) {
    violations.push({
      field: 'threshold',
      before: before.threshold,
      after: after.threshold,
      detail: `Composite threshold reduced from ${before.threshold} to ${after.threshold}`,
    })
  }

  for (const tier of ['agents', 'unknown'] as const) {
    if (COMMIT_ENFORCEMENT_RANK[after.enforcement[tier]] < COMMIT_ENFORCEMENT_RANK[before.enforcement[tier]]) {
      violations.push({
        field: `enforcement.${tier}`,
        before: before.enforcement[tier],
        after: after.enforcement[tier],
        detail: `Enforcement for ${tier} commits downgraded from '${before.enforcement[tier]}' to '${after.enforcement[tier]}'`,
      })
    }
  }

  const droppedEnvVars = removed(before.agentEnvVars, after.agentEnvVars)
  if (droppedEnvVars.length > 0) {
    violations.push({
      field: 'agentEnvVars',
      before: before.agentEnvVars,
      after: after.agentEnvVars,
      detail: `Agent environment variables removed: ${droppedEnvVars.join(', ')}`,
    })
  }

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

  detectLanguageWeakening(resolveLanguages(before), resolveLanguages(after), violations)

  return violations
}

function removed(before: string[], after: string[]): string[] {
  return before.filter(e => !after.includes(e))
}

function detectLanguageWeakening(
  before: ResolvedLanguage[],
  after: ResolvedLanguage[],
  violations: ConfigWeakeningViolation[],
): void {
  for (const was of before) {
    if (!was.enabled) continue
    const field = `languages.${was.id}`
    const now = after.find(l => l.id === was.id)

    if (!now || !now.enabled) {
      violations.push({
        field: `${field}.enabled`,
        before: true,
        after: false,
        detail: `Language '${was.id}' was ${now ? 'disabled' : 'removed'}`,
      })
      continue
    }

    // The top-level checks above already cover a language derived from them.
    if (was.source === 'top-level' && now.source === 'top-level') continue

    if (was.mutation.enabled && !now.mutation.enabled) {
      violations.push({
        field: `${field}.mutation.enabled`,
        before: true,
        after: false,
        detail: `Mutation analysis was disabled for '${was.id}'`,
      })
    }

    const droppedPatterns = removed(was.testPatterns, now.testPatterns)
    if (droppedPatterns.length > 0) {
      violations.push({
        field: `${field}.testPatterns`,
        before: was.testPatterns,
        after: now.testPatterns,
        detail: `Test patterns removed for '${was.id}': ${droppedPatterns.join(', ')}`,
      })
    }

    const droppedIncludes = removed(was.mutation.include, now.mutation.include)
    if (droppedIncludes.length > 0) {
      violations.push({
        field: `${field}.mutation.include`,
        before: was.mutation.include,
        after: now.mutation.include,
        detail: `Include patterns removed for '${was.id}': ${droppedIncludes.join(', ')}`,
      })
    }

    const addedExcludes = removed(now.mutation.exclude, was.mutation.exclude)
    if (addedExcludes.length > 0) {
      violations.push({
        field: `${field}.mutation.exclude`,
        before: was.mutation.exclude,
        after: now.mutation.exclude,
        detail: `New exclusions added for '${was.id}': ${addedExcludes.join(', ')}`,
      })
    }
  }
}
