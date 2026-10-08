import { describe, expect, it } from 'vitest'
import { defineConfig } from '../config/schema.js'
import { findAuditHits, type AuditCommit } from './audit.js'

const agent = 'edit\n\nCo-Authored-By: Claude <noreply@anthropic.com>'

function commit(files: AuditCommit['files']): AuditCommit {
  return { sha: 'abcdef1234567890abcdef1234567890abcdef12', message: agent, files }
}

describe('audit language patterns', () => {
  it('reports an agent edit of a test the language claims', () => {
    const config = defineConfig({ languages: { go: { testPatterns: ['**/*.gittest'] } } })
    const hits = findAuditHits([
      commit([{ status: 'M', path: 'pkg/add.gittest' }]),
    ], config)
    expect(hits.map(hit => hit.files)).toEqual([['pkg/add.gittest']])
  })
})
