import { describe, it, expect } from 'vitest'
import { extractScores, mergeMutationReports, type CountedMutationReport } from './mutation.js'

const mutant = (status: string, line: number) => ({
  id: String(line),
  status,
  mutatorName: 'ArithmeticOperator',
  location: { start: { line, column: 1 } },
  replacement: '-',
})

describe('extractScores counts', () => {
  it('reports how many mutants were killed out of the total', () => {
    const report = extractScores({
      files: {
        'src/a.ts': { mutants: [mutant('Killed', 1), mutant('Survived', 2), mutant('Killed', 3)] },
      },
    })
    expect(report.killed).toBe(2)
    expect(report.total).toBe(3)
  })

  it('counts timeout as killed and uncovered against the score, ignoring compile errors', () => {
    const report = extractScores({
      files: {
        'src/a.ts': {
          mutants: [
            mutant('Killed', 1),
            mutant('Timeout', 2),
            mutant('NoCoverage', 3),
            mutant('CompileError', 4),
            mutant('Ignored', 5),
          ],
        },
      },
    })
    expect(report.killed).toBe(2)
    expect(report.total).toBe(3)
    expect(report.overallScore).toBeCloseTo(66.67, 1)
    expect(report.survivingMutants.map(item => item.location.line)).toEqual([3])
  })

  it('refuses to score a pending mutant as a kill', () => {
    expect(() => extractScores({
      files: { 'src/a.ts': { mutants: [mutant('Pending', 1)] } },
    })).toThrow(/Pending/)
  })
})

describe('mergeMutationReports', () => {
  const a: CountedMutationReport = {
    overallScore: 50,
    fileScores: { 'src/a.ts': 50 },
    survivingMutants: [{ file: 'src/a.ts', mutator: 'X', location: { line: 1, column: 1 }, replacement: '-' }],
    killed: 1,
    total: 2,
  }
  const b: CountedMutationReport = {
    overallScore: 100,
    fileScores: { 'pkg/b.go': 100 },
    survivingMutants: [],
    killed: 8,
    total: 8,
  }

  it('weights the overall score by mutant count, not by report', () => {
    const merged = mergeMutationReports([a, b])
    expect(merged.overallScore).toBe(90)
    expect(merged.killed).toBe(9)
    expect(merged.total).toBe(10)
  })

  it('keeps every file score and surviving mutant', () => {
    const merged = mergeMutationReports([a, b])
    expect(merged.fileScores).toEqual({ 'src/a.ts': 50, 'pkg/b.go': 100 })
    expect(merged.survivingMutants).toEqual(a.survivingMutants)
  })

  it('returns a single report unchanged in substance', () => {
    expect(mergeMutationReports([a])).toEqual(a)
  })

  it('marks the merge diff-scoped only when an input was', () => {
    expect(mergeMutationReports([{ ...a, diffScoped: true }, b]).diffScoped).toBe(true)
    expect(mergeMutationReports([a, b]).diffScoped).toBeUndefined()
  })

  it('scores an empty merge like a run with no mutants', () => {
    expect(mergeMutationReports([])).toEqual({
      overallScore: 100,
      fileScores: {},
      survivingMutants: [],
      killed: 0,
      total: 0,
    })
  })
})
