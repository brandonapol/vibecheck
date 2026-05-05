import { describe, it, expect } from 'vitest'
import { configSchema, defineConfig, defaultConfig } from './schema.js'

describe('configSchema', () => {
  it('parses a full valid config', () => {
    const input = {
      testPatterns: ['**/*.test.ts', '**/*.spec.ts'],
      protectedBranch: 'main',
      mutation: {
        enabled: true,
        tool: 'stryker' as const,
        threshold: 80,
        perFileThreshold: 60,
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.d.ts'],
      },
      semanticDiff: {
        enabled: true,
        patterns: ['precision-reduction', 'test-deletion'] as const[],
        enforcement: 'block' as const,
      },
      propertyTests: {
        enabled: false,
        framework: 'fast-check' as const,
        requiredFor: ['src/core/**/*.ts'],
        minIterations: 1000,
      },
      hiddenTests: {
        enabled: false as const,
      },
      reporters: ['console' as const],
    }
    const result = configSchema.parse(input)
    expect(result.testPatterns).toEqual(input.testPatterns)
    expect(result.mutation.threshold).toBe(80)
    expect(result.semanticDiff.enforcement).toBe('block')
    expect(result.propertyTests.enabled).toBe(false)
    expect(result.hiddenTests.enabled).toBe(false)
    expect(result.reporters).toEqual(['console'])
  })

  it('applies defaults for all optional fields', () => {
    const result = configSchema.parse({})
    expect(result.testPatterns).toEqual(['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'])
    expect(result.protectedBranch).toBe('main')
    expect(result.mutation.enabled).toBe(true)
    expect(result.mutation.threshold).toBe(80)
    expect(result.mutation.perFileThreshold).toBe(60)
    expect(result.semanticDiff.enabled).toBe(true)
    expect(result.semanticDiff.enforcement).toBe('block')
    expect(result.propertyTests.enabled).toBe(false)
    expect(result.hiddenTests.enabled).toBe(false)
    expect(result.reporters).toEqual(['console'])
  })

  it('rejects invalid mutation threshold', () => {
    expect(() =>
      configSchema.parse({ mutation: { threshold: 150 } })
    ).toThrow()
  })

  it('rejects invalid mutation threshold below zero', () => {
    expect(() =>
      configSchema.parse({ mutation: { threshold: -1 } })
    ).toThrow()
  })

  it('rejects invalid semantic diff enforcement level', () => {
    expect(() =>
      configSchema.parse({ semanticDiff: { enforcement: 'yolo' } })
    ).toThrow()
  })

  it('rejects non-string test patterns', () => {
    expect(() => configSchema.parse({ testPatterns: [123] })).toThrow()
  })

  it('rejects invalid reporter names', () => {
    expect(() => configSchema.parse({ reporters: ['telegraph'] })).toThrow()
  })

  it('accepts hidden tests with repo source', () => {
    const result = configSchema.parse({
      hiddenTests: {
        enabled: true,
        source: 'repo',
        url: 'git@github.com:org/hidden-tests.git',
      },
    })
    expect(result.hiddenTests.source).toBe('repo')
    if (result.hiddenTests.source === 'repo') {
      expect(result.hiddenTests.url).toBe('git@github.com:org/hidden-tests.git')
    }
  })

  it('does not contain old agent-detection fields', () => {
    const result = configSchema.parse({})
    expect(result).not.toHaveProperty('agentTrailers')
    expect(result).not.toHaveProperty('enforcement')
    expect(result).not.toHaveProperty('allowlist')
    expect(result).not.toHaveProperty('hooks')
  })
})

describe('defaultConfig', () => {
  it('is a valid config', () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow()
  })

  it('has mutation enabled by default', () => {
    expect(defaultConfig.mutation.enabled).toBe(true)
    expect(defaultConfig.mutation.tool).toBe('stryker')
  })

  it('has semantic diff enabled by default', () => {
    expect(defaultConfig.semanticDiff.enabled).toBe(true)
  })

  it('has property tests and hidden tests disabled by default', () => {
    expect(defaultConfig.propertyTests.enabled).toBe(false)
    expect(defaultConfig.hiddenTests.enabled).toBe(false)
  })
})

describe('defineConfig', () => {
  it('returns a validated config with overrides', () => {
    const config = defineConfig({
      mutation: { threshold: 90 },
    })
    expect(config.mutation.threshold).toBe(90)
    expect(config.mutation.tool).toBe('stryker')
    expect(config.protectedBranch).toBe('main')
  })

  it('fills in defaults for omitted fields', () => {
    const config = defineConfig({})
    expect(config.mutation.enabled).toBe(true)
    expect(config.semanticDiff.enforcement).toBe('block')
    expect(config.reporters).toEqual(['console'])
  })

  it('throws on invalid input', () => {
    expect(() => defineConfig({ mutation: { threshold: 200 } } as any)).toThrow()
  })
})
