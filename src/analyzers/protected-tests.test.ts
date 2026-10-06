import { describe, it, expect } from 'vitest'
import { checkProtectedTests } from './protected-tests.js'
import { defineConfig } from '../config/schema.js'
import type { WeakeningViolation } from './semantic-diff.js'

const config = defineConfig({
  protectedTests: {
    files: ['test/utils/error_text_test.dart', 'test/lint/**'],
    required: [{ path: 'packages/*/test/**/*_test.dart', references: ['narrowViewport', 'wideViewport'] }],
  },
})

function run(opts: {
  changedFiles: string[]
  base?: Record<string, string>
  head?: Record<string, string>
  semanticViolations?: WeakeningViolation[]
}) {
  return checkProtectedTests({
    config,
    changedFiles: opts.changedFiles,
    semanticViolations: opts.semanticViolations ?? [],
    readBase: async file => opts.base?.[file] ?? null,
    readHead: async file => opts.head?.[file] ?? null,
  })
}

const BOTH = "pumpAt(tester, narrowViewport);\npumpAt(tester, wideViewport);\n"

describe('checkProtectedTests — protected files', () => {
  it('turns any weakening in a protected file into a protected violation', async () => {
    const violations = await run({
      changedFiles: ['test/utils/error_text_test.dart'],
      semanticViolations: [
        { file: 'test/utils/error_text_test.dart', pattern: 'test-deletion', detail: 'Test "x" was deleted' },
        { file: 'test/other_test.dart', pattern: 'test-deletion', detail: 'Test "y" was deleted' },
      ],
    })
    expect(violations).toEqual([
      {
        file: 'test/utils/error_text_test.dart',
        rule: 'protected-file-weakened',
        detail: 'test-deletion: Test "x" was deleted',
      },
    ])
  })

  it('matches protected files by glob', async () => {
    const violations = await run({
      changedFiles: ['test/lint/no_raw_errors_test.dart'],
      semanticViolations: [{ file: 'test/lint/no_raw_errors_test.dart', pattern: 'skip-addition', detail: 'skipped' }],
    })
    expect(violations.map(v => v.rule)).toEqual(['protected-file-weakened'])
  })

  it('reports a protected file being deleted', async () => {
    const violations = await run({
      changedFiles: ['test/utils/error_text_test.dart'],
      base: { 'test/utils/error_text_test.dart': 'void main() {}' },
    })
    expect(violations.map(v => v.rule)).toEqual(['protected-file-deleted'])
  })

  it('ignores a protected path that is new on this branch', async () => {
    const violations = await run({
      changedFiles: ['test/lint/new_test.dart'],
      head: { 'test/lint/new_test.dart': 'void main() {}' },
    })
    expect(violations).toEqual([])
  })
})

describe('checkProtectedTests — required references', () => {
  const file = 'packages/quark_widgets/test/layout/card_test.dart'

  it('reports a required reference removed from a file that had it', async () => {
    const violations = await run({
      changedFiles: [file],
      base: { [file]: BOTH },
      head: { [file]: 'pumpAt(tester, wideViewport);\n' },
    })
    expect(violations).toEqual([
      { file, rule: 'required-reference-removed', detail: "'narrowViewport' is no longer referenced" },
    ])
  })

  it('reports every reference lost when the file is deleted', async () => {
    const violations = await run({ changedFiles: [file], base: { [file]: BOTH } })
    expect(violations.map(v => v.detail)).toEqual([
      "'narrowViewport' is no longer referenced",
      "'wideViewport' is no longer referenced",
    ])
  })

  it('matches whole identifiers only', async () => {
    const violations = await run({
      changedFiles: [file],
      base: { [file]: BOTH },
      head: { [file]: 'narrowViewportLegacy; wideViewport;' },
    })
    expect(violations.map(v => v.detail)).toEqual(["'narrowViewport' is no longer referenced"])
  })

  it('does not require references a file never had', async () => {
    const violations = await run({
      changedFiles: [file],
      base: { [file]: 'pumpAt(tester, wideViewport);' },
      head: { [file]: 'pumpAt(tester, wideViewport); // edited' },
    })
    expect(violations).toEqual([])
  })

  it('does not hold a new file to the rule', async () => {
    const violations = await run({ changedFiles: [file], head: { [file]: 'void main() {}' } })
    expect(violations).toEqual([])
  })

  it('ignores files outside the rule path', async () => {
    const violations = await run({
      changedFiles: ['test/pages/home_test.dart'],
      base: { 'test/pages/home_test.dart': BOTH },
      head: { 'test/pages/home_test.dart': '' },
    })
    expect(violations).toEqual([])
  })
})
