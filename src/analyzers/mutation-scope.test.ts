import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationConfig } from './mutation.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}))

import { execa } from 'execa'
import { access, readFile } from 'node:fs/promises'
import { runMutationAnalysis } from './mutation.js'
import { typescriptAdapter } from '../languages/typescript.js'
import { defaultConfig } from '../config/schema.js'

const mockExeca = vi.mocked(execa)
const mockReadFile = vi.mocked(readFile)
const mockAccess = vi.mocked(access)

const mutation: MutationConfig = {
  ...defaultConfig.mutation,
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
}

describe('stryker mutate scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccess.mockResolvedValue(undefined)
    mockExeca.mockResolvedValue({} as never)
    mockReadFile.mockResolvedValue(JSON.stringify({ files: {} }))
  })

  it('passes include and exclude to stryker as one mutate list', async () => {
    await runMutationAnalysis(mutation, '/proj')
    expect(mockExeca).toHaveBeenCalledWith(
      '/proj/node_modules/.bin/stryker',
      ['run', '--reporters', 'json', '--mutate', 'src/**/*.ts,!src/**/*.d.ts,!src/**/index.ts'],
      { cwd: '/proj' },
    )
  })

  it('asks stryker to mutate nothing when include is empty', async () => {
    await runMutationAnalysis({ ...mutation, include: [], exclude: [] }, '/proj')
    const args = mockExeca.mock.calls[0][1] as string[]
    expect(args).toContain('--mutate')
    expect(args[args.indexOf('--mutate') + 1]).toBe('!**/*')
  })

  it('uses the language globs when they differ from the top-level mutation config', async () => {
    await typescriptAdapter.runMutation?.({
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/index.ts'],
      protectedBranch: 'main',
      mutation,
    })
    const args = mockExeca.mock.calls[0][1] as string[]
    expect(args[args.indexOf('--mutate') + 1]).toBe('src/core/**/*.ts,!src/core/index.ts')
  })
})
