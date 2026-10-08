import { describe, expect, it } from 'vitest'
import { defineConfig } from '../config/schema.js'
import { runPreCommit } from './pre-commit.js'

describe('hooks.preCommit', () => {
  it('skips enforcement when the pre-commit hook is turned off', async () => {
    const result = await runPreCommit(defineConfig({ hooks: { preCommit: false } }), {
      staged: ['src/a.ts', 'src/a.test.ts'],
      commitMessage: '',
      env: {},
      protectedPaths: ['src/a.test.ts'],
    })
    expect(result).toEqual({ exitCode: 0, message: '' })
  })
})
