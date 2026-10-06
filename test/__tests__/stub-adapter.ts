import type { ExtractedTest } from '../../src/analyzers/test-ast.js'
import type { LanguageAdapter } from '../../src/languages/types.js'

const STUB_STRENGTH: Record<string, number> = { exact: 10, close: 8, loose: 2 }

/** Parses a toy test format, one directive per line:
 *  `test <name>`, `skip`, `assert <matcher> [argument]`. */
function parseStub(source: string): ExtractedTest[] {
  const tests: ExtractedTest[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    const [directive, first, ...rest] = line.split(/\s+/)
    const current = tests[tests.length - 1]
    if (directive === 'test' && first) {
      tests.push({
        name: first,
        describePath: [],
        id: first,
        skipped: false,
        assertions: [],
        suspicious: [],
        bodyKey: '',
      })
    } else if (directive === 'skip' && current) {
      current.skipped = true
    } else if (directive === 'assert' && current && first) {
      const argument = rest.join(' ')
      current.assertions.push({
        matcher: first,
        modifiers: [],
        tautological: false,
        conditional: false,
        hasArguments: argument !== '',
        key: `${first}(${argument})`,
        source: line,
      })
    }
  }
  return tests
}

export function makeStubAdapter(overrides: Partial<LanguageAdapter> = {}): LanguageAdapter {
  return {
    id: 'stub',
    testPatterns: ['**/*.stub'],
    sourcePatterns: ['**/*.stubsrc'],
    extractTests: async source => parseStub(source),
    extractSetup: async () => [],
    assertionStrength: matcher => STUB_STRENGTH[matcher] ?? 5,
    ...overrides,
  }
}
