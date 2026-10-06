import { describe, it, expect } from 'vitest'
import { detectWeakeningInDiff, detectWeakeningWithAdapter } from './semantic-diff.js'
import { typescriptAdapter } from '../languages/typescript.js'
import { makeStubAdapter } from '../../test/__tests__/stub-adapter.js'

const stub = makeStubAdapter()

describe('detectWeakeningWithAdapter — typescript', () => {
  const before = `
describe('sum', () => {
  it('adds', () => { expect(sum(1, 2)).toBe(3) })
  it('subtracts', () => { expect(sub(3, 1)).toBe(2) })
})`
  const after = `
describe('sum', () => {
  it('adds', () => { expect(sum(1, 2)).toBeDefined() })
})`

  it('matches the synchronous TypeScript entry point', async () => {
    expect(await detectWeakeningWithAdapter(before, after, 'src/sum.test.ts', typescriptAdapter)).toEqual(
      detectWeakeningInDiff(before, after, 'src/sum.test.ts'),
    )
  })
})

describe('detectWeakeningWithAdapter — another language', () => {
  it('reports a deleted test', async () => {
    const violations = await detectWeakeningWithAdapter(
      'test keep\nassert exact 1\ntest drop\nassert exact 2',
      'test keep\nassert exact 1',
      'a.stub',
      stub,
    )
    expect(violations).toEqual([{ file: 'a.stub', pattern: 'test-deletion', detail: 'Test "drop" was deleted' }])
  })

  it('ranks matchers with the adapter strength table', async () => {
    const violations = await detectWeakeningWithAdapter('test t\nassert exact 1', 'test t\nassert loose 1', 'a.stub', stub)
    expect(violations.map(v => v.pattern)).toContain('precision-reduction')
  })

  it('does not flag a matcher the adapter ranks as equally strong', async () => {
    const equal = makeStubAdapter({ assertionStrength: () => 7 })
    const violations = await detectWeakeningWithAdapter('test t\nassert exact 1', 'test t\nassert loose 1', 'a.stub', equal)
    expect(violations.map(v => v.pattern)).not.toContain('precision-reduction')
  })

  it('reports a skip added to an existing test', async () => {
    const violations = await detectWeakeningWithAdapter('test t\nassert exact 1', 'test t\nskip\nassert exact 1', 'a.stub', stub)
    expect(violations.map(v => v.pattern)).toEqual(['skip-addition'])
  })

  it('flags a new test that only uses weak matchers by the adapter table', async () => {
    const violations = await detectWeakeningWithAdapter('', 'test t\nassert loose', 'a.stub', stub)
    expect(violations.map(v => v.pattern)).toEqual(['weak-new-test'])
  })

  it('propagates an extraction failure instead of reporting a clean diff', async () => {
    const broken = makeStubAdapter({ extractTests: async () => { throw new Error('helper not found') } })
    await expect(detectWeakeningWithAdapter('test t', 'test t', 'a.stub', broken)).rejects.toThrow('helper not found')
  })
})
