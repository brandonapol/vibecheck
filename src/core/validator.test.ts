import { describe, it, expect } from 'vitest'
import { validate, type ValidateOptions } from './validator.js'
import { defaultConfig } from '../config/schema.js'
import { defineConfig } from '../config/schema.js'

function makeOptions(overrides: Partial<ValidateOptions> = {}): ValidateOptions {
  return {
    getStagedFiles: async () => [],
    getCommitMessage: async () => 'feat: something',
    getProtectedPaths: async () => [],
    ...overrides,
  }
}

describe('validate', () => {
  it('returns ok when no files are staged', async () => {
    const result = await validate(defaultConfig, makeOptions())
    expect(result).toEqual({ ok: true })
  })

  it('returns ok when only implementation files are staged (no protected tests)', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => ['src/foo.ts'],
        getProtectedPaths: async () => [],
      }),
    )
    expect(result).toEqual({ ok: true })
  })

  it('blocks agent commit that modifies protected test files', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => ['src/foo.ts', 'src/foo.test.ts'],
        getProtectedPaths: async () => ['src/foo.test.ts'],
        getCommitMessage: async () =>
          'feat: add foo\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].file).toBe('src/foo.test.ts')
      expect(result.violations[0].reason).toBe('protected-test-modified')
      expect(result.enforcement).toBe('block')
    }
  })

  it('warns for human commit that modifies protected test files', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => ['src/foo.ts', 'src/foo.test.ts'],
        getProtectedPaths: async () => ['src/foo.test.ts'],
        getCommitMessage: async () => 'feat: add foo by a human',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations).toHaveLength(1)
      expect(result.enforcement).toBe('warn')
    }
  })

  it('returns ok when enforcement is off', async () => {
    const config = defineConfig({
      enforcement: { agents: 'off', humans: 'off' },
    })
    const result = await validate(
      config,
      makeOptions({
        getStagedFiles: async () => ['src/foo.test.ts'],
        getProtectedPaths: async () => ['src/foo.test.ts'],
        getCommitMessage: async () =>
          'feat: yolo\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    )
    expect(result).toEqual({ ok: true })
  })

  it('detects multiple protected file violations', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => [
          'src/a.test.ts',
          'src/b.test.ts',
          'src/impl.ts',
        ],
        getProtectedPaths: async () => ['src/a.test.ts', 'src/b.test.ts'],
        getCommitMessage: async () =>
          'feat: update\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations).toHaveLength(2)
    }
  })

  it('returns ok when protected test files are staged alone (no impl)', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => ['src/foo.test.ts'],
        getProtectedPaths: async () => ['src/foo.test.ts'],
        getCommitMessage: async () =>
          'test: update tests\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    )
    // Protected tests modified alone is allowed — the pre-commit hook
    // handles the two-phase check. The validator checks protected tests
    // modified alongside implementation.
    expect(result).toEqual({ ok: true })
  })

  it('identifies which trailer matched for agent commits', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => ['src/foo.ts', 'src/foo.test.ts'],
        getProtectedPaths: async () => ['src/foo.test.ts'],
        getCommitMessage: async () =>
          'feat: stuff\n\nCo-Authored-By: GitHub Copilot <copilot@github.com>',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.matchedTrailer).toBe('Co-Authored-By: GitHub Copilot')
    }
  })
})
