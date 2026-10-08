import { execa } from 'execa'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../config/schema.js'
import {
  auditRange,
  findAuditHits,
  formatAudit,
  loadAuditCommits,
  parseAuditLog,
  type AuditCommit,
} from './audit.js'

const patterns = defaultConfig

function commit(message: string, files: AuditCommit['files']): AuditCommit {
  return { sha: 'abcdef1234567890abcdef1234567890abcdef12', message, files }
}

const agent = 'edit\n\nCo-Authored-By: Claude <noreply@anthropic.com>'

describe('findAuditHits', () => {
  it('reports an agent edit or deletion of a test that already existed', () => {
    const hits = findAuditHits([
      commit(agent, [{ status: 'M', path: 'src/a.test.ts' }]),
      commit(agent, [{ status: 'D', path: 'src/b.test.ts' }]),
    ], patterns)
    expect(hits.map(hit => hit.files)).toEqual([['src/a.test.ts'], ['src/b.test.ts']])
    expect(hits[0].signal).toBe('trailer:Co-Authored-By: Claude')
  })

  it('ignores a new test, an implementation edit, and a commit with no agent trailer', () => {
    const hits = findAuditHits([
      commit(agent, [{ status: 'A', path: 'src/new.test.ts' }]),
      commit(agent, [{ status: 'M', path: 'src/a.ts' }]),
      commit('human edit', [{ status: 'M', path: 'src/a.test.ts' }]),
    ], patterns)
    expect(hits).toEqual([])
  })

  it('reports a rename or copy by the path that already existed', () => {
    const renamed = findAuditHits([
      commit(agent, [{ status: 'R', path: 'src/b.test.ts', previousPath: 'src/a.test.ts' }]),
    ], patterns)
    const copied = findAuditHits([
      commit(agent, [{ status: 'C', path: 'src/b.test.ts', previousPath: 'src/a.test.ts' }]),
    ], patterns)
    expect(renamed[0].files).toEqual(['src/a.test.ts'])
    expect(copied[0].files).toEqual(['src/a.test.ts'])
  })

  it('reports a type change of an existing test', () => {
    const hits = findAuditHits([
      commit(agent, [{ status: 'T', path: 'src/a.test.ts' }]),
    ], patterns)
    expect(hits[0].files).toEqual(['src/a.test.ts'])
  })
})

describe('parseAuditLog', () => {
  it('reads commit messages and name-status lines', () => {
    const text = [
      'COMMIT abcdef1234567890abcdef1234567890abcdef12',
      'feat: edit',
      '',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      '',
      'ENDMSG abcdef1234567890abcdef1234567890abcdef12',
      '',
      'M\tsrc/a.test.ts',
      'COMMIT 1234567890abcdef1234567890abcdef12345678',
      'test: add',
      '',
      'ENDMSG 1234567890abcdef1234567890abcdef12345678',
      '',
      'A\tsrc/a.test.ts',
      '',
    ].join('\n')
    const commits = parseAuditLog(text)
    expect(commits).toHaveLength(2)
    expect(commits[0].files).toEqual([{ status: 'M', path: 'src/a.test.ts' }])
    expect(commits[0].message).toContain('Co-Authored-By: Claude')
    expect(commits[1].files).toEqual([{ status: 'A', path: 'src/a.test.ts' }])
  })

  it('reads a rename score as the old path and the new path', () => {
    const text = [
      'COMMIT abcdef1234567890abcdef1234567890abcdef12',
      'feat: rename',
      '',
      'ENDMSG abcdef1234567890abcdef1234567890abcdef12',
      '',
      'R100\tsrc/a.test.ts\tsrc/b.test.ts',
      '',
    ].join('\n')
    expect(parseAuditLog(text)[0].files).toEqual([
      { status: 'R', path: 'src/b.test.ts', previousPath: 'src/a.test.ts' },
    ])
  })

  it('returns nothing for an empty log', () => {
    expect(parseAuditLog('')).toEqual([])
  })

  it('fails closed when a commit has no ENDMSG', () => {
    expect(() => parseAuditLog('COMMIT abcdef1234567890abcdef1234567890abcdef12\nfeat: edit\n')).toThrow(/ENDMSG/)
  })
})

describe('formatAudit', () => {
  it('says when nothing matched', () => {
    expect(formatAudit([])).toBe('vibecheck audit: no agent commits modified protected tests\n')
  })

  it('lists each commit and the tests it changed', () => {
    const text = formatAudit([{
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      signal: 'trailer:Co-Authored-By: Claude',
      files: ['src/a.test.ts'],
    }])
    expect(text).toContain('1 commit modified protected tests')
    expect(text).toContain('abcdef123456  trailer:Co-Authored-By: Claude')
    expect(text).toContain('  src/a.test.ts')
  })
})

describe('auditRange', () => {
  it('audits all of HEAD unless --since is set', () => {
    expect(auditRange()).toBe('HEAD')
    expect(auditRange('origin/main')).toBe('origin/main..HEAD')
  })

  it('rejects a range that looks like a git option', () => {
    expect(() => auditRange('--all')).toThrow(/--since/)
    expect(() => auditRange('origin/main extra')).toThrow(/--since/)
  })
})

describe('loadAuditCommits', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('reads an agent edit of an existing test from a real repository', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-audit-'))
    const git = (args: string[]) => execa('git', args, { cwd: dir })
    await git(['init', '-b', 'main'])
    await git(['config', 'user.email', 'audit@example.com'])
    await git(['config', 'user.name', 'Audit'])
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/a.test.ts'), 'test one\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'test: add'])
    writeFileSync(join(dir, 'src/a.test.ts'), 'test one\nchanged\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'feat: edit\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n'])

    const hits = findAuditHits(await loadAuditCommits(dir), defaultConfig)
    expect(hits).toHaveLength(1)
    expect(hits[0].files).toEqual(['src/a.test.ts'])
    expect(hits[0].signal).toContain('Claude')
  })
})
