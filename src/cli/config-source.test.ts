import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateConfigSource, readConfigAtRef, resolveCheckConfig } from './config-source.js'
import { defaultConfig, defineConfig, type Config } from '../config/schema.js'

function gitError(stderr: string): Error {
  return Object.assign(new Error('git failed'), { stderr })
}

describe('readConfigAtRef', () => {
  it('reads vibecheck.config.ts from the ref with git show', async () => {
    const git = vi.fn(async () => 'export default {}')
    expect(await readConfigAtRef('origin/main', git)).toBe('export default {}')
    expect(git).toHaveBeenCalledWith(['show', 'origin/main:vibecheck.config.ts'])
  })

  it('returns null when the ref has no config file', async () => {
    const git = async () => {
      throw gitError("fatal: path 'vibecheck.config.ts' does not exist in 'origin/main'")
    }
    expect(await readConfigAtRef('origin/main', git)).toBeNull()
  })

  it('returns null when the file exists only in the working tree', async () => {
    const git = async () => {
      throw gitError("fatal: path 'vibecheck.config.ts' exists on disk, but not in 'origin/main'")
    }
    expect(await readConfigAtRef('origin/main', git)).toBeNull()
  })

  it('fails closed when the ref cannot be read, with a hint about fetch depth', async () => {
    const git = async () => {
      throw gitError("fatal: invalid object name 'origin/main'.")
    }
    await expect(readConfigAtRef('origin/main', git)).rejects.toThrow(/fetch-depth/)
  })
})

describe('evaluateConfigSource', () => {
  it('evaluates a config module and validates it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-cfg-'))
    const config = await evaluateConfigSource('export default { mutation: { threshold: 91 } }\n', dir)
    expect(config.mutation.threshold).toBe(91)
    expect(config.protectedBranch).toBe('main')
  })

  it('removes its temporary file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-cfg-'))
    writeFileSync(join(dir, 'keep.txt'), '')
    await evaluateConfigSource('export default {}\n', dir)
    expect(readdirSync(dir)).toEqual(['keep.txt'])
  })

  it('rejects an invalid config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibecheck-cfg-'))
    await expect(evaluateConfigSource('export default { threshold: 500 }\n', dir)).rejects.toThrow()
  })
})

describe('resolveCheckConfig', () => {
  const base = defineConfig({ mutation: { threshold: 80 } })

  function resolve(head: Config, opts: { env?: Record<string, string>; baseRef?: string; baseConfig?: Config | null } = {}) {
    const readAtRef = vi.fn(async () => (opts.baseConfig === null ? null : 'base source'))
    const evaluate = vi.fn(async () => opts.baseConfig ?? base)
    return {
      readAtRef,
      result: resolveCheckConfig({ head, env: opts.env ?? {}, baseRef: opts.baseRef, readAtRef, evaluate }),
    }
  }

  it('trusts the working-tree config outside CI', async () => {
    const head = defineConfig({ mutation: { threshold: 10 } })
    const { result, readAtRef } = resolve(head)
    const resolved = await result
    expect(resolved.mode).toBe('head')
    expect(resolved.config).toBe(head)
    expect(resolved.configViolations).toEqual([])
    expect(readAtRef).not.toHaveBeenCalled()
  })

  it('in CI, checks against the base config and reports the weakening', async () => {
    const head = defineConfig({ mutation: { threshold: 10 } })
    const resolved = await resolve(head, { env: { CI: 'true' } }).result
    expect(resolved.mode).toBe('base')
    expect(resolved.baseRef).toBe('origin/main')
    expect(resolved.config.mutation.threshold).toBe(80)
    expect(resolved.configViolations.map(v => v.field)).toEqual(['mutation.threshold'])
  })

  it('reports an analyzer disabled on the head branch', async () => {
    const head = defineConfig({ semanticDiff: { enabled: false } })
    const resolved = await resolve(head, { env: { CI: 'true' } }).result
    expect(resolved.config.semanticDiff.enabled).toBe(true)
    expect(resolved.configViolations.map(v => v.field)).toContain('semanticDiff.enabled')
  })

  it('uses an explicit base ref, even outside CI', async () => {
    const { result, readAtRef } = resolve(defaultConfig, { baseRef: 'upstream/release' })
    const resolved = await result
    expect(resolved.mode).toBe('base')
    expect(resolved.baseRef).toBe('upstream/release')
    expect(readAtRef).toHaveBeenCalledWith('upstream/release')
  })

  it('treats a base with no config file as the defaults', async () => {
    const head = defineConfig({ threshold: 50 })
    const resolved = await resolve(head, { env: { CI: 'true' }, baseConfig: null }).result
    expect(resolved.config).toEqual(defaultConfig)
    expect(resolved.configViolations.map(v => v.field)).toEqual(['threshold'])
  })

  it('reports the head branch repointing protectedBranch', async () => {
    const head = defineConfig({ protectedBranch: 'my-feature' })
    const resolved = await resolve(head, { env: { CI: 'true' }, baseRef: 'origin/main' }).result
    expect(resolved.configViolations.map(v => v.field)).toContain('protectedBranch')
  })

  it('ignores an empty CI variable', async () => {
    expect((await resolve(defaultConfig, { env: { CI: '' } }).result).mode).toBe('head')
  })
})
