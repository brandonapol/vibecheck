import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defineConfig } from '../config/schema.js'
import { applyPhaseTag, commitPhase, runCommitMsgHook, tagCommitMessage } from './commit-msg.js'

const patterns = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts']

describe('commitPhase', () => {
  it('is phase1 when only tests are staged', () => {
    expect(commitPhase(['src/a.test.ts', 'README.md'], patterns)).toBe('phase1')
  })

  it('is phase2 when only implementation is staged', () => {
    expect(commitPhase(['src/a.ts', 'docs/cli.md'], patterns)).toBe('phase2')
  })

  it('is empty when tests and implementation are mixed, or when nothing is code', () => {
    expect(commitPhase(['src/a.ts', 'src/a.test.ts'], patterns)).toBeNull()
    expect(commitPhase(['README.md'], patterns)).toBeNull()
    expect(commitPhase(['vibecheck.config.ts'], patterns)).toBeNull()
  })

  it('still calls a test commit phase1 when config is staged with the tests', () => {
    expect(commitPhase(['vibecheck.config.ts', 'src/a.test.ts'], patterns)).toBe('phase1')
  })
})

describe('tagCommitMessage', () => {
  it('appends the phase tag on its own line', () => {
    expect(tagCommitMessage('feat: add a hook\n', 'phase2')).toBe('feat: add a hook\n\n[vibecheck:phase2]\n')
  })

  it('does not add the tag twice', () => {
    const message = 'feat: add a hook\n\n[vibecheck:phase2]\n'
    expect(tagCommitMessage(message, 'phase2')).toBe(message)
  })

  it('leaves a message with no phase untouched', () => {
    expect(tagCommitMessage('docs: notes\n', null)).toBe('docs: notes\n')
  })
})

describe('applyPhaseTag', () => {
  it('does nothing while commit-msg tagging is off', () => {
    expect(applyPhaseTag('feat: add\n', ['src/a.ts'], patterns, false)).toBe('feat: add\n')
  })
})

describe('runCommitMsgHook', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('writes the tag into the message file when tagging is on', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-commit-msg-'))
    const file = join(dir, 'COMMIT_EDITMSG')
    writeFileSync(file, 'feat: add a hook\n')
    await runCommitMsgHook(defineConfig({ hooks: { commitMsg: true } }), file, async () => ['src/a.ts'])
    expect(readFileSync(file, 'utf-8')).toBe('feat: add a hook\n\n[vibecheck:phase2]\n')
  })

  it('does not touch the message file when tagging is off', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-commit-msg-'))
    const file = join(dir, 'COMMIT_EDITMSG')
    writeFileSync(file, 'feat: add a hook\n')
    await runCommitMsgHook(defineConfig({}), file, async () => ['src/a.ts'])
    expect(readFileSync(file, 'utf-8')).toBe('feat: add a hook\n')
  })
})
