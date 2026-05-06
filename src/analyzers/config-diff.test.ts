import { describe, it, expect } from 'vitest'
import { detectConfigWeakening, type ConfigWeakeningViolation } from './config-diff.js'
import { defaultConfig, type Config } from '../config/schema.js'

describe('detectConfigWeakening', () => {
  it('returns no violations for identical configs', () => {
    const violations = detectConfigWeakening(defaultConfig, defaultConfig)
    expect(violations).toEqual([])
  })

  it('detects mutation threshold reduction', () => {
    const before = { ...defaultConfig }
    const after = { ...defaultConfig, mutation: { ...defaultConfig.mutation, threshold: 50 } }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('mutation.threshold')
    expect(violations[0].before).toBe(80)
    expect(violations[0].after).toBe(50)
  })

  it('detects mutation perFileThreshold reduction', () => {
    const before = { ...defaultConfig }
    const after = { ...defaultConfig, mutation: { ...defaultConfig.mutation, perFileThreshold: 20 } }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('mutation.perFileThreshold')
  })

  it('detects mutation analyzer being disabled', () => {
    const before = { ...defaultConfig }
    const after = { ...defaultConfig, mutation: { ...defaultConfig.mutation, enabled: false } }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('mutation.enabled')
    expect(violations[0].before).toBe(true)
    expect(violations[0].after).toBe(false)
  })

  it('detects semantic diff analyzer being disabled', () => {
    const before = { ...defaultConfig }
    const after = { ...defaultConfig, semanticDiff: { ...defaultConfig.semanticDiff, enabled: false } }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('semanticDiff.enabled')
  })

  it('detects enforcement downgrade from block to warn', () => {
    const before = { ...defaultConfig }
    const after = {
      ...defaultConfig,
      semanticDiff: { ...defaultConfig.semanticDiff, enforcement: 'warn' as const },
    }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('semanticDiff.enforcement')
    expect(violations[0].before).toBe('block')
    expect(violations[0].after).toBe('warn')
  })

  it('detects enforcement downgrade from warn to comment', () => {
    const before = {
      ...defaultConfig,
      semanticDiff: { ...defaultConfig.semanticDiff, enforcement: 'warn' as const },
    }
    const after = {
      ...defaultConfig,
      semanticDiff: { ...defaultConfig.semanticDiff, enforcement: 'comment' as const },
    }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('semanticDiff.enforcement')
  })

  it('detects new entries in mutation exclude list', () => {
    const before = { ...defaultConfig }
    const after = {
      ...defaultConfig,
      mutation: {
        ...defaultConfig.mutation,
        exclude: [...defaultConfig.mutation.exclude, 'src/payments/**'],
      },
    }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('mutation.exclude')
    expect(violations[0].detail).toContain('src/payments/**')
  })

  it('allows threshold increases (strengthening)', () => {
    const before = { ...defaultConfig }
    const after = { ...defaultConfig, mutation: { ...defaultConfig.mutation, threshold: 95 } }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toEqual([])
  })

  it('allows enabling a previously disabled analyzer', () => {
    const before = { ...defaultConfig, mutation: { ...defaultConfig.mutation, enabled: false } }
    const after = { ...defaultConfig }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toEqual([])
  })

  it('allows enforcement upgrade from warn to block', () => {
    const before = {
      ...defaultConfig,
      semanticDiff: { ...defaultConfig.semanticDiff, enforcement: 'warn' as const },
    }
    const after = { ...defaultConfig }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toEqual([])
  })

  it('detects multiple violations at once', () => {
    const before = { ...defaultConfig }
    const after = {
      ...defaultConfig,
      mutation: { ...defaultConfig.mutation, enabled: false, threshold: 10 },
      semanticDiff: { ...defaultConfig.semanticDiff, enforcement: 'comment' as const },
    }
    const violations = detectConfigWeakening(before, after)
    expect(violations.length).toBeGreaterThanOrEqual(3)
  })

  it('detects removal of entries from mutation include list', () => {
    const before = { ...defaultConfig }
    const after = {
      ...defaultConfig,
      mutation: { ...defaultConfig.mutation, include: [] },
    }
    const violations = detectConfigWeakening(before, after)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('mutation.include')
  })
})
