import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getChangedFiles, getFileAtRef, listWorktreeFilesContaining } from './worktree.js'

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
})
