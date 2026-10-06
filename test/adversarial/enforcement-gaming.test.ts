import { describe, it, expect } from 'vitest'
import { runCheck } from '../../src/cli/runner.js'
import { defaultConfig } from '../../src/config/schema.js'
import type { WeakeningViolation } from '../../src/analyzers/semantic-diff.js'

/**
 * ADVERSARIAL TESTS: weakening tests while keeping the composite score high.
 * The score folds semantic diff in at weight 10, so on its own it can never
 * stop weakening (see score-gaming.test.ts). Enforcement has to gate it.
 */

describe('Enforcement Gaming Attacks', () => {
  it('FIXED: unlimited weakening at a perfect mutation score no longer passes', async () => {
    const violations: WeakeningViolation[] = Array.from({ length: 50 }, (_, i) => ({
      file: `src/f${i}.test.ts`,
      pattern: 'test-deletion',
      detail: `Test "t${i}" was deleted`,
    }))
    const result = await runCheck(defaultConfig, { mutationScore: 100, semanticViolations: violations })
    // The score still clears 80 (40·100 + 10·0) / 50 — the gate is what fails it.
    expect(result.score.total).toBe(80)
    expect(result.pass).toBe(false)
  })

  it('FIXED: the --threshold override no longer lowers the mutation gate', async () => {
    const config = { ...defaultConfig, threshold: 0 }
    const result = await runCheck(config, { mutationScore: 10, semanticViolations: [] })
    expect(result.pass).toBe(false)
  })
})
