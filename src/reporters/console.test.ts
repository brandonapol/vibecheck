import { describe, it, expect } from 'vitest'
import { formatReport } from './console.js'
import type { IntegrityScore } from '../core/score.js'
import type { MutationReport } from '../analyzers/mutation.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'

describe('formatReport', () => {
  it('formats a passing report', () => {
    const score: IntegrityScore = {
      total: 85,
      components: { mutation: 85, semanticDiff: 100 },
    }
    const output = formatReport(score, 80, {})
    expect(output).toContain('85')
    expect(output).toContain('80')
    expect(output).toContain('Mutation Score')
    expect(output).toContain('85%')
    expect(output).toContain('Semantic Diff')
    expect(output).toContain('Clean')
  })

  it('formats a failing report', () => {
    const score: IntegrityScore = {
      total: 65,
      components: { mutation: 65, semanticDiff: 70 },
    }
    const output = formatReport(score, 80, {})
    expect(output).toContain('65')
    expect(output).toContain('80')
  })

  it('includes surviving mutants when provided', () => {
    const score: IntegrityScore = {
      total: 75,
      components: { mutation: 75 },
    }
    const mutationReport: MutationReport = {
      overallScore: 75,
      fileScores: { 'src/foo.ts': 75 },
      survivingMutants: [
        { file: 'src/foo.ts', mutator: 'ArithmeticOperator', location: { line: 42, column: 5 }, replacement: '-' },
      ],
    }
    const output = formatReport(score, 80, { mutation: mutationReport })
    expect(output).toContain('src/foo.ts')
    expect(output).toContain('ArithmeticOperator')
    expect(output).toContain('42')
  })

  it('includes semantic diff violations when provided', () => {
    const score: IntegrityScore = {
      total: 70,
      components: { semanticDiff: 70 },
    }
    const violations: WeakeningViolation[] = [
      { file: 'src/foo.test.ts', pattern: 'precision-reduction', detail: '.toEqual() weakened to .toBeDefined()' },
    ]
    const output = formatReport(score, 80, { semanticDiff: violations })
    expect(output).toContain('src/foo.test.ts')
    expect(output).toContain('precision-reduction')
  })

  it('omits disabled components', () => {
    const score: IntegrityScore = {
      total: 90,
      components: { mutation: 90 },
    }
    const output = formatReport(score, 80, {})
    expect(output).toContain('Mutation Score')
    expect(output).not.toContain('Hidden Tests')
    expect(output).not.toContain('Property Coverage')
  })

  it('shows all enabled components', () => {
    const score: IntegrityScore = {
      total: 80,
      components: {
        mutation: 80,
        semanticDiff: 100,
        hiddenTests: 60,
        propertyTests: 50,
      },
    }
    const output = formatReport(score, 75, {})
    expect(output).toContain('Mutation Score')
    expect(output).toContain('Semantic Diff')
    expect(output).toContain('Hidden Tests')
    expect(output).toContain('Property Coverage')
  })
})
