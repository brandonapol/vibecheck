import { describe, it, expect } from 'vitest'
import { runCheck } from './runner.js'
import { defineConfig } from '../config/schema.js'
import type { WeakeningViolation } from '../analyzers/semantic-diff.js'

const weakened: WeakeningViolation = {
  file: 'src/a.test.ts',
  pattern: 'precision-reduction',
  detail: 'Test "adds": .toBe() weakened to .toBeDefined()',
}

describe('runCheck — semantic diff enforcement', () => {
  it('fails on a single violation under block, even at a perfect mutation score', async () => {
    const result = await runCheck(defineConfig({ semanticDiff: { enforcement: 'block' } }), {
      mutationScore: 100,
      semanticViolations: [weakened],
    })
    expect(result.score.total).toBeGreaterThanOrEqual(80)
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.includes('weakening'))).toBe(true)
  })

  it('blocks by default', async () => {
    const result = await runCheck(defineConfig({}), { mutationScore: 100, semanticViolations: [weakened] })
    expect(result.pass).toBe(false)
  })

  it('reports but passes under warn', async () => {
    const result = await runCheck(defineConfig({ semanticDiff: { enforcement: 'warn' } }), {
      mutationScore: 100,
      semanticViolations: [weakened],
    })
    expect(result.pass).toBe(true)
    expect(result.report).toContain('precision-reduction')
  })

  it('reports but passes under comment', async () => {
    const result = await runCheck(defineConfig({ semanticDiff: { enforcement: 'comment' } }), {
      mutationScore: 100,
      semanticViolations: [weakened],
    })
    expect(result.pass).toBe(true)
    expect(result.report).toContain('precision-reduction')
  })

  it('ignores violations of patterns the config does not enable', async () => {
    const result = await runCheck(defineConfig({ semanticDiff: { patterns: ['test-deletion'] } }), {
      mutationScore: 100,
      semanticViolations: [weakened],
    })
    expect(result.pass).toBe(true)
    expect(result.report).not.toContain('precision-reduction')
  })

  it('ignores violations when semantic diff is disabled', async () => {
    const result = await runCheck(defineConfig({ semanticDiff: { enabled: false } }), {
      mutationScore: 100,
      semanticViolations: [weakened],
    })
    expect(result.pass).toBe(true)
  })

  it('marks a blocked report FAIL and says why, even when the score clears the threshold', async () => {
    const result = await runCheck(defineConfig({}), { mutationScore: 100, semanticViolations: [weakened] })
    expect(result.report).toContain('FAIL')
    expect(result.report).not.toMatch(/\bPASS\b/)
    expect(result.report).toContain('Blocking')
  })
})

describe('runCheck — thresholds', () => {
  it('compares the composite score against its own threshold', async () => {
    const result = await runCheck(defineConfig({ threshold: 95, mutation: { threshold: 50 } }), {
      mutationScore: 90,
      semanticViolations: [],
    })
    expect(result.score.total).toBe(92)
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.includes('95'))).toBe(true)
  })

  it('gates the mutation score on mutation.threshold independently of the composite', async () => {
    const result = await runCheck(defineConfig({ threshold: 50, mutation: { threshold: 95 } }), {
      mutationScore: 90,
      semanticViolations: [],
    })
    expect(result.score.total).toBeGreaterThanOrEqual(50)
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.toLowerCase().includes('mutation'))).toBe(true)
  })

  it('gates each file on mutation.perFileThreshold when a report is available', async () => {
    const result = await runCheck(defineConfig({ mutation: { perFileThreshold: 60 } }), {
      mutationScore: 90,
      mutationReport: {
        overallScore: 90,
        fileScores: { 'src/good.ts': 100, 'src/weak.ts': 40 },
        survivingMutants: [],
      },
      semanticViolations: [],
    })
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.includes('src/weak.ts'))).toBe(true)
  })

  it('does not gate mutation when mutation analysis is disabled', async () => {
    const result = await runCheck(defineConfig({ mutation: { enabled: false, threshold: 95 } }), {
      mutationScore: 0,
      semanticViolations: [],
    })
    expect(result.failures.some(f => f.toLowerCase().includes('mutation score'))).toBe(false)
  })

  it('passes with no failures when every gate is met', async () => {
    const result = await runCheck(defineConfig({}), { mutationScore: 90, semanticViolations: [] })
    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
  })
})

describe('runCheck — config weakening', () => {
  it('fails and lists each weakened field', async () => {
    const result = await runCheck(defineConfig({}), {
      mutationScore: 100,
      semanticViolations: [],
      configViolations: [
        { field: 'mutation.threshold', before: 80, after: 10, detail: 'Mutation threshold reduced from 80 to 10' },
      ],
    })
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.includes('mutation.threshold'))).toBe(true)
    expect(result.report).toContain('Config weakening')
  })
})
