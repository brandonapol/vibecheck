import { describe, it, expect } from 'vitest'
import { resolveCheckConfig } from '../../src/cli/config-source.js'
import { runCheck } from '../../src/cli/runner.js'
import { defineConfig, type Config } from '../../src/config/schema.js'

/**
 * ADVERSARIAL TESTS: weakening the config in the same PR it is meant to judge.
 * In CI the config comes from the base branch, and the PR's own config is
 * only an input to config-weakening detection.
 */

const base = defineConfig({})

async function checkInCi(head: Config, mutationScore = 100) {
  const resolved = await resolveCheckConfig({
    head,
    env: { CI: 'true' },
    readAtRef: async () => 'base',
    evaluate: async () => base,
  })
  return runCheck(resolved.config, {
    mutationScore,
    semanticViolations: [],
    configViolations: resolved.configViolations,
  })
}

describe('Config Gaming Attacks', () => {
  it('FIXED: lowering mutation.threshold in the PR does not lower the bar', async () => {
    const result = await checkInCi(defineConfig({ mutation: { threshold: 10 } }), 50)
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.includes('below the threshold of 80%'))).toBe(true)
  })

  it('FIXED: disabling an analyzer in the PR fails the check', async () => {
    const result = await checkInCi(defineConfig({ semanticDiff: { enabled: false } }))
    expect(result.pass).toBe(false)
    expect(result.failures.some(f => f.includes('semanticDiff.enabled'))).toBe(true)
  })

  it('FIXED: excluding files from mutation in the PR fails the check', async () => {
    const result = await checkInCi(defineConfig({ mutation: { exclude: ['src/payments/**'] } }))
    expect(result.pass).toBe(false)
  })
})
