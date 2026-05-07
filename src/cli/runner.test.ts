import { describe, it, expect, vi } from 'vitest'
import { runCheck, type CheckResult } from './runner.js'
import type { Config } from '../config/schema.js'
import { defaultConfig } from '../config/schema.js'

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  ...defaultConfig,
  ...overrides,
})

describe('runCheck', () => {
  it('returns passing result when all analyzers pass', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 90,
      semanticViolations: [],
    })

    expect(result.pass).toBe(true)
    expect(result.score.total).toBeGreaterThanOrEqual(80)
  })

  it('returns failing result when mutation score is below threshold', async () => {
    const config = makeConfig({ mutation: { ...defaultConfig.mutation, threshold: 80 } })
    const result = await runCheck(config, {
      mutationScore: 50,
      semanticViolations: [],
    })

    expect(result.pass).toBe(false)
    expect(result.score.components.mutation).toBe(50)
  })

  it('includes mutation score in components', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 85,
      semanticViolations: [],
    })

    expect(result.score.components.mutation).toBe(85)
  })

  it('includes semantic diff score in components', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [],
    })

    expect(result.score.components.semanticDiff).toBe(100)
  })

  it('calculates semantic diff score based on violation count', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [
        { file: 'a.test.ts', pattern: 'precision-reduction', detail: 'weakened' },
        { file: 'b.test.ts', pattern: 'test-deletion', detail: 'deleted' },
      ],
    })

    expect(result.score.components.semanticDiff).toBeLessThan(100)
  })

  it('skips disabled analyzers', async () => {
    const config = makeConfig({
      mutation: { ...defaultConfig.mutation, enabled: false },
      semanticDiff: { ...defaultConfig.semanticDiff, enabled: false },
    })
    const result = await runCheck(config, {
      mutationScore: 0,
      semanticViolations: [],
    })

    expect(result.pass).toBe(false)
    expect(result.score.total).toBe(0)
    expect(result.score.components.mutation).toBeUndefined()
    expect(result.score.components.semanticDiff).toBeUndefined()
  })

  it('includes formatted report in output', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 85,
      semanticViolations: [],
    })

    expect(result.report).toContain('vibecheck')
    expect(result.report).toContain('Mutation Score')
  })

  it('includes surviving mutants in report when provided', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 75,
      mutationReport: {
        overallScore: 75,
        fileScores: { 'src/foo.ts': 75 },
        survivingMutants: [
          { file: 'src/foo.ts', mutator: 'ArithmeticOperator', location: { line: 10, column: 5 }, replacement: '-' },
        ],
      },
      semanticViolations: [],
    })

    expect(result.report).toContain('src/foo.ts')
    expect(result.report).toContain('ArithmeticOperator')
  })

  it('uses configurable threshold for pass/fail', async () => {
    const config = makeConfig({
      mutation: { ...defaultConfig.mutation, threshold: 90 },
    })

    const passing = await runCheck(config, {
      mutationScore: 95,
      semanticViolations: [],
    })
    expect(passing.pass).toBe(true)

    const failing = await runCheck(config, {
      mutationScore: 70,
      semanticViolations: [],
    })
    expect(failing.pass).toBe(false)
  })
})
