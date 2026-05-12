import { describe, it, expect, vi } from 'vitest'
import { isAgentCommit, detectAgentTrailers } from './detector.js'

describe('detectAgentTrailers', () => {
  it('detects Claude Co-Authored-By trailer', () => {
    const message = `feat: add user endpoint

Co-Authored-By: Claude <noreply@anthropic.com>`
    const result = detectAgentTrailers(message, ['Co-Authored-By: Claude'])
    expect(result).toEqual({ isAgent: true, matchedTrailer: 'Co-Authored-By: Claude' })
  })

  it('detects GitHub Copilot trailer', () => {
    const message = `fix: handle null case

Co-Authored-By: GitHub Copilot <copilot@github.com>`
    const result = detectAgentTrailers(message, ['Co-Authored-By: GitHub Copilot'])
    expect(result).toEqual({ isAgent: true, matchedTrailer: 'Co-Authored-By: GitHub Copilot' })
  })

  it('matches case-insensitively', () => {
    const message = `feat: something

co-authored-by: claude <noreply@anthropic.com>`
    const result = detectAgentTrailers(message, ['Co-Authored-By: Claude'])
    expect(result).toEqual({ isAgent: true, matchedTrailer: 'Co-Authored-By: Claude' })
  })

  it('returns no match when no trailers present', () => {
    const message = 'feat: add user endpoint'
    const result = detectAgentTrailers(message, ['Co-Authored-By: Claude'])
    expect(result).toEqual({ isAgent: false, matchedTrailer: null })
  })

  it('returns no match for human-only commits', () => {
    const message = `feat: add endpoint

Co-Authored-By: Alice <alice@example.com>`
    const result = detectAgentTrailers(message, [
      'Co-Authored-By: Claude',
      'Co-Authored-By: GitHub Copilot',
    ])
    expect(result).toEqual({ isAgent: false, matchedTrailer: null })
  })

  it('matches first matching trailer when multiple configured', () => {
    const message = `feat: something

Co-Authored-By: Claude <noreply@anthropic.com>`
    const result = detectAgentTrailers(message, [
      'Co-Authored-By: GitHub Copilot',
      'Co-Authored-By: Claude',
      'Co-Authored-By: cursor',
    ])
    expect(result).toEqual({ isAgent: true, matchedTrailer: 'Co-Authored-By: Claude' })
  })

  it('handles empty trailer list', () => {
    const message = 'Co-Authored-By: Claude <noreply@anthropic.com>'
    const result = detectAgentTrailers(message, [])
    expect(result).toEqual({ isAgent: false, matchedTrailer: null })
  })

  it('handles multiline commit messages', () => {
    const message = `feat: big feature

This is a long description that spans
multiple lines and mentions Claude in the
body text but not as a trailer.

Co-Authored-By: Claude <noreply@anthropic.com>`
    const result = detectAgentTrailers(message, ['Co-Authored-By: Claude'])
    expect(result).toEqual({ isAgent: true, matchedTrailer: 'Co-Authored-By: Claude' })
  })

  it('matches partial trailer strings', () => {
    const message = `feat: something

Generated-By: cursor-agent`
    const result = detectAgentTrailers(message, ['Generated-By: cursor'])
    expect(result).toEqual({ isAgent: true, matchedTrailer: 'Generated-By: cursor' })
  })
})

describe('isAgentCommit', () => {
  it('reads the last commit message and checks for agent trailers', async () => {
    const trailers = ['Co-Authored-By: Claude']
    const commitMessage = `feat: add feature

Co-Authored-By: Claude <noreply@anthropic.com>`

    const result = await isAgentCommit(trailers, async () => commitMessage)
    expect(result.isAgent).toBe(true)
  })

  it('returns false when no agent trailer found', async () => {
    const trailers = ['Co-Authored-By: Claude']
    const commitMessage = 'feat: add feature by a human'

    const result = await isAgentCommit(trailers, async () => commitMessage)
    expect(result.isAgent).toBe(false)
  })
})
