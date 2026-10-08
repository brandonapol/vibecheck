import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '../config/schema.js'
import { hiddenTestsDir, scoreHiddenReport, vitestConfigSource } from './hidden-tests.js'

describe('scoreHiddenReport', () => {
  it('counts only passed tests, and treats skip and todo as not passed', () => {
    const report = scoreHiddenReport({
      testResults: [
        {
          name: 'a.test.ts',
          status: 'failed',
          assertionResults: [
            { status: 'passed', fullName: 'a passes' },
            { status: 'failed', fullName: 'a fails' },
            { status: 'skipped', title: 'a skipped' },
            { status: 'todo', title: 'a todo' },
          ],
        },
      ],
    })
    expect(report).toMatchObject({ passed: 1, failed: 1, skipped: 2, total: 4, passRate: 25 })
    expect(report.failures).toEqual(['a fails'])
  })

  it('counts a file that failed to load as a failure', () => {
    const report = scoreHiddenReport({
      testResults: [{ name: 'broken.test.ts', status: 'failed', message: 'transform error', assertionResults: [] }],
    })
    expect(report).toMatchObject({ passed: 0, failed: 1, total: 1, passRate: 0 })
    expect(report.failures).toEqual(['transform error'])
  })

  it('scores an empty suite as 0, not 100', () => {
    expect(scoreHiddenReport({ testResults: [] })).toMatchObject({ total: 0, passRate: 0 })
  })

  it('rejects a report that is not vitest json', () => {
    expect(() => scoreHiddenReport({ numPassedTests: 1 })).toThrow(/unparsable/)
    expect(() => scoreHiddenReport(null)).toThrow(/unparsable/)
  })
})

describe('hiddenTestsDir', () => {
  it('rejects a directory outside the project', () => {
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'directory', path: '../holdout' },
    })
    expect(() => hiddenTestsDir(config, '/proj')).toThrow(/inside the project/)
  })

  it('places a cloned repo inside .vibecheck-cache', () => {
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'repo', url: 'git@github.com:org/hidden.git' },
    })
    expect(hiddenTestsDir(config, '/proj')).toBe('/proj/.vibecheck-cache/hidden-tests')
  })
})

describe('vitestConfigSource', () => {
  it('replaces include and keeps the project root when a vitest config exists', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vibecheck-hidden-cfg-'))
    try {
      writeFileSync(join(cwd, 'vitest.config.ts'), 'export default { test: { include: ["src/**/*.test.ts"] } }\n')
      const source = vitestConfigSource(cwd, join(cwd, '.vibecheck-hidden'))
      expect(source).toContain('import userConfig from')
      expect(source).toContain('.vibecheck-hidden/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}')
      expect(source).toContain(`root: ${JSON.stringify(cwd)}`)
      expect(source).toContain('passWithNoTests: false')
      expect(source).not.toContain('src/**/*.test.ts')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
