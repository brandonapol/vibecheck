import type { Config } from '../config/schema.js'
import type { MutationReport } from '../analyzers/mutation.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'
import { calculateScore, type AnalyzerResults, type Weights } from '../core/score.js'
import { formatReport } from '../reporters/console.js'

export type AnalyzerInputs = {
  mutationScore: number
  mutationReport?: MutationReport
  semanticViolations: WeakeningViolation[]
}

export type CheckResult = {
  pass: boolean
  score: ReturnType<typeof calculateScore>
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

  const weakeningRate = Math.min(inputs.semanticViolations.length * VIOLATION_WEIGHT, 1)

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

  const threshold = config.mutation.threshold

  const report = formatReport(score, threshold, {
    mutation: inputs.mutationReport,
    semanticDiff: inputs.semanticViolations.length > 0 ? inputs.semanticViolations : undefined,
  })

  return {
    pass: score.total >= threshold,
    score,
    report,
  }
}
