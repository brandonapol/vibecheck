import { describe, it, expect } from 'vitest'

describe('vibecheck exports', () => {
  it('exports defineConfig and defaultConfig', async () => {
    const mod = await import('./index.js')
    expect(mod.defineConfig).toBeDefined()
    expect(mod.defaultConfig).toBeDefined()
  })
})
