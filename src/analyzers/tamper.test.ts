import { describe, it, expect } from 'vitest'
import { detectTamper } from './tamper.js'

describe('detectTamper', () => {
  it('fails when the pre-commit hook is deleted or rewritten', () => {
    const deleted = detectTamper([{ file: '.husky/pre-commit', before: 'npx vibecheck check --hook\n', after: '' }])
    expect(deleted).toEqual([
      expect.objectContaining({ kind: 'hook-drift', blocking: true, detail: expect.stringContaining('deleted') }),
    ])

    const rewritten = detectTamper([{ file: 'hooks/pre-commit', before: 'npx vibecheck check --hook\n', after: 'exit 0\n' }])
    expect(rewritten[0].kind).toBe('hook-drift')
    expect(rewritten[0].blocking).toBe(true)
  })

  it('does not flag a hook that was added', () => {
    expect(detectTamper([{ file: '.husky/pre-commit', before: '', after: 'npx vibecheck check --hook\n' }])).toEqual([])
  })

  it('flags a new Stryker disable comment and ignores an unchanged one', () => {
    const added = detectTamper([{
      file: 'src/calc.ts',
      before: 'return a + b\n',
      after: 'return a + b // Stryker disable next-line\n',
    }])
    expect(added[0]).toMatchObject({ kind: 'stryker-disable', blocking: true })

    const same = detectTamper([{
      file: 'src/calc.ts',
      before: '// Stryker disable\nreturn a + b\n',
      after: 'return a + b\n// Stryker disable\n',
    }])
    expect(same).toEqual([])
  })

  it('flags a narrowed vitest include and an added exclude', () => {
    const before = 'export default { test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"] } }\n'
    const after = 'export default { test: { include: ["src/**/*.test.ts"], exclude: ["src/slow.test.ts"] } }\n'
    const violations = detectTamper([{ file: 'vitest.config.ts', before, after }])
    expect(violations.map(v => v.kind)).toEqual(['test-runner-drift'])
    expect(violations[0].blocking).toBe(true)
    expect(violations[0].detail).toContain('test/**/*.test.ts')
    expect(violations[0].detail).toContain('src/slow.test.ts')
  })

  it('reports a workflow edit without failing the check', () => {
    const violations = detectTamper([{
      file: '.github/workflows/vibecheck.yml',
      before: 'run: npx vibecheck check\n',
      after: 'run: npx vibecheck check --threshold 0\n',
    }])
    expect(violations).toEqual([
      expect.objectContaining({ kind: 'workflow-drift', blocking: false }),
    ])
  })
})
