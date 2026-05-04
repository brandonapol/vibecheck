import { describe, it, expect } from 'vitest'

describe('agent-tdd', () => {
  it('exports defineConfig', async () => {
    const mod = await import('./index.js')
    expect(mod.defineConfig).toBeDefined()
  })
})
