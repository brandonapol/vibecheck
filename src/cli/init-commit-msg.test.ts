import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scaffoldProject } from './init.js'

describe('commit-msg hook install', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vibecheck-commit-msg-hook-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('installs a commit-msg hook that passes the message file through', async () => {
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true })
    const result = await scaffoldProject(tmpDir)
    expect(result.commitMsgHook).toEqual({ path: '.git/hooks/commit-msg', action: 'created' })
    const script = readFileSync(join(tmpDir, '.git', 'hooks', 'commit-msg'), 'utf-8')
    expect(script).toContain('vibecheck commit-msg')
    expect(script).toContain('"$1"')
  })

  it('skips the commit-msg hook outside a git checkout', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(result.commitMsgHook).toEqual({ path: '.git/hooks/commit-msg', action: 'skipped' })
  })
})
