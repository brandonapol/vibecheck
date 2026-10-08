import { execa } from 'execa'
import { describe, it, expect } from 'vitest'
import { constants } from 'node:fs'
import { accessSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkMutationThresholds, type MutationConfig } from '../analyzers/mutation.js'
import { defaultConfig } from '../config/schema.js'
import { runMutationTest } from './dart-mutation.js'

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/dart')

function onPath(name: string): boolean {
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name]
  return (process.env.PATH ?? '').split(delimiter).some(dir => {
    if (!dir) return false
    return names.some(file => {
      try {
        accessSync(join(dir, file), constants.X_OK)
        return true
      } catch {
        return false
      }
    })
  })
}

const hasDart = onPath('dart')

function scoreOf(fileScores: Record<string, number>, suffix: string): number {
  const entry = Object.entries(fileScores).find(([file]) => file.replaceAll('\\', '/').endsWith(suffix))
  if (!entry) throw new Error(`no score for ${suffix}; files: ${Object.keys(fileScores).join(', ') || '(none)'}`)
  return entry[1]
}

describe.skipIf(!hasDart)(hasDart ? 'mutation_test integration' : 'mutation_test integration (skipped: dart not on PATH)', () => {
  it('kills mutants in add.dart and lets weak.dart fail the per-file threshold', async () => {
    const env = { ...process.env }
    delete env.CI
    delete env.GITHUB_BASE_REF
    // The first dart test also resolves packages. Do that before mutation_test
    // starts its own timed command.
    await execa('dart', ['pub', 'get'], { cwd: fixture })
    const report = await runMutationTest(
      {
        include: ['lib/**/*.dart'],
        exclude: [],
        protectedBranch: 'main',
        mutation: defaultConfig.mutation,
      },
      fixture,
      env,
    )
    expect(scoreOf(report.fileScores, 'lib/add.dart')).toBeGreaterThanOrEqual(60)
    expect(scoreOf(report.fileScores, 'lib/weak.dart')).toBeLessThan(60)
    expect(report.survivingMutants.some(mutant => mutant.file.replaceAll('\\', '/').endsWith('lib/weak.dart'))).toBe(
      true,
    )

    const config: MutationConfig = { ...defaultConfig.mutation, threshold: 0, perFileThreshold: 60 }
    const result = checkMutationThresholds(report, config)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.violations.some(
          violation => violation.type === 'file-mutation-score-below-threshold' && violation.file.endsWith('lib/weak.dart'),
        ),
      ).toBe(true)
    }
  }, 300_000)
})
