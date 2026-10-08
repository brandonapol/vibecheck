import { describe, expect, it } from 'vitest'
import { detectConfigWeakening } from './config-diff.js'
import { defaultConfig } from '../config/schema.js'

describe('top-level test patterns', () => {
  it('reports a dropped test pattern', () => {
    const after = { ...defaultConfig, testPatterns: ['**/*.spec.ts'] }
    const violations = detectConfigWeakening(defaultConfig, after)
    expect(violations.map(violation => violation.field)).toEqual(['testPatterns'])
    expect(violations[0].detail).toContain('**/*.test.ts')
  })

  it('allows an added test pattern', () => {
    const after = { ...defaultConfig, testPatterns: [...defaultConfig.testPatterns, '**/*_test.go'] }
    expect(detectConfigWeakening(defaultConfig, after)).toEqual([])
  })
})
