import type { Config } from '../config/schema.js'
import { checkMutationThresholds, type MutationReport } from '../analyzers/mutation.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'
import type { ConfigWeakeningViolation } from '../analyzers/config-diff.js'
import type { ProtectedTestViolation } from '../analyzers/protected-tests.js'
import { calculateScore, type AnalyzerResults, type Weights } from '../core/score.js'
import { formatReport } from '../reporters/console.js'

export type AnalyzerInputs = {
  mutationScore: number
  mutationReport?: MutationReport
  semanticViolations: WeakeningViolation[]
  /** How the branch's config weakens the base branch's; any entry fails. */
  configViolations?: ConfigWeakeningViolation[]
  /** Findings in protected tests; any entry fails, whatever the enforcement. */
  protectedViolations?: ProtectedTestViolation[]
}

export type CheckResult = {
  pass: boolean
  score: ReturnType<typeof calculateScore>
  /** Why the check failed, one line per gate; empty when it passed. */
  failures: string[]
  report: string
}

const VIOLATION_WEIGHT = 0.1

export async function runCheck(config: Config, inputs: AnalyzerInputs): Promise<CheckResult> {
  const weights: Weights = {
    mutation: 40,
    semanticDiff: 10,
    hiddenTests: 30,
    propertyTests: 20,
  }

  const enabledPatterns = new Set(config.semanticDiff.patterns)
  const semanticViolations = config.semanticDiff.enabled
    ? inputs.semanticViolations.filter(v => enabledPatterns.has(v.pattern))
    : []
  const weakeningRate = Math.min(semanticViolations.length * VIOLATION_WEIGHT, 1)

  const results: AnalyzerResults = {
    mutation: {
      score: inputs.mutationScore,
      enabled: config.mutation.enabled,
    },
    semanticDiff: {
      weakeningRate,
      enabled: config.semanticDiff.enabled,
    },
    hiddenTests: {
      passRate: 0,
      enabled: false,
    },
    propertyTests: {
      coverage: 0,
      enabled: false,
    },
  }

  const score = calculateScore(results, weights)
  const failures: string[] = []

  if (score.total < config.threshold) {
    failures.push(`Integrity score ${score.total} is below the threshold of ${config.threshold}`)
  }

  // The score is a quality signal; these are gates it cannot outweigh.
  if (config.mutation.enabled) {
    const report = inputs.mutationReport ?? { overallScore: inputs.mutationScore, fileScores: {}, survivingMutants: [] }
    const mutation = checkMutationThresholds(report, config.mutation)
    if (!mutation.ok) {
      for (const v of mutation.violations) {
        failures.push(
          v.type === 'mutation-score-below-threshold'
            ? `Mutation score ${round(v.score)}% is below the threshold of ${v.threshold}%`
            : `${v.file}: mutation score ${round(v.score)}% is below the per-file threshold of ${v.threshold}%`,
        )
      }
    }
  }

  if (config.semanticDiff.enforcement === 'block' && semanticViolations.length > 0) {
    failures.push(`${semanticViolations.length} assertion weakening violation(s) with enforcement 'block'`)
  }

  for (const v of inputs.protectedViolations ?? []) {
    failures.push(`Protected test — ${v.file}: ${v.detail}`)
  }

  for (const v of inputs.configViolations ?? []) {
    failures.push(`Config weakening — ${v.field}: ${v.detail}`)
  }

  const pass = failures.length === 0
  const report = formatReport(score, config.threshold, {
    mutation: inputs.mutationReport,
    mutationThreshold: config.mutation.threshold,
    semanticDiff: semanticViolations.length > 0 ? semanticViolations : undefined,
    configViolations: inputs.configViolations,
    protectedViolations: inputs.protectedViolations,
    pass,
    failures,
  })

  return { pass, score, failures, report }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
