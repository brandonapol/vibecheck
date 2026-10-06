import { describe, it, expect } from 'vitest'
import { detectAgent } from './detector.js'

const trailers = ['Co-Authored-By: Claude']

describe('detectAgent', () => {
  it('finds a trailer', () => {
    expect(detectAgent({ commitMessage: 'x\n\nCo-Authored-By: Claude <a@b>', trailers, env: {}, envVars: [] })).toEqual({
      identity: 'agent',
      matchedSignal: 'trailer:Co-Authored-By: Claude',
    })
  })

  it('finds a non-empty environment variable', () => {
    expect(detectAgent({ commitMessage: '', trailers, env: { CLAUDECODE: '1' }, envVars: ['CLAUDECODE'] })).toEqual({
      identity: 'agent',
      matchedSignal: 'env:CLAUDECODE',
    })
  })

  it('reports unknown, never human, when there is no signal', () => {
    expect(detectAgent({ commitMessage: 'feat: x', trailers, env: { HOME: '/h' }, envVars: ['CLAUDECODE'] })).toEqual({
      identity: 'unknown',
      matchedSignal: null,
    })
  })
})
