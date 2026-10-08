import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '../config/schema.js'
import { runHiddenTests } from './hidden-tests.js'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, access: vi.fn() }
})

import { execa } from 'execa'
import { access, writeFile } from 'node:fs/promises'

const mockExeca = vi.mocked(execa)
const mockAccess = vi.mocked(access)

const passing = JSON.stringify({
  testResults: [{ status: 'passed', assertionResults: [{ status: 'passed', fullName: 'holds' }] }],
})

describe('runHiddenTests', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'vibecheck-hidden-run-'))
    mockAccess.mockResolvedValue(undefined)
    mockExeca.mockReset()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('refuses to run when the local vitest binary is missing', async () => {
    mockAccess.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'directory', path: '.vibecheck-hidden' },
    })
    await expect(runHiddenTests(config, cwd, {})).rejects.toThrow(/vitest/)
    expect(mockExeca).not.toHaveBeenCalled()
  })

  it('runs the project-local vitest and parses its json report', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(cwd, '.vibecheck-hidden'))
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      const output = list[list.indexOf('--outputFile') + 1]
      await writeFile(output, passing)
      return { exitCode: 1, stdout: '', stderr: '' } as never
    })
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'directory', path: '.vibecheck-hidden' },
    })
    const report = await runHiddenTests(config, cwd, { PATH: process.env.PATH })
    expect(report).toMatchObject({ passed: 1, total: 1, passRate: 100 })
    const [bin, args] = mockExeca.mock.calls[0]
    expect(String(bin)).toBe(join(cwd, 'node_modules', '.bin', 'vitest'))
    expect(args).toContain('run')
    expect(args).not.toContain('npx')
    expect(existsSync(join(cwd, '.vibecheck-cache', 'hidden-report.json'))).toBe(false)
  })

  it('throws when the directory is missing', async () => {
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'directory', path: '.vibecheck-hidden' },
    })
    await expect(runHiddenTests(config, cwd, {})).rejects.toThrow(/does not exist/)
  })

  it('throws when vitest writes no report', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(cwd, '.vibecheck-hidden'))
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'config error' } as never)
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'directory', path: '.vibecheck-hidden' },
    })
    await expect(runHiddenTests(config, cwd, {})).rejects.toThrow(/config error/)
  })

  it('clones a repo with the deploy key and deletes the clone', async () => {
    mockExeca.mockImplementation(async (bin, args) => {
      const command = String(bin)
      if (command === 'git') {
        mkdirSync((args as string[]).at(-1)!, { recursive: true })
        return { exitCode: 0, stdout: '', stderr: '' } as never
      }
      const list = args as string[]
      const output = list[list.indexOf('--outputFile') + 1]
      await writeFile(output, passing)
      return { exitCode: 0, stdout: '', stderr: '' } as never
    })
    const config = defineConfig({
      hiddenTests: {
        enabled: true,
        source: 'repo',
        url: 'git@github.com:org/hidden.git',
        branch: 'holdout',
      },
    })
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----'
    await runHiddenTests(config, cwd, { PATH: process.env.PATH, VIBECHECK_HIDDEN_TESTS_KEY: key })

    const clone = mockExeca.mock.calls.find(call => call[0] === 'git')
    expect(clone?.[1]).toEqual([
      'clone', '--depth', '1', '--branch', 'holdout', 'git@github.com:org/hidden.git',
      join(cwd, '.vibecheck-cache', 'hidden-tests'),
    ])
    const ssh = (clone?.[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env?.GIT_SSH_COMMAND ?? ''
    expect(ssh).toContain('IdentitiesOnly=yes')
    expect(ssh).toContain(join(cwd, '.vibecheck-cache', 'deploy-key'))
    expect(ssh).not.toContain('secret')
    expect(existsSync(join(cwd, '.vibecheck-cache', 'hidden-tests'))).toBe(false)
    expect(existsSync(join(cwd, '.vibecheck-cache', 'deploy-key'))).toBe(false)
  })

  it('uses a key path without copying the file', async () => {
    mockExeca.mockImplementation(async (bin, args) => {
      if (String(bin) === 'git') {
        mkdirSync((args as string[]).at(-1)!, { recursive: true })
        return { exitCode: 0, stdout: '', stderr: '' } as never
      }
      const list = args as string[]
      await writeFile(list[list.indexOf('--outputFile') + 1], passing)
      return { exitCode: 0, stdout: '', stderr: '' } as never
    })
    const config = defineConfig({
      hiddenTests: { enabled: true, source: 'repo', url: 'git@github.com:org/hidden.git' },
    })
    await runHiddenTests(config, cwd, { VIBECHECK_HIDDEN_TESTS_KEY: '/keys/id_ed25519' })
    const clone = mockExeca.mock.calls.find(call => call[0] === 'git')
    const ssh = (clone?.[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env?.GIT_SSH_COMMAND ?? ''
    expect(ssh).toContain(`-i '/keys/id_ed25519'`)
  })
})
