import { describe, expect, it } from 'vitest'
import { extractTests } from '../analyzers/test-ast.js'
import { defineConfig } from '../config/schema.js'
import { languageForFile, resolveLanguages } from './registry.js'

describe('typescript supplemental tests', () => {
  it('claims js and jsx tests when typescript is enabled', () => {
    const languages = resolveLanguages(defineConfig({}))
    expect(languageForFile('src/Button.test.tsx', languages)?.id).toBe('typescript')
    expect(languageForFile('src/form.test.js', languages)?.id).toBe('typescript')
    expect(languageForFile('src/__tests__/Button.tsx', languages)?.id).toBe('typescript')
    expect(languageForFile('src/Button.tsx', languages)).toBeNull()
  })

  it('does not claim a go test unless go is enabled', () => {
    expect(languageForFile('pkg/add_test.go', resolveLanguages(defineConfig({})))).toBeNull()
    const go = resolveLanguages(defineConfig({ languages: { go: {} } }))
    expect(languageForFile('pkg/add_test.go', go)?.id).toBe('go')
  })

  it('parses a tsx test with the typescript extractor', () => {
    const tests = extractTests([
      "import { test, expect } from 'vitest'",
      "test('shows the label', () => {",
      "  const tree = <button>Save</button>",
      "  expect(tree.type).toBe('button')",
      '})',
      '',
    ].join('\n'))
    expect(tests.map(test => test.name)).toEqual(['shows the label'])
  })
})
