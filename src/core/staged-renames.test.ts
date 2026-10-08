import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { getStagedFiles } from './resolver.js'

const mockExeca = vi.mocked(execa)

describe('getStagedFiles renames', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the old path of a staged rename when asked', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'src/old.test.ts\nsrc/new.test.ts\n' } as never)
    await expect(getStagedFiles({ noRenames: true })).resolves.toEqual([
      'src/old.test.ts',
      'src/new.test.ts',
    ])
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--cached', '--name-only', '--no-renames'])
  })

  it('is what the installed hook asks for', () => {
    const source = readFileSync(new URL('../hooks/pre-commit.ts', import.meta.url), 'utf-8')
    expect(source.includes('noRenames: true')).toBe(true)
  })
})
