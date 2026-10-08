import { describe, expect, it } from 'vitest'
import { makeStubAdapter } from '../../test/__tests__/stub-adapter.js'
import { detectAddedTestFile } from './semantic-diff.js'

const adapter = makeStubAdapter()

function rejectingEmpty() {
  return makeStubAdapter({
    extractTests: async (source, path) => {
      if (source.trim() === '') throw new Error('must not parse an empty file')
      return adapter.extractTests(source, path)
    },
  })
}

describe('detectAddedTestFile', () => {
  it('flags a new file whose only assertions are weak', async () => {
    const violations = await detectAddedTestFile('test weak\nassert loose 1', 'a.stub', adapter)
    expect(violations.map(violation => violation.pattern)).toEqual(['weak-new-test'])
  })

  it('accepts a new file with a strong assertion', async () => {
    const violations = await detectAddedTestFile('test strong\nassert exact 1', 'a.stub', adapter)
    expect(violations).toEqual([])
  })

  it('flags a tautology and a neutralized assertion without parsing an empty before', async () => {
    const parsed = makeStubAdapter({
      extractTests: async source => {
        if (source.trim() === '') throw new Error('must not parse an empty file')
        const tests = await adapter.extractTests(source)
        tests[0].assertions[0].tautological = true
        tests[0].assertions[0].conditional = true
        return tests
      },
    })
    const violations = await detectAddedTestFile('test odd\nassert loose 1', 'a.stub', parsed)
    expect(violations.map(violation => violation.pattern)).toEqual([
      'tautological-assertion',
      'assertion-neutralized',
      'weak-new-test',
    ])
  })

  it('does not parse the missing before side', async () => {
    const violations = await detectAddedTestFile('test strong\nassert exact 1', 'a.stub', rejectingEmpty())
    expect(violations).toEqual([])
  })
})
