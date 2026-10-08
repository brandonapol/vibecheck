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

  if (after.protectedBranch !== before.protectedBranch) {
    violations.push({
      field: 'protectedBranch',
      before: before.protectedBranch,
      after: after.protectedBranch,
      detail: `Protected branch changed from '${before.protectedBranch}' to '${after.protectedBranch}'`,
    })
  }

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

  const droppedTestPatterns = removed(before.testPatterns, after.testPatterns)
  if (droppedTestPatterns.length > 0) {
    violations.push({
      field: 'testPatterns',
      before: before.testPatterns,
      after: after.testPatterns,
      detail: `Test patterns removed: ${droppedTestPatterns.join(', ')}`,
    })
  }

  if (before.hooks.preCommit && !after.hooks.preCommit) {
    violations.push({
      field: 'hooks.preCommit',
      before: true,
      after: false,
      detail: 'Pre-commit hook was disabled',
    })
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

  const droppedProtected = removed(before.protectedTests.files, after.protectedTests.files)
  if (droppedProtected.length > 0) {
    violations.push({
      field: 'protectedTests.files',
      before: before.protectedTests.files,
      after: after.protectedTests.files,
      detail: `Protected test files removed: ${droppedProtected.join(', ')}`,
    })
  }

  for (const rule of before.protectedTests.required) {
    const kept = after.protectedTests.required.find(r => r.path === rule.path)
    const dropped = kept ? removed(rule.references, kept.references) : rule.references
    if (dropped.length > 0) {
      violations.push({
        field: 'protectedTests.required',
        before: rule,
        after: kept ?? null,
        detail: `Required references removed for '${rule.path}': ${dropped.join(', ')}`,
      })
    }
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
  detectHiddenWeakening(before, after, violations)

  return violations
}

function removed(before: string[], after: string[]): string[] {
  return before.filter(e => !after.includes(e))
}

function detectHiddenWeakening(before: Config, after: Config, violations: ConfigWeakeningViolation[]): void {
  const was = before.hiddenTests
  const now = after.hiddenTests
  if (!was.enabled) return
  if (!now.enabled) {
    violations.push({
      field: 'hiddenTests.enabled',
      before: true,
      after: false,
      detail: 'Hidden tests were disabled',
    })
    return
  }
  if (now.threshold < was.threshold) {
    violations.push({
      field: 'hiddenTests.threshold',
      before: was.threshold,
      after: now.threshold,
      detail: `Hidden-test threshold reduced from ${was.threshold} to ${now.threshold}`,
    })
  }
  if (was.enforcement === 'block' && now.enforcement === 'warn') {
    violations.push({
      field: 'hiddenTests.enforcement',
      before: was.enforcement,
      after: now.enforcement,
      detail: `Hidden-test enforcement downgraded from 'block' to 'warn'`,
    })
  }
  if (was.source !== now.source) {
    violations.push({
      field: 'hiddenTests.source',
      before: was.source,
      after: now.source,
      detail: `Hidden-test source changed from '${was.source}' to '${now.source}'`,
    })
    return
  }
  if (was.source === 'directory' && now.source === 'directory' && was.path !== now.path) {
    violations.push({
      field: 'hiddenTests.path',
      before: was.path,
      after: now.path,
      detail: `Hidden-test directory changed from '${was.path}' to '${now.path}'`,
    })
  }
  if (was.source === 'repo' && now.source === 'repo') {
    if (was.url !== now.url) {
      violations.push({
        field: 'hiddenTests.url',
        before: was.url,
        after: now.url,
        detail: `Hidden-test repo changed from '${was.url}' to '${now.url}'`,
      })
    }
    if (was.branch !== now.branch) {
      violations.push({
        field: 'hiddenTests.branch',
        before: was.branch,
        after: now.branch,
        detail: `Hidden-test branch changed from '${was.branch}' to '${now.branch}'`,
      })
    }
  }
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
