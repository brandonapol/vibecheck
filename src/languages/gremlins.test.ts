import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../config/schema.js'
import { parseGremlinsReport, runGremlinsMutation } from './gremlins.js'
import type { MutationRunOptions } from './types.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

import { execa } from 'execa'
import { readFile, writeFile } from 'node:fs/promises'

const mockExeca = vi.mocked(execa)

function options(overrides: Partial<MutationRunOptions> = {}): MutationRunOptions {
  return {
    include: ['**/*.go'],
    exclude: [],
    protectedBranch: 'main',
    mutation: defaultConfig.mutation,
    ...overrides,
  }
}

function mutant(status: string, line: number) {
  return { line, column: 1, type: 'ARITHMETIC_BASE', status }
}

function many(status: string, count: number, line: number) {
  return Array.from({ length: count }, (_, i) => mutant(status, line + i))
}

describe('parseGremlinsReport', () => {
  it('counts uncovered mutants against the score, not gremlins efficacy', () => {
    const report = parseGremlinsReport({
      files: [{
        file_name: 'add.go',
        mutations: [...many('KILLED', 8, 1), ...many('LIVED', 2, 20), ...many('NOT COVERED', 10, 40)],
      }],
    })
    // 8 / (8 + 2 + 10) = 40. Efficacy would have been 8 / (8 + 2) = 80.
    expect(report.overallScore).toBe(40)
    expect(report.killed).toBe(8)
    expect(report.total).toBe(20)
    expect(report.survivingMutants).toHaveLength(12)
    expect(report.survivingMutants[0]).toMatchObject({
      file: 'add.go',
      mutator: 'ARITHMETIC_BASE',
      replacement: 'LIVED',
    })
  })

  it('counts TIMED OUT as killed and does not list it as a survivor', () => {
    const report = parseGremlinsReport({
      files: [{ file_name: 'add.go', mutations: [mutant('TIMED OUT', 4), mutant('LIVED', 5)] }],
    })
    expect(report.overallScore).toBe(50)
    expect(report.killed).toBe(1)
    expect(report.survivingMutants.map(m => m.location.line)).toEqual([5])
  })

  it('ignores NOT VIABLE and SKIPPED mutants', () => {
    const report = parseGremlinsReport({
      files: [{
        file_name: 'add.go',
        mutations: [mutant('KILLED', 1), mutant('NOT VIABLE', 2), mutant('SKIPPED', 3)],
      }],
    })
    expect(report.overallScore).toBe(100)
    expect(report.killed).toBe(1)
    expect(report.total).toBe(1)
    expect(report.survivingMutants).toEqual([])
  })

  it('accepts underscored status spellings', () => {
    const report = parseGremlinsReport({
      files: [{ file_name: 'add.go', mutations: [mutant('NOT_COVERED', 3)] }],
    })
    expect(report.overallScore).toBe(0)
    expect(report.total).toBe(1)
    expect(report.survivingMutants[0].replacement).toBe('NOT_COVERED')
  })

  it('refuses to score a report whose mutants were all skipped or not viable', () => {
    expect(() => parseGremlinsReport({
      files: [{ file_name: 'add.go', mutations: [mutant('SKIPPED', 1), mutant('NOT VIABLE', 2)] }],
    })).toThrow(/no tested mutants/)
  })

  it('refuses to score a dry-run RUNNABLE mutant', () => {
    expect(() => parseGremlinsReport({
      files: [{ file_name: 'add.go', mutations: [mutant('RUNNABLE', 1)] }],
    })).toThrow(/RUNNABLE/)
  })

  it('refuses to score an unknown status', () => {
    expect(() => parseGremlinsReport({
      files: [{ file_name: 'add.go', mutations: [mutant('PENDING', 1)] }],
    })).toThrow(/PENDING/)
  })

  it('scores an empty files array as nothing to mutate', () => {
    const report = parseGremlinsReport({ files: [] })
    expect(report).toMatchObject({ overallScore: 100, fileScores: {}, survivingMutants: [], killed: 0, total: 0 })
  })

  it('throws when the report has no files array', () => {
    expect(() => parseGremlinsReport({ mutants_killed: 1 })).toThrow(/unparsable/)
  })
})

