import { describe, it, expect } from 'vitest'

describe('vibecheck exports', () => {
  it('exports config utilities', async () => {
    const mod = await import('./index.js')
    expect(mod.defineConfig).toBeDefined()
    expect(mod.defaultConfig).toBeDefined()
    expect(mod.loadConfig).toBeDefined()
  })

  it('exports analyzer functions', async () => {
    const mod = await import('./index.js')
    expect(mod.extractScores).toBeDefined()
    expect(mod.checkMutationThresholds).toBeDefined()
    expect(mod.detectWeakeningInDiff).toBeDefined()
    expect(mod.ASSERTION_STRENGTH).toBeDefined()
  })

  it('exports scoring and reporting', async () => {
    const mod = await import('./index.js')
    expect(mod.calculateScore).toBeDefined()
    expect(mod.formatReport).toBeDefined()
    expect(mod.runCheck).toBeDefined()
  })
})
