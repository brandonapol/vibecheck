import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isAgentCommit, getCommitMessage } from './detector.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'

const mockExeca = vi.mocked(execa)

describe('getCommitMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the most recent commit message', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'feat: add login\n\nCo-Authored-By: Claude' } as any)
    const msg = await getCommitMessage()
    expect(msg).toBe('feat: add login\n\nCo-Authored-By: Claude')
    expect(mockExeca).toHaveBeenCalledWith('git', ['log', '-1', '--format=%B'])
  })

  it('returns empty string when there is no commit history', async () => {
    mockExeca.mockRejectedValueOnce(new Error('fatal: bad default revision'))
    const msg = await getCommitMessage()
    expect(msg).toBe('')
  })
})

describe('isAgentCommit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when commit message contains a matching trailer', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'feat: add payments\n\nCo-Authored-By: Claude',
    } as any)

    const result = await isAgentCommit(['Co-Authored-By: Claude'])
    expect(result).toBe(true)
  })

  it('matches trailers case-insensitively', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'fix: typo\n\nco-authored-by: claude',
    } as any)

    const result = await isAgentCommit(['Co-Authored-By: Claude'])
    expect(result).toBe(true)
  })

  it('returns false when no trailer matches', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'feat: manual change by human',
    } as any)

    const result = await isAgentCommit(['Co-Authored-By: Claude', 'Co-Authored-By: GitHub Copilot'])
    expect(result).toBe(false)
  })

  it('returns false on empty commit history', async () => {
    mockExeca.mockRejectedValueOnce(new Error('fatal: bad default revision'))

    const result = await isAgentCommit(['Co-Authored-By: Claude'])
    expect(result).toBe(false)
  })

  it('matches any of multiple configured trailers', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'refactor: cleanup\n\nCo-Authored-By: GitHub Copilot',
    } as any)

    const result = await isAgentCommit([
      'Co-Authored-By: Claude',
      'Co-Authored-By: GitHub Copilot',
      'Co-Authored-By: cursor',
    ])
    expect(result).toBe(true)
  })

  it('does not match partial trailer strings', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'feat: add Claude integration',
    } as any)

    const result = await isAgentCommit(['Co-Authored-By: Claude'])
    expect(result).toBe(false)
  })

  it('accepts a custom commit message instead of reading from git', async () => {
    const result = await isAgentCommit(
      ['Co-Authored-By: Claude'],
      'feat: something\n\nCo-Authored-By: Claude'
    )
    expect(result).toBe(true)
    expect(mockExeca).not.toHaveBeenCalled()
  })
})
