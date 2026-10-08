import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { strykerReportPath } from './mutation.js'

describe('strykerReportPath', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('uses the Stryker 10 default when no JSON config sets a path', () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-stryker-report-'))
    expect(strykerReportPath(dir)).toBe('reports/mutation/mutation.json')
  })

  it('reads jsonReporter.fileName from stryker.config.json', () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-stryker-report-'))
    writeFileSync(join(dir, 'stryker.config.json'), JSON.stringify({
      jsonReporter: { fileName: '.stryker-output/report.json' },
    }))
    expect(strykerReportPath(dir)).toBe('.stryker-output/report.json')
  })

  it('ignores a config that is not valid JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-stryker-report-'))
    writeFileSync(join(dir, 'stryker.config.json'), 'module.exports = {}')
    expect(strykerReportPath(dir)).toBe('reports/mutation/mutation.json')
  })
})
