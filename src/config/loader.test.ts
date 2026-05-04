import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadConfig } from './loader.js'
import { defaultConfig } from './schema.js'
import * as fs from 'node:fs'

vi.mock('node:fs')

describe('loadConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns default config when no config file exists', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const config = await loadConfig()
    expect(config).toEqual(defaultConfig)
  })

  it('accepts a config directory override', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const config = await loadConfig('/some/other/dir')
    expect(config).toEqual(defaultConfig)
  })

  it('merges partial user config with defaults', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const mockConfig = { testPatterns: ['**/*.spec.tsx'] }
    vi.doMock('/fake/agent-tdd.config.ts', () => ({ default: mockConfig }))

    const config = await loadConfig('/fake')
    expect(config.testPatterns).toEqual(['**/*.spec.tsx'])
    expect(config.protectedBranch).toBe('main')
  })

  it('throws on invalid config file contents', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.doMock('/bad/agent-tdd.config.ts', () => ({
      default: { enforcement: { agents: 'yolo' } },
    }))

    await expect(loadConfig('/bad')).rejects.toThrow()
  })
})
