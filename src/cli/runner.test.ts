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

  it('does not count a skipped mutation run as a perfect score', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [],
      ran: { mutation: false, semanticDiff: true },
    })

    expect(result.score.components.mutation).toBeUndefined()
    expect(result.score.components.semanticDiff).toBe(100)
    expect(result.report).toContain('Mutation Score:       — (skipped)')
    expect(result.pass).toBe(true)
  })

  it('does not count a skipped semantic run as clean', async () => {
    const config = makeConfig()
    const result = await runCheck(config, {
      mutationScore: 90,
      semanticViolations: [
        { file: 'a.test.ts', pattern: 'test-deletion', detail: 'deleted' },
      ],
      ran: { mutation: true, semanticDiff: false },
    })

    expect(result.score.components.semanticDiff).toBeUndefined()
    expect(result.report).toContain('Semantic Diff:        — (skipped)')
    expect(result.pass).toBe(true)
  })

  it('fails the check on a blocking tamper finding and not on a report-only one', async () => {
    const blocking = await runCheck(makeConfig(), {
      mutationScore: 100,
      semanticViolations: [],
      tamperViolations: [{ file: '.husky/pre-commit', kind: 'hook-drift', detail: 'pre-commit hook deleted', blocking: true }],
    })
    expect(blocking.pass).toBe(false)
    expect(blocking.report).toContain('hook-drift')

    const noted = await runCheck(makeConfig(), {
      mutationScore: 100,
      semanticViolations: [],
      tamperViolations: [{ file: '.github/workflows/vibecheck.yml', kind: 'workflow-drift', detail: 'changed', blocking: false }],
    })
    expect(noted.pass).toBe(true)
    expect(noted.report).toContain('report only')
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

  it('puts the hidden-test pass rate in the score and fails when it is below the threshold', async () => {
    const config = makeConfig({
      hiddenTests: {
        enabled: true,
        source: 'directory',
        path: '.vibecheck-hidden',
        tool: 'vitest',
        threshold: 100,
        enforcement: 'block',
      },
    })
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [],
      hidden: { passRate: 50, passed: 1, failed: 1, skipped: 0, total: 2, failures: ['holdout fails'] },
    })
    expect(result.score.components.hiddenTests).toBe(50)
    expect(result.pass).toBe(false)
    expect(result.failures.some(line => line.includes('50%'))).toBe(true)
    expect(result.report).toContain('holdout fails')
  })

  it('does not fail the check when hidden-test enforcement is warn', async () => {
    const config = makeConfig({
      hiddenTests: {
        enabled: true,
        source: 'directory',
        path: '.vibecheck-hidden',
        tool: 'vitest',
        threshold: 100,
        enforcement: 'warn',
      },
    })
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [],
      hidden: { passRate: 50, passed: 1, failed: 1, skipped: 0, total: 2, failures: [] },
    })
    expect(result.pass).toBe(true)
    expect(result.score.components.hiddenTests).toBe(50)
  })

  it('fails closed when the hidden suite ran no tests', async () => {
    const config = makeConfig({
      hiddenTests: {
        enabled: true,
        source: 'directory',
        path: '.vibecheck-hidden',
        tool: 'vitest',
        threshold: 100,
        enforcement: 'block',
      },
    })
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [],
      hidden: { passRate: 0, passed: 0, failed: 0, skipped: 0, total: 0, failures: [] },
    })
    expect(result.pass).toBe(false)
    expect(result.failures).toContain('Hidden tests ran no tests')
  })

  it('does not count a skipped hidden-test run as a score', async () => {
    const config = makeConfig({
      hiddenTests: {
        enabled: true,
        source: 'directory',
        path: '.vibecheck-hidden',
        tool: 'vitest',
        threshold: 100,
        enforcement: 'block',
      },
    })
    const result = await runCheck(config, {
      mutationScore: 100,
      semanticViolations: [],
      ran: { mutation: true, semanticDiff: true, hiddenTests: false },
    })
    expect(result.score.components.hiddenTests).toBeUndefined()
    expect(result.report).toContain('Hidden Tests:         — (skipped)')
    expect(result.pass).toBe(true)
  })
})
