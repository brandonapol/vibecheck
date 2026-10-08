import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditTarget, getChangedFiles, getFileAtRef, listWorktreeFilesContaining, readAuditedFile } from './worktree.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'

const mockExeca = vi.mocked(execa)

describe('getChangedFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the diff paths', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'src/a.ts\nsrc/a.test.ts\n' } as never)
    await expect(getChangedFiles('origin/main')).resolves.toEqual(['src/a.ts', 'src/a.test.ts'])
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--name-only', 'origin/main'])
  })

  it('diffs the commit when a tip ref is given', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'src/a.ts\n' } as never)
    await expect(getChangedFiles('origin/main', 'HEAD')).resolves.toEqual(['src/a.ts'])
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--name-only', 'origin/main', 'HEAD'])
  })

  it('throws when git cannot read the ref, instead of reporting no changes', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(new Error('fail'), { stderr: "fatal: bad revision 'origin/main'" }))
    await expect(getChangedFiles('origin/main')).rejects.toThrow(/bad revision/)
  })
})

describe('getFileAtRef', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns contents when the path exists at the ref', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'it("t", () {})' } as never)
    await expect(getFileAtRef('src/a.test.ts', 'origin/main')).resolves.toBe('it("t", () {})')
  })

  it('returns empty when the path is absent from the ref', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(
      new Error('fail'),
      { stderr: "fatal: path 'src/new.test.ts' exists on disk, but not in 'origin/main'" },
    ))
    await expect(getFileAtRef('src/new.test.ts', 'origin/main')).resolves.toBe('')
  })

  it('throws when git itself fails', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(new Error('fail'), { stderr: 'fatal: not a git repository' }))
    await expect(getFileAtRef('src/a.test.ts', 'origin/main')).rejects.toThrow(/not a git repository/)
  })
})

describe('listWorktreeFilesContaining', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('treats exit code 1 as no matches', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' } as never)
    await expect(listWorktreeFilesContaining('matchesGoldenFile')).resolves.toEqual([])
  })

  it('returns hits', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0, stdout: 'test/a_test.dart\n', stderr: '' } as never)
    await expect(listWorktreeFilesContaining('matchesGoldenFile')).resolves.toEqual(['test/a_test.dart'])
  })

  it('throws when git grep fails', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } as never)
    await expect(listWorktreeFilesContaining('matchesGoldenFile')).rejects.toThrow(/not a git repository/)
  })

  it('strips the HEAD: prefix when searching the commit', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0, stdout: 'HEAD:test/a_test.dart\n', stderr: '' } as never)
    await expect(listWorktreeFilesContaining('matchesGoldenFile', 'HEAD')).resolves.toEqual(['test/a_test.dart'])
    expect(mockExeca).toHaveBeenCalledWith('git', ['grep', '-l', '-I', '-F', '-e', 'matchesGoldenFile', 'HEAD'], { reject: false })
  })
})

describe('auditTarget', () => {
  it('uses HEAD only when CI is set', () => {
    expect(auditTarget({ CI: 'true' })).toBe('HEAD')
    expect(auditTarget({})).toBe('worktree')
    expect(auditTarget({ CI: '' })).toBe('worktree')
  })
})

describe('readAuditedFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reads HEAD and treats an absent path as missing', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'committed' } as never)
    await expect(readAuditedFile('src/a.test.ts', 'HEAD')).resolves.toBe('committed')
    mockExeca.mockRejectedValueOnce(Object.assign(
      new Error('fail'),
      { stderr: "fatal: path 'src/a.test.ts' exists on disk, but not in 'HEAD'" },
    ))
    await expect(readAuditedFile('src/a.test.ts', 'HEAD')).resolves.toBeNull()
  })

  it('reads the working tree and treats a missing file as absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-audit-'))
    const file = join(dir, 'a.test.ts')
    writeFileSync(file, 'local')
    await expect(readAuditedFile(file, 'worktree')).resolves.toBe('local')
    rmSync(dir, { recursive: true, force: true })
    await expect(readAuditedFile(file, 'worktree')).resolves.toBeNull()
  })
})
