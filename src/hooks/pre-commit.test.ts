import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { classifyStaged, runPreCommit } from './pre-commit.js'
import { defaultConfig, defineConfig } from '../config/schema.js'

const patterns = defaultConfig.testPatterns

describe('classifyStaged', () => {
  it('separates tests, implementation, and config', () => {
    expect(classifyStaged([
      'src/foo.test.ts',
      'src/bar.spec.ts',
      'src/__tests__/foo.ts',
      'src/foo.ts',
      'vibecheck.config.ts',
      'README.md',
      'vitest.config.ts',
      'tsup.config.ts',
    ], patterns)).toEqual({
      tests: ['src/foo.test.ts', 'src/bar.spec.ts', 'src/__tests__/foo.ts'],
      impl: ['src/foo.ts'],
      config: ['vibecheck.config.ts'],
    })
  })
})

describe('runPreCommit', () => {
  const env = {}

  it('allows tests alone and implementation alone', async () => {
    const tests = await runPreCommit(defaultConfig, {
      staged: ['src/foo.test.ts'], commitMessage: '', env, protectedPaths: [],
    })
    const impl = await runPreCommit(defaultConfig, {
      staged: ['src/foo.ts'], commitMessage: '', env, protectedPaths: [],
    })
    expect(tests).toEqual({ exitCode: 0, message: '' })
    expect(impl).toEqual({ exitCode: 0, message: '' })
  })

  it('blocks a mixed test and implementation commit and names the files', async () => {
    const result = await runPreCommit(defaultConfig, {
      staged: ['src/core/resolver.ts', 'src/core/resolver.test.ts'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    expect(result.exitCode).toBe(1)
    expect(result.message).toContain('Two-phase commit violation')
    expect(result.message).toContain('src/core/resolver.ts')
    expect(result.message).toContain('src/core/resolver.test.ts')
    expect(result.message).toContain('enforcement block')
    expect(result.message).toContain('unknown')
  })

  it('blocks config edited next to implementation, and allows it next to tests', async () => {
    const mixed = await runPreCommit(defaultConfig, {
      staged: ['src/foo.ts', 'vibecheck.config.ts'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    const withTests = await runPreCommit(defaultConfig, {
      staged: ['src/foo.test.ts', 'vibecheck.config.ts'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    expect(mixed.exitCode).toBe(1)
    expect(mixed.message).toContain('Config protection violation')
    expect(withTests.exitCode).toBe(0)
  })

  it('blocks a protected test edited with no implementation file', async () => {
    const result = await runPreCommit(defaultConfig, {
      staged: ['src/foo.test.ts'],
      commitMessage: 'test: tweak\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      env,
      protectedPaths: ['src/foo.test.ts'],
    })
    expect(result.exitCode).toBe(1)
    expect(result.message).toContain('Protected test modified')
    expect(result.message).toContain('src/foo.test.ts')
    expect(result.message).toContain('agent')
  })

  it('warns and allows the commit when enforcement is warn', async () => {
    const config = defineConfig({ enforcement: { agents: 'warn', unknown: 'warn' } })
    const result = await runPreCommit(config, {
      staged: ['src/foo.ts', 'src/foo.test.ts'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    expect(result.exitCode).toBe(0)
    expect(result.message).toContain('Two-phase commit violation')
    expect(result.message).toContain('enforcement warn')
    expect(result.message).toContain('commit allowed')
  })

  it('skips the check when enforcement is off', async () => {
    const config = defineConfig({ enforcement: { agents: 'off', unknown: 'off' } })
    const result = await runPreCommit(config, {
      staged: ['src/foo.ts', 'src/foo.test.ts'],
      commitMessage: '',
      env: { CLAUDECODE: '1' },
      protectedPaths: ['src/foo.test.ts'],
    })
    expect(result).toEqual({ exitCode: 0, message: '' })
  })

  it('allows docs next to tests, and an empty index', async () => {
    const docs = await runPreCommit(defaultConfig, {
      staged: ['src/foo.test.ts', 'README.md'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    const empty = await runPreCommit(defaultConfig, {
      staged: [], commitMessage: '', env, protectedPaths: [],
    })
    expect(docs.exitCode).toBe(0)
    expect(empty.exitCode).toBe(0)
  })
})

describe('hooks/pre-commit', () => {
  it('is a wrapper around vibecheck check --hook', () => {
    const script = readFileSync(new URL('../../hooks/pre-commit', import.meta.url), 'utf-8')
    expect(script).toContain('vibecheck check --hook')
    expect(script).not.toContain('Two-phase commit violation')
  })
})
