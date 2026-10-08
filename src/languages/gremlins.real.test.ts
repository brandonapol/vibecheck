import { describe, it, expect } from 'vitest'
import { constants } from 'node:fs'
import { accessSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkMutationThresholds, type MutationConfig } from '../analyzers/mutation.js'
import { defaultConfig } from '../config/schema.js'
import { runGremlinsMutation } from './gremlins.js'

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/go')

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

const hasGo = onPath('go')
const hasGremlins = onPath('gremlins')
const missing = [!hasGo ? 'go' : '', !hasGremlins ? 'gremlins' : ''].filter(Boolean).join(' and ')

function scoreOf(fileScores: Record<string, number>, suffix: string): number {
  const entry = Object.entries(fileScores).find(([file]) => file.replaceAll('\\', '/').endsWith(suffix))
  if (!entry) throw new Error(`no score for ${suffix}; files: ${Object.keys(fileScores).join(', ') || '(none)'}`)
  return entry[1]
}

describe.skipIf(!hasGo || !hasGremlins)(
  missing ? `gremlins integration (skipped: ${missing} not on PATH)` : 'gremlins integration',
  () => {
    it('kills mutants in add.go and lets weak.go fail the per-file threshold', async () => {
      const env = { ...process.env }
      delete env.CI
      delete env.GITHUB_BASE_REF
      const report = await runGremlinsMutation({
        include: ['**/*.go'],
        exclude: [],
        protectedBranch: 'main',
        mutation: defaultConfig.mutation,
      }, fixture, env)

      expect(scoreOf(report.fileScores, 'add.go')).toBeGreaterThanOrEqual(60)
      expect(scoreOf(report.fileScores, 'weak.go')).toBeLessThan(60)
      expect(report.survivingMutants.some(mutant => mutant.file.replaceAll('\\', '/').endsWith('weak.go'))).toBe(true)

      const config: MutationConfig = { ...defaultConfig.mutation, threshold: 0, perFileThreshold: 60 }
      const result = checkMutationThresholds(report, config)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.violations.some(violation =>
          violation.type === 'file-mutation-score-below-threshold' && violation.file.endsWith('weak.go'),
        )).toBe(true)
      }
    }, 120_000)
  },
)
