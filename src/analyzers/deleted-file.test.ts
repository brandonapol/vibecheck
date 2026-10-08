import { describe, expect, it } from 'vitest'
import { makeStubAdapter } from '../../test/__tests__/stub-adapter.js'
import { detectWeakeningWithAdapter, semanticDiffSides } from './semantic-diff.js'

const before = 'test keeps\nassert exact 1'

function adapterThatRejectsEmpty() {
  const base = makeStubAdapter()
  return makeStubAdapter({
    extractTests: async (source, path) => {
      if (source.trim() === '') throw new Error('must not parse a deleted file')
      return base.extractTests(source, path)
    },
    extractSetup: async (source, path) => {
      if (source.trim() === '') throw new Error('must not parse a deleted file')
      return base.extractSetup(source, path)
    },
  })
}

describe('deleted test file', () => {
  it('reports every test without parsing the empty side', async () => {
    const violations = await detectWeakeningWithAdapter(before, '', 'a.stub', adapterThatRejectsEmpty())
    expect(violations).toEqual([
      { file: 'a.stub', pattern: 'test-deletion', detail: 'Test "keeps" was deleted' },
    ])
  })

  it('treats a whitespace-only after side as a deletion', async () => {
    const violations = await detectWeakeningWithAdapter(before, ' \n\t', 'a.stub', adapterThatRejectsEmpty())
    expect(violations.map(violation => violation.pattern)).toEqual(['test-deletion'])
  })
})

describe('semanticDiffSides', () => {
  it('skips a new file', () => {
    expect(semanticDiffSides('', 'test added\nassert exact 1')).toBeNull()
  })

  it('compares a deleted file', () => {
    expect(semanticDiffSides(before, '')).toEqual({ before, after: '' })
  })

  it('compares a file that exists on both sides', () => {
    expect(semanticDiffSides(before, before)).toEqual({ before, after: before })
  })
})
