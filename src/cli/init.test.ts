import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scaffoldProject, type InitResult } from './init.js'

describe('scaffoldProject', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vibecheck-init-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates vibecheck.config.ts', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(existsSync(join(tmpDir, 'vibecheck.config.ts'))).toBe(true)
    expect(result.configCreated).toBe(true)
  })

  it('config file contains defineConfig import', async () => {
    await scaffoldProject(tmpDir)
    const content = readFileSync(join(tmpDir, 'vibecheck.config.ts'), 'utf-8')
    expect(content).toContain('defineConfig')
    expect(content).toContain('vibecheck-tdd')
  })

  it('does not overwrite existing config', async () => {
    writeFileSync(join(tmpDir, 'vibecheck.config.ts'), 'existing config')
    const result = await scaffoldProject(tmpDir)
    const content = readFileSync(join(tmpDir, 'vibecheck.config.ts'), 'utf-8')
    expect(content).toBe('existing config')
    expect(result.configCreated).toBe(false)
  })

  it('creates hidden test directory', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(existsSync(join(tmpDir, '.vibecheck-hidden'))).toBe(true)
    expect(result.hiddenDirCreated).toBe(true)
  })

  it('does not recreate hidden dir if it exists', async () => {
    mkdirSync(join(tmpDir, '.vibecheck-hidden'))
    const result = await scaffoldProject(tmpDir)
    expect(result.hiddenDirCreated).toBe(false)
  })

  it('copies GitHub Actions workflow when .github/workflows exists', async () => {
    mkdirSync(join(tmpDir, '.github', 'workflows'), { recursive: true })
    const result = await scaffoldProject(tmpDir)
    expect(existsSync(join(tmpDir, '.github', 'workflows', 'vibecheck.yml'))).toBe(true)
    expect(result.ciCreated).toBe(true)
  })

  it('skips CI when .github/workflows does not exist', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(result.ciCreated).toBe(false)
  })

  it('does not overwrite existing CI workflow', async () => {
    mkdirSync(join(tmpDir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(tmpDir, '.github', 'workflows', 'vibecheck.yml'), 'existing')
    const result = await scaffoldProject(tmpDir)
    const content = readFileSync(join(tmpDir, '.github', 'workflows', 'vibecheck.yml'), 'utf-8')
    expect(content).toBe('existing')
    expect(result.ciCreated).toBe(false)
  })

  it('returns CLAUDE.md snippet in result', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(result.claudeSnippet).toContain('Test Integrity Protocol')
    expect(result.claudeSnippet).toContain('Mutation testing')
  })
})
