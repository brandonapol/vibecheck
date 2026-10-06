import { describe, it, expect } from 'vitest'
import { typescriptAdapter } from './typescript.js'
import { extractSetup, extractTests } from '../analyzers/test-ast.js'
import { ASSERTION_STRENGTH } from '../analyzers/semantic-diff.js'
import { defaultConfig } from '../config/schema.js'

const SOURCE = `
const fixture = { total: 3 }
describe('sum', () => {
  it('adds', () => {
    expect(sum(1, 2)).toBe(3)
  })
})
`

describe('typescriptAdapter', () => {
  it('extracts tests exactly as test-ast does', async () => {
    expect(await typescriptAdapter.extractTests(SOURCE, 'src/sum.test.ts')).toEqual(extractTests(SOURCE))
  })

  it('extracts setup exactly as test-ast does', async () => {
    expect(await typescriptAdapter.extractSetup(SOURCE, 'src/sum.test.ts')).toEqual(extractSetup(SOURCE))
  })

  it('ranks known matchers by the shared strength table', () => {
    for (const [matcher, strength] of Object.entries(ASSERTION_STRENGTH)) {
      expect(typescriptAdapter.assertionStrength(matcher)).toBe(strength)
    }
  })

  it('treats a custom matcher as neutral', () => {
    expect(typescriptAdapter.assertionStrength('toBeSomethingCustom')).toBe(5)
  })

  it('defaults to the top-level test patterns and mutation include', () => {
    expect(typescriptAdapter.testPatterns).toEqual(defaultConfig.testPatterns)
    expect(typescriptAdapter.sourcePatterns).toEqual(defaultConfig.mutation.include)
  })

  it('can run mutation testing', () => {
    expect(typescriptAdapter.runMutation).toBeTypeOf('function')
  })
})
