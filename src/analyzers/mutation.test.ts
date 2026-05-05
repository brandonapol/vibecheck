import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runMutationAnalysis,
  checkMutationThresholds,
  extractScores,
  type MutationReport,
  type MutationConfig,
} from './mutation.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

import { execa } from 'execa'
import { readFile } from 'node:fs/promises'

const mockExeca = vi.mocked(execa)
const mockReadFile = vi.mocked(readFile)

const defaultMutationConfig: MutationConfig = {
  enabled: true,
  tool: 'stryker',
  threshold: 80,
  perFileThreshold: 60,
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.d.ts'],
}

const sampleStrykerReport = {
  files: {
    'src/core/calculator.ts': {
      mutants: [
        { id: '1', status: 'Killed', mutatorName: 'ArithmeticOperator', location: { start: { line: 10, column: 5 } }, replacement: '-' },
        { id: '2', status: 'Killed', mutatorName: 'ConditionalExpression', location: { start: { line: 15, column: 8 } }, replacement: 'false' },
        { id: '3', status: 'Survived', mutatorName: 'ArithmeticOperator', location: { start: { line: 20, column: 3 } }, replacement: '*' },
      ],
    },
    'src/core/validator.ts': {
      mutants: [
        { id: '4', status: 'Killed', mutatorName: 'BooleanLiteral', location: { start: { line: 5, column: 10 } }, replacement: 'false' },
        { id: '5', status: 'Killed', mutatorName: 'StringLiteral', location: { start: { line: 8, column: 2 } }, replacement: '""' },
      ],
    },
  },
}

describe('extractScores', () => {
  it('calculates overall mutation score', () => {
    const report = extractScores(sampleStrykerReport)
    // 4 killed out of 5 total = 80%
    expect(report.overallScore).toBe(80)
  })

  it('calculates per-file scores', () => {
    const report = extractScores(sampleStrykerReport)
    // calculator: 2 killed / 3 total = 66.67%
    expect(report.fileScores['src/core/calculator.ts']).toBeCloseTo(66.67, 0)
    // validator: 2 killed / 2 total = 100%
    expect(report.fileScores['src/core/validator.ts']).toBe(100)
  })

  it('extracts surviving mutants', () => {
    const report = extractScores(sampleStrykerReport)
    expect(report.survivingMutants).toHaveLength(1)
    expect(report.survivingMutants[0]).toEqual({
      file: 'src/core/calculator.ts',
      mutator: 'ArithmeticOperator',
      location: { line: 20, column: 3 },
      replacement: '*',
    })
  })

  it('handles empty report', () => {
    const report = extractScores({ files: {} })
    expect(report.overallScore).toBe(100)
    expect(report.fileScores).toEqual({})
    expect(report.survivingMutants).toEqual([])
  })
})

describe('checkMutationThresholds', () => {
  it('passes when score meets threshold', () => {
    const report: MutationReport = {
      overallScore: 85,
      fileScores: { 'src/foo.ts': 85 },
      survivingMutants: [],
    }
    const result = checkMutationThresholds(report, defaultMutationConfig)
    expect(result.ok).toBe(true)
  })

  it('passes when score exactly equals threshold', () => {
    const report: MutationReport = {
      overallScore: 80,
      fileScores: { 'src/foo.ts': 80 },
      survivingMutants: [],
    }
    const result = checkMutationThresholds(report, defaultMutationConfig)
    expect(result.ok).toBe(true)
  })

  it('fails when overall score is below threshold', () => {
    const report: MutationReport = {
      overallScore: 70,
      fileScores: { 'src/foo.ts': 70 },
      survivingMutants: [
        { file: 'src/foo.ts', mutator: 'ArithmeticOperator', location: { line: 1, column: 1 }, replacement: '-' },
      ],
    }
    const result = checkMutationThresholds(report, defaultMutationConfig)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].type).toBe('mutation-score-below-threshold')
    }
  })

  it('fails when a per-file score is below per-file threshold', () => {
    const report: MutationReport = {
      overallScore: 85,
      fileScores: { 'src/foo.ts': 90, 'src/bar.ts': 50 },
      survivingMutants: [],
    }
    const result = checkMutationThresholds(report, defaultMutationConfig)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.some(v => v.type === 'file-mutation-score-below-threshold')).toBe(true)
    }
  })
})

describe('runMutationAnalysis', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('runs stryker and parses the report', async () => {
    mockExeca.mockResolvedValueOnce({} as any)
    mockReadFile.mockResolvedValueOnce(JSON.stringify(sampleStrykerReport))

    const report = await runMutationAnalysis(defaultMutationConfig)
    expect(report.overallScore).toBe(80)
    expect(mockExeca).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['stryker', 'run']),
    )
  })

  it('throws when stryker fails', async () => {
    mockExeca.mockRejectedValueOnce(new Error('stryker crashed'))

    await expect(runMutationAnalysis(defaultMutationConfig)).rejects.toThrow('stryker crashed')
  })
})
