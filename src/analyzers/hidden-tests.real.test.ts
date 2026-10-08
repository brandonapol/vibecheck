import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '../config/schema.js'
import { runHiddenTests } from './hidden-tests.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

describe('runHiddenTests — real vitest', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('scores the hidden directory and does not run the project include', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-hidden-real-'))
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
    symlinkSync(join(repo, 'node_modules', 'vitest'), join(dir, 'node_modules', 'vitest'))
    symlinkSync(join(repo, 'node_modules', '.bin', 'vitest'), join(dir, 'node_modules', '.bin', 'vitest'))

    writeFileSync(join(dir, 'vitest.config.ts'), [
      "import { defineConfig } from 'vitest/config'",
      'export default defineConfig({ test: { include: ["src/**/*.test.ts"] } })',
      '',
    ].join('\n'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'decoy.test.ts'), [
      "import { expect, it } from 'vitest'",
      "it('decoy', () => { expect(1).toBe(2) })",
      '',
    ].join('\n'))
    mkdirSync(join(dir, '.vibecheck-hidden'))
    writeFileSync(join(dir, '.vibecheck-hidden', 'holdout.test.ts'), [
      "import { expect, it } from 'vitest'",
      "it('passes', () => { expect(1).toBe(1) })",
      "it('fails', () => { expect(1).toBe(2) })",
      '',
    ].join('\n'))

    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'directory', path: '.vibecheck-hidden' },
    })
    const report = await runHiddenTests(config, dir, process.env)
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.passRate).toBe(50)
    expect(report.failures.join('\n')).toContain('fails')
    expect(report.failures.join('\n')).not.toContain('decoy')
  }, 20000)
})
