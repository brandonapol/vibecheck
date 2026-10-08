import { describe, expect, it } from 'vitest'
import { detectConfigWeakening } from './config-diff.js'
import { defaultConfig } from '../config/schema.js'

describe('hooks config weakening', () => {
  it('reports turning the pre-commit hook off', () => {
    const after = { ...defaultConfig, hooks: { ...defaultConfig.hooks, preCommit: false } }
    const violations = detectConfigWeakening(defaultConfig, after)
    expect(violations.map(violation => violation.field)).toEqual(['hooks.preCommit'])
    expect(violations[0].before).toBe(true)
    expect(violations[0].after).toBe(false)
  })

  it('allows the commit-msg tag to be turned on or off', () => {
    const enabled = { ...defaultConfig, hooks: { ...defaultConfig.hooks, commitMsg: true } }
    expect(detectConfigWeakening(defaultConfig, enabled)).toEqual([])
    expect(detectConfigWeakening(enabled, defaultConfig)).toEqual([])
  })
})
