import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { getChangedFiles } from './worktree.js'

const mockExeca = vi.mocked(execa)

describe('getChangedFiles renames', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists both sides of a rename when asked', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'src/old.test.ts\nsrc/new.test.ts\n' } as never)
    await expect(getChangedFiles('origin/main', undefined, { noRenames: true })).resolves.toEqual([
      'src/old.test.ts',
      'src/new.test.ts',
    ])
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--name-only', '--no-renames', 'origin/main'])
  })

  it('lists both sides against a tip ref', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'src/old.test.ts\n' } as never)
    await getChangedFiles('origin/main', 'HEAD', { noRenames: true })
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--name-only', '--no-renames', 'origin/main', 'HEAD'])
  })

  it('is what vibecheck check asks for', () => {
    const bin = readFileSync(new URL('../../bin/vibecheck.ts', import.meta.url), 'utf-8')
    expect(bin.includes('noRenames: true')).toBe(true)
  })
})
