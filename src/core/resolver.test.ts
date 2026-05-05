import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getStagedFiles,
  getProtectedPaths,
  matchesPatterns,
  fileExistsInBranch,
} from './resolver.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'

const mockExeca = vi.mocked(execa)

describe('matchesPatterns', () => {
  it('matches a .test.ts file', () => {
    expect(matchesPatterns('src/core/validator.test.ts', ['**/*.test.ts'])).toBe(true)
  })

  it('matches a .spec.ts file', () => {
    expect(matchesPatterns('src/core/validator.spec.ts', ['**/*.spec.ts'])).toBe(true)
  })

  it('matches files in __tests__ directory', () => {
    expect(matchesPatterns('src/__tests__/foo.ts', ['**/__tests__/**/*.ts'])).toBe(true)
  })

  it('does not match implementation files', () => {
    expect(matchesPatterns('src/core/validator.ts', ['**/*.test.ts', '**/*.spec.ts'])).toBe(false)
  })

  it('matches against multiple patterns', () => {
    expect(matchesPatterns('src/foo.spec.ts', ['**/*.test.ts', '**/*.spec.ts'])).toBe(true)
  })

  it('does not match unrelated extensions', () => {
    expect(matchesPatterns('src/foo.ts', ['**/*.test.ts'])).toBe(false)
  })
})

describe('getStagedFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns list of staged files', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nsrc/foo.test.ts\nREADME.md',
    } as any)

    const files = await getStagedFiles()
    expect(files).toEqual(['src/foo.ts', 'src/foo.test.ts', 'README.md'])
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--cached', '--name-only'])
  })

  it('returns empty array when nothing is staged', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '' } as any)

    const files = await getStagedFiles()
    expect(files).toEqual([])
  })
})

describe('fileExistsInBranch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when file exists in the branch', async () => {
    mockExeca.mockResolvedValueOnce({} as any)

    const exists = await fileExistsInBranch('src/foo.test.ts', 'main')
    expect(exists).toBe(true)
    expect(mockExeca).toHaveBeenCalledWith('git', ['show', 'origin/main:src/foo.test.ts'])
  })

  it('returns false when file does not exist in the branch', async () => {
    mockExeca.mockRejectedValueOnce(new Error('fatal: path not found'))

    const exists = await fileExistsInBranch('src/new.test.ts', 'main')
    expect(exists).toBe(false)
  })
})

describe('getProtectedPaths', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns test files that exist in the protected branch', async () => {
    // fileExistsInBranch calls for each test file
    mockExeca
      .mockResolvedValueOnce({} as any) // src/existing.test.ts exists
      .mockRejectedValueOnce(new Error('not found')) // src/new.test.ts does not

    const result = await getProtectedPaths(
      ['src/existing.test.ts', 'src/new.test.ts', 'src/impl.ts'],
      ['**/*.test.ts'],
      'main',
    )

    expect(result).toEqual(['src/existing.test.ts'])
  })

  it('returns empty array when no staged files are tests', async () => {
    const result = await getProtectedPaths(
      ['src/foo.ts', 'src/bar.ts'],
      ['**/*.test.ts'],
      'main',
    )

    expect(result).toEqual([])
    expect(mockExeca).not.toHaveBeenCalled()
  })

  it('returns empty array when all test files are new', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'))

    const result = await getProtectedPaths(
      ['src/brand-new.test.ts'],
      ['**/*.test.ts'],
      'main',
    )

    expect(result).toEqual([])
  })

  it('handles multiple test patterns', async () => {
    mockExeca
      .mockResolvedValueOnce({} as any) // foo.test.ts exists
      .mockResolvedValueOnce({} as any) // bar.spec.ts exists

    const result = await getProtectedPaths(
      ['src/foo.test.ts', 'src/bar.spec.ts', 'src/impl.ts'],
      ['**/*.test.ts', '**/*.spec.ts'],
      'main',
    )

    expect(result).toEqual(['src/foo.test.ts', 'src/bar.spec.ts'])
  })

  it('uses the configured protected branch', async () => {
    mockExeca.mockResolvedValueOnce({} as any)

    await getProtectedPaths(
      ['src/foo.test.ts'],
      ['**/*.test.ts'],
      'develop',
    )

    expect(mockExeca).toHaveBeenCalledWith('git', ['show', 'origin/develop:src/foo.test.ts'])
  })
})