describe('runGremlinsMutation', () => {
  let binDir: string
  let cwd: string

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'vibecheck-gremlins-bin-'))
    cwd = mkdtempSync(join(tmpdir(), 'vibecheck-gremlins-cwd-'))
    writeFileSync(join(binDir, 'gremlins'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(binDir, 'gremlins'), 0o755)
    mockExeca.mockReset()
  })

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { PATH: binDir, ...extra }
  }

  async function answer(json: unknown) {
    let configPath = ''
    let config = ''
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      configPath = list[list.indexOf('--config') + 1]
      config = await readFile(configPath, 'utf8')
      const output = list[list.indexOf('--output') + 1]
      await writeFile(output, JSON.stringify(json))
      return { exitCode: 0 } as never
    })
    return {
      configPath: () => configPath,
      config: () => config,
    }
  }

  it('throws when gremlins is not on PATH and does not run unleash', async () => {
    await expect(runGremlinsMutation(options(), cwd, { PATH: cwd })).rejects.toThrow(
      /gremlins is not installed[\s\S]*go install github.com\/go-gremlins\/gremlins\/cmd\/gremlins@v0\.6\.0/,
    )
    expect(mockExeca).not.toHaveBeenCalled()
  })

  it('runs unleash with a generated config and no gremlins threshold flag', async () => {
    writeFileSync(join(cwd, '.gremlins.yaml'), 'unleash:\n  threshold:\n    efficacy: 99\n  exclude-files:\n    - ".*"\n')
    const captured = await answer({ files: [{ file_name: 'add.go', mutations: [mutant('KILLED', 1)] }] })
    const report = await runGremlinsMutation(options(), cwd, env({ GREMLINS_UNLEASH_THRESHOLD_EFFICACY: '99', HOME: '/tmp' }))

    expect(report.overallScore).toBe(100)
    expect(mockExeca).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = mockExeca.mock.calls[0]
    const list = args as string[]
    expect(bin).toBe(join(binDir, 'gremlins'))
    expect(list[0]).toBe('unleash')
    expect(list[1]).toBe('.')
    expect(list).toContain('--config')
    expect(list).toContain('--output')
    expect(list.some(arg => String(arg).includes('threshold'))).toBe(false)
    expect(list).not.toContain('--diff')
    expect(captured.configPath()).not.toBe(join(cwd, '.gremlins.yaml'))
    expect(captured.config()).toContain('efficacy: 0')
    expect(captured.config()).toContain('mutant-coverage: 0')
    expect(captured.config()).not.toContain('exclude')
    expect(captured.config()).not.toContain('99')
    const passed = opts as { env?: NodeJS.ProcessEnv; extendEnv?: boolean }
    expect(passed.extendEnv).toBe(false)
    expect(passed.env?.GREMLINS_UNLEASH_THRESHOLD_EFFICACY).toBeUndefined()
    expect(passed.env?.HOME).toBe('/tmp')
    expect(report.diffScoped).toBeUndefined()
    expect(existsSync(captured.configPath())).toBe(false)
  })

  it('passes --diff origin/$GITHUB_BASE_REF in CI and marks the report', async () => {
    await answer({ files: [] })
    const report = await runGremlinsMutation(options(), cwd, env({ CI: 'true', GITHUB_BASE_REF: 'feature' }))
    const args = mockExeca.mock.calls[0][1] as string[]
    expect(args[args.indexOf('--diff') + 1]).toBe('origin/feature')
    expect(report.diffScoped).toBe(true)
  })

  it('falls back to origin/<protectedBranch> when CI has no base ref', async () => {
    await answer({ files: [] })
    await runGremlinsMutation(options({ protectedBranch: 'trunk' }), cwd, env({ CI: 'true' }))
    const args = mockExeca.mock.calls[0][1] as string[]
    expect(args[args.indexOf('--diff') + 1]).toBe('origin/trunk')
  })

  it('drops excluded files and Go tests before scoring', async () => {
    await answer({
      files: [
        { file_name: 'keep.go', mutations: [mutant('KILLED', 1)] },
        { file_name: 'skip.go', mutations: [mutant('LIVED', 2)] },
        { file_name: 'pkg/keep_test.go', mutations: [mutant('LIVED', 3)] },
      ],
    })
    const report = await runGremlinsMutation(options({ exclude: ['skip.go'] }), cwd, env())
    expect(report.overallScore).toBe(100)
    expect(report.fileScores).toEqual({ 'keep.go': 100 })
    expect(report.survivingMutants).toEqual([])
  })

  it('runs unleash once per package when include has no globs', async () => {
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      const pkg = list[1]
      const output = list[list.indexOf('--output') + 1]
      const file = pkg === 'pkg/add' ? 'pkg/add/add.go' : 'pkg/weak/weak.go'
      const status = pkg === 'pkg/add' ? 'KILLED' : 'LIVED'
      await writeFile(output, JSON.stringify({ files: [{ file_name: file, mutations: [mutant(status, 1)] }] }))
      return { exitCode: 0 } as never
    })
    const report = await runGremlinsMutation(options({ include: ['pkg/add', 'pkg/weak'] }), cwd, env())
    const paths = mockExeca.mock.calls.map(call => (call[1] as string[])[1])
    expect(paths).toEqual(['pkg/add', 'pkg/weak'])
    expect(report.overallScore).toBe(50)
    expect(report.killed).toBe(1)
    expect(report.total).toBe(2)
  })

  it('runs the whole module once when any include is a glob', async () => {
    await answer({ files: [] })
    await runGremlinsMutation(options({ include: ['pkg/add', '**/*.go'] }), cwd, env())
    expect(mockExeca).toHaveBeenCalledTimes(1)
    expect((mockExeca.mock.calls[0][1] as string[])[1]).toBe('.')
  })

  it('throws when gremlins exits non-zero, even if it wrote a report', async () => {
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      await writeFile(list[list.indexOf('--output') + 1], JSON.stringify({ files: [] }))
      throw Object.assign(new Error('Command failed'), { exitCode: 2, stderr: 'build failed' })
    })
    await expect(runGremlinsMutation(options(), cwd, env())).rejects.toThrow(/build failed/)
  })

  it('throws when the output is not JSON', async () => {
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      await writeFile(list[list.indexOf('--output') + 1], 'not-json')
      return { exitCode: 0 } as never
    })
    await expect(runGremlinsMutation(options(), cwd, env())).rejects.toThrow(/unparsable/)
  })

  it('throws when gremlins writes no report', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0 } as never)
    await expect(runGremlinsMutation(options(), cwd, env())).rejects.toThrow(/no JSON report/)
  })
})
