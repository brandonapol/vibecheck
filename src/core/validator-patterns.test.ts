import { describe, expect, it } from 'vitest'
import { defineConfig } from '../config/schema.js'
import { validate } from './validator.js'

describe('validate language patterns', () => {
  it('asks for protected paths with the enabled language patterns', async () => {
    const config = defineConfig({ languages: { go: { testPatterns: ['**/*.gittest'] } } })
    let seen: string[] = []
    await validate(config, {
      getStagedFiles: async () => ['pkg/add.gittest'],
      getCommitMessage: async () => 'feat: add',
      getProtectedPaths: async (_files, patterns) => {
        seen = patterns
        return []
      },
      env: {},
    })
    expect(seen).toEqual(['**/*.gittest'])
  })
})
