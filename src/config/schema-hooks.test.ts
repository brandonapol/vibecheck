import { describe, expect, it } from 'vitest'
import { configSchema, defaultConfig, defineConfig } from './schema.js'

describe('hooks config', () => {
  it('tags no commits by default and leaves the pre-commit hook on', () => {
    expect(defaultConfig.hooks).toEqual({ preCommit: true, commitMsg: false })
  })

  it('turns commit-msg tagging on', () => {
    expect(defineConfig({ hooks: { commitMsg: true } }).hooks.commitMsg).toBe(true)
    expect(defineConfig({ hooks: { commitMsg: true } }).hooks.preCommit).toBe(true)
  })

  it('rejects a non-boolean hook flag', () => {
    expect(() => configSchema.parse({ hooks: { commitMsg: 'yes' } })).toThrow()
  })
})
