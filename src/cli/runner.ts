import type { Config } from '../config/schema.js'
import { checkMutationThresholds, type MutationReport } from '../analyzers/mutation.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'
import type { ConfigWeakeningViolation } from '../analyzers/config-diff.js'
import type { ProtectedTestViolation } from '../analyzers/protected-tests.js'
import type { TamperViolation } from '../analyzers/tamper.js'
import type { HiddenTestReport } from '../analyzers/hidden-tests.js'
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
  /** Hook, Stryker-comment, and test-runner drift. Non-blocking entries are reported only. */
  tamperViolations?: TamperViolation[]
  /** Holdout suite. Omitted when hidden tests did not run. */
  hidden?: HiddenTestReport
  /** Which analyzers actually ran. Omitted means ran, so a bare score still counts.
   *  A skipped analyzer must not be reported as a perfect score. */
  ran?: { mutation?: boolean; semanticDiff?: boolean; hiddenTests?: boolean }
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
  const mutationRan = inputs.ran?.mutation ?? true
  const semanticRan = inputs.ran?.semanticDiff ?? true
  const hiddenRan = inputs.ran?.hiddenTests ?? true
  const semanticViolations = config.semanticDiff.enabled && semanticRan
    ? inputs.semanticViolations.filter(v => enabledPatterns.has(v.pattern))
    : []
  const weakeningRate = Math.min(semanticViolations.length * VIOLATION_WEIGHT, 1)

  const results: AnalyzerResults = {
    mutation: {
      score: inputs.mutationScore,
      enabled: config.mutation.enabled && mutationRan,
    },
    semanticDiff: {
      weakeningRate,
      enabled: config.semanticDiff.enabled && semanticRan,
    },
    hiddenTests: {
      passRate: inputs.hidden?.passRate ?? 0,
      enabled: config.hiddenTests.enabled && hiddenRan,
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
  if (config.mutation.enabled && mutationRan) {
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

  if (config.semanticDiff.enforcement === 'block' && semanticRan && semanticViolations.length > 0) {
    failures.push(`${semanticViolations.length} assertion weakening violation(s) with enforcement 'block'`)
  }

  if (config.hiddenTests.enabled && hiddenRan && config.hiddenTests.enforcement === 'block') {
    const hidden = inputs.hidden
    if (!hidden || hidden.total === 0) {
      failures.push('Hidden tests ran no tests')
    } else if (hidden.passRate < config.hiddenTests.threshold) {
      failures.push(
        `Hidden tests pass rate ${round(hidden.passRate)}% is below the threshold of ${config.hiddenTests.threshold}%`,
      )
    }
  }

  for (const v of inputs.protectedViolations ?? []) {
    failures.push(`Protected test — ${v.file}: ${v.detail}`)
  }

  for (const v of inputs.tamperViolations ?? []) {
    if (v.blocking) failures.push(`Tamper — ${v.file}: ${v.detail}`)
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
    tamperViolations: inputs.tamperViolations,
    hiddenThreshold: config.hiddenTests.enabled ? config.hiddenTests.threshold : undefined,
    hiddenFailures: inputs.hidden?.failures,
    pass,
    failures,
    skipped: {
      mutation: config.mutation.enabled && !mutationRan,
      semanticDiff: config.semanticDiff.enabled && !semanticRan,
      hiddenTests: config.hiddenTests.enabled && !hiddenRan,
    },
  })

  return { pass, score, failures, report }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
