import { describe, it, expect } from 'vitest'
import { configSchema, defineConfig, defaultConfig } from './schema.js'

describe('configSchema', () => {
  it('parses a full valid config', () => {
    const input = {
      testPatterns: ['**/*.test.ts', '**/*.spec.ts'],
      protectedBranch: 'main',
      agentTrailers: ['Co-Authored-By: Claude'],
      enforcement: { agents: 'strict' as const, humans: 'warn' as const },
      allowlist: ['src/**/*.mock.ts'],
      hooks: { preCommit: true, commitMsg: false },
    }
    const result = configSchema.parse(input)
    expect(result).toEqual(input)
  })

  it('applies defaults for all optional fields', () => {
    const result = configSchema.parse({})
    expect(result.testPatterns).toEqual(['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'])
    expect(result.protectedBranch).toBe('main')
    expect(result.agentTrailers).toContain('Co-Authored-By: Claude')
    expect(result.enforcement).toEqual({ agents: 'strict', humans: 'warn' })
    expect(result.allowlist).toEqual([])
    expect(result.hooks).toEqual({ preCommit: true, commitMsg: false })
  })

  it('rejects invalid enforcement levels', () => {
    expect(() =>
      configSchema.parse({ enforcement: { agents: 'yolo', humans: 'strict' } })
    ).toThrow()
  })

  it('rejects non-string test patterns', () => {
    expect(() => configSchema.parse({ testPatterns: [123] })).toThrow()
  })

  it('rejects non-string agent trailers', () => {
    expect(() => configSchema.parse({ agentTrailers: [true] })).toThrow()
  })
})

describe('defaultConfig', () => {
  it('is a valid config', () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow()
  })

  it('has sensible test patterns', () => {
    expect(defaultConfig.testPatterns).toContain('**/*.test.ts')
    expect(defaultConfig.testPatterns).toContain('**/*.spec.ts')
  })
})

describe('defineConfig', () => {
  it('returns a validated config', () => {
    const config = defineConfig({ testPatterns: ['**/*.test.ts'] })
    expect(config.testPatterns).toEqual(['**/*.test.ts'])
    expect(config.protectedBranch).toBe('main')
  })

  it('fills in defaults for omitted fields', () => {
    const config = defineConfig({})
    expect(config.enforcement.agents).toBe('strict')
    expect(config.hooks.preCommit).toBe(true)
  })

  it('throws on invalid input', () => {
    expect(() => defineConfig({ enforcement: { agents: 'invalid' } } as any)).toThrow()
  })
})
