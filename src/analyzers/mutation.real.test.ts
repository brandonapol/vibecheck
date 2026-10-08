import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { accessSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../config/schema.js'
import { runMutationAnalysis } from './mutation.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fixture = join(repoRoot, 'test/fixtures/stryker')
const binName = process.platform === 'win32' ? 'stryker.cmd' : 'stryker'
const strykerBin = join(fixture, 'node_modules', '.bin', binName)

function hasStryker(): boolean {
  try {
    accessSync(strykerBin, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Stryker 10 refuses to start below Node 22. A binary that cannot run is skipped, not failed. */
function strykerRuns(): boolean {
  if (!hasStryker()) return false
  try {
    execFileSync(strykerBin, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('stryker is not a vibecheck dependency', () => {
  it('keeps @stryker-mutator out of package.json', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const names = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    })
    expect(names.filter(name => name.includes('stryker'))).toEqual([])
  })
})

const strykerReady = strykerRuns()

describe.skipIf(!strykerReady)(
  strykerReady
    ? 'stryker local binary'
    : 'stryker local binary (skipped: binary missing, or this Node is too old to start it)',
  () => {
    let poison: string | undefined
    const originalPath = process.env.PATH

    afterEach(() => {
      process.env.PATH = originalPath
      if (poison) rmSync(poison, { recursive: true, force: true })
      poison = undefined
    })

    it('runs node_modules/.bin/stryker and does not call npx', async () => {
      poison = mkdtempSync(join(tmpdir(), 'vibecheck-npx-'))
      const npx = join(poison, process.platform === 'win32' ? 'npx.cmd' : 'npx')
      writeFileSync(
        npx,
        process.platform === 'win32'
          ? '@echo off\r\necho npx stryker is forbidden 1>&2\r\nexit /b 97\r\n'
          : '#!/bin/sh\necho "npx stryker is forbidden" >&2\nexit 97\n',
      )
      chmodSync(npx, 0o755)
      process.env.PATH = `${poison}${delimiter}${originalPath ?? ''}`

      const report = await runMutationAnalysis(
        { ...defaultConfig.mutation, threshold: 0, perFileThreshold: 0 },
        fixture,
      )

      expect(report.total).toBeGreaterThan(0)
      expect(report.killed).toBeGreaterThan(0)
      expect(Object.keys(report.fileScores).some(file => file.replaceAll('\\', '/').endsWith('src/add.ts'))).toBe(true)
    }, 180_000)
  },
)
