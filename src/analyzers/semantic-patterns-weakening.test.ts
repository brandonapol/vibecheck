import { describe, expect, it } from 'vitest'
import { defineConfig } from '../config/schema.js'
import { detectConfigWeakening } from './config-diff.js'

describe('semanticDiff pattern weakening', () => {
  it('reports a pattern that was removed', () => {
    const before = defineConfig({ semanticDiff: { patterns: ['test-deletion', 'skip-addition'] } })
    const after = defineConfig({ semanticDiff: { patterns: ['skip-addition'] } })
    const violations = detectConfigWeakening(before, after)
    expect(violations.map(violation => violation.field)).toEqual(['semanticDiff.patterns'])
    expect(violations[0].detail.includes('test-deletion')).toBe(true)
  })

  it('allows a pattern to be added', () => {
    const before = defineConfig({ semanticDiff: { patterns: ['test-deletion'] } })
    const after = defineConfig({ semanticDiff: { patterns: ['test-deletion', 'skip-addition'] } })
    expect(detectConfigWeakening(before, after)).toEqual([])
  })
})
