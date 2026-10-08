import { describe, it, expect } from 'vitest'
import { validate, type ValidateOptions } from './validator.js'
import { defaultConfig } from '../config/schema.js'
import { defineConfig } from '../config/schema.js'

function makeOptions(overrides: Partial<ValidateOptions> = {}): ValidateOptions {
  return {
    getStagedFiles: async () => [],
    getCommitMessage: async () => 'feat: something',
    getProtectedPaths: async () => [],
    // Tests must not depend on the environment they run in (CLAUDECODE, ...).
    env: {},
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

  it('blocks a commit with no agent signal, since a missing trailer proves nothing (#58)', async () => {
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
      expect(result.enforcement).toBe('block')
      expect(result.identity).toBe('unknown')
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

  it('blocks a protected test edited with no implementation file (#56)', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        getStagedFiles: async () => ['src/foo.test.ts'],
        getProtectedPaths: async () => ['src/foo.test.ts'],
        getCommitMessage: async () =>
          'test: update tests\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations).toEqual([
        { file: 'src/foo.test.ts', reason: 'protected-test-modified', phase: 'implementation' },
      ])
    }
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

describe('validate — identity (#58)', () => {
  const staged = {
    getStagedFiles: async () => ['src/foo.ts', 'src/foo.test.ts'],
    getProtectedPaths: async () => ['src/foo.test.ts'],
  }

  it('applies enforcement.unknown to a commit with no agent signal', async () => {
    const config = defineConfig({ enforcement: { unknown: 'warn' } })
    const result = await validate(config, makeOptions(staged))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.enforcement).toBe('warn')
  })

  it('allows enforcement.unknown to be turned off explicitly', async () => {
    const config = defineConfig({ enforcement: { unknown: 'off' } })
    expect(await validate(config, makeOptions(staged))).toEqual({ ok: true })
  })

  it('no longer lets enforcement.humans lower a commit with no agent signal', async () => {
    const config = defineConfig({ enforcement: { humans: 'off' } })
    const result = await validate(config, makeOptions(staged))
    expect(result.ok).toBe(false)
  })

  it('treats a configured agent environment variable as an agent signal', async () => {
    const config = defineConfig({ enforcement: { agents: 'block', unknown: 'warn' } })
    const result = await validate(config, makeOptions({ ...staged, env: { CLAUDECODE: '1' } }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.identity).toBe('agent')
      expect(result.enforcement).toBe('block')
      expect(result.matchedSignal).toBe('env:CLAUDECODE')
    }
  })

  it('ignores an agent environment variable set to an empty string', async () => {
    const config = defineConfig({ enforcement: { unknown: 'warn' } })
    const result = await validate(config, makeOptions({ ...staged, env: { CLAUDECODE: '' } }))
    if (!result.ok) expect(result.identity).toBe('unknown')
  })

  it('reads agent environment variables from config', async () => {
    const config = defineConfig({ agentEnvVars: ['MY_AGENT'], enforcement: { unknown: 'warn' } })
    const result = await validate(config, makeOptions({ ...staged, env: { MY_AGENT: '1' } }))
    if (!result.ok) expect(result.identity).toBe('agent')
  })

  it('still reports a matched trailer as the agent signal', async () => {
    const result = await validate(
      defaultConfig,
      makeOptions({
        ...staged,
        getCommitMessage: async () => 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    )
    if (!result.ok) {
      expect(result.identity).toBe('agent')
      expect(result.matchedSignal).toBe('trailer:Co-Authored-By: Claude')
    }
  })
})
