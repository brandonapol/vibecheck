import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defineConfig } from '../config/schema.js'
import { runCommitMsgHook } from './commit-msg.js'

describe('commit-msg language patterns', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('tags a language test file as phase1', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-phase-'))
    const file = join(dir, 'COMMIT_EDITMSG')
    writeFileSync(file, 'test: add go\n')
    const config = defineConfig({
      languages: { go: { testPatterns: ['**/*.gittest'] } },
      hooks: { commitMsg: true },
    })
    await runCommitMsgHook(config, file, async () => ['pkg/add.gittest'])
    expect(readFileSync(file, 'utf-8')).toBe('test: add go\n\n[vibecheck:phase1]\n')
  })
})
