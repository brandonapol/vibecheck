import type { IntegrityScore } from '../core/score.js'
import type { MutationReport } from '../analyzers/mutation.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'

type ReportDetails = {
  mutation?: MutationReport
  semanticDiff?: WeakeningViolation[]
}

export function formatReport(
  score: IntegrityScore,
  threshold: number,
  details: ReportDetails,
): string {
  const lines: string[] = []
  const status = score.total >= threshold ? 'PASS' : 'FAIL'

  lines.push(`vibecheck: Test Integrity Score — ${score.total}/100 (threshold: ${threshold}) ${status}`)
  lines.push('')

  if (score.components.mutation !== undefined) {
    lines.push(`  Mutation Score:       ${score.components.mutation}% (threshold: ${threshold})`)
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

  return lines.join('\n')
}
