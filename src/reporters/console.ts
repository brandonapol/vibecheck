import type { IntegrityScore } from '../core/score.js'
import type { MutationReport } from '../analyzers/mutation.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'
import type { ConfigWeakeningViolation } from '../analyzers/config-diff.js'

type ReportDetails = {
  mutation?: MutationReport
  /** Shown on the mutation line; defaults to the composite threshold. */
  mutationThreshold?: number
  semanticDiff?: WeakeningViolation[]
  configViolations?: ConfigWeakeningViolation[]
  /** The overall verdict when gates other than the score decide it. */
  pass?: boolean
  failures?: string[]
}

export function formatReport(
  score: IntegrityScore,
  threshold: number,
  details: ReportDetails,
): string {
  const lines: string[] = []
  const status = (details.pass ?? score.total >= threshold) ? 'PASS' : 'FAIL'

  lines.push(`vibecheck: Test Integrity Score — ${score.total}/100 (threshold: ${threshold}) ${status}`)
  lines.push('')

  if (score.components.mutation !== undefined) {
    lines.push(`  Mutation Score:       ${score.components.mutation}% (threshold: ${details.mutationThreshold ?? threshold})`)
  }

  if (score.components.semanticDiff !== undefined) {
    const label = score.components.semanticDiff === 100 ? 'Clean' : `${score.components.semanticDiff}%`
    lines.push(`  Semantic Diff:        ${label}`)
  }

  if (score.components.hiddenTests !== undefined) {
    lines.push(`  Hidden Tests:         ${score.components.hiddenTests}%`)
  }

  if (score.components.propertyTests !== undefined) {
    lines.push(`  Property Coverage:    ${score.components.propertyTests}%`)
  }

  if (details.mutation && details.mutation.survivingMutants.length > 0) {
    lines.push('')
    lines.push('  Surviving mutants:')
    for (const mutant of details.mutation.survivingMutants) {
      lines.push(`    ${mutant.file}:${mutant.location.line} — ${mutant.mutator}: replaced with ${mutant.replacement}`)
    }
  }

  if (details.semanticDiff && details.semanticDiff.length > 0) {
    lines.push('')
    lines.push('  Assertion weakening detected:')
    for (const v of details.semanticDiff) {
      lines.push(`    ${v.file} — ${v.pattern}: ${v.detail}`)
    }
  }

  if (details.configViolations && details.configViolations.length > 0) {
    lines.push('')
    lines.push('  Config weakening detected (checked against the base branch config):')
    for (const v of details.configViolations) {
      lines.push(`    ${v.field}: ${v.detail}`)
    }
  }

  if (details.failures && details.failures.length > 0) {
    lines.push('')
    lines.push('  Blocking:')
    for (const failure of details.failures) {
      lines.push(`    ${failure}`)
    }
  }

  return lines.join('\n')
}
