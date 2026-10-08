import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
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

  it('gitignores the hidden directory and the clone cache', async () => {
    const result = await scaffoldProject(tmpDir)
    const ignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8')
    expect(ignore).toContain('.vibecheck-hidden/')
    expect(ignore).toContain('.vibecheck-cache/')
    expect(result.hiddenDirCreated).toBe(true)

    writeFileSync(join(tmpDir, '.gitignore'), `${ignore}other\n`)
    await scaffoldProject(tmpDir)
    const again = readFileSync(join(tmpDir, '.gitignore'), 'utf-8')
    expect(again.match(/\.vibecheck-hidden\//g)).toHaveLength(1)
    expect(again).toContain('other')
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

  it('skips the hook when the directory is not a git repo', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(result.hook).toEqual({ path: '.git/hooks/pre-commit', action: 'skipped' })
  })

  it('installs .git/hooks/pre-commit without replacing an existing hook', async () => {
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true })
    const created = await scaffoldProject(tmpDir)
    const hook = join(tmpDir, '.git', 'hooks', 'pre-commit')
    expect(created.hook.action).toBe('created')
    expect(readFileSync(hook, 'utf-8')).toContain('vibecheck check --hook')
    expect(statSync(hook).mode & 0o111).not.toBe(0)

    writeFileSync(hook, '#!/bin/sh\necho existing\n')
    const appended = await scaffoldProject(tmpDir)
    const text = readFileSync(hook, 'utf-8')
    expect(appended.hook.action).toBe('appended')
    expect(text).toContain('echo existing')
    expect(text).toContain('vibecheck check --hook')

    const again = await scaffoldProject(tmpDir)
    expect(again.hook.action).toBe('unchanged')
  })

  it('appends to a Husky hook instead of writing .git/hooks', async () => {
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true })
    mkdirSync(join(tmpDir, '.husky'))
    writeFileSync(join(tmpDir, '.husky', 'pre-commit'), '#!/bin/sh\nnpx lint-staged\n')
    const result = await scaffoldProject(tmpDir)
    expect(result.hook).toEqual({ path: '.husky/pre-commit', action: 'appended' })
    expect(existsSync(join(tmpDir, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(readFileSync(join(tmpDir, '.husky', 'pre-commit'), 'utf-8')).toContain('npx lint-staged')
  })

  it('skips the Claude hook when .claude/ is absent', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(result.claudeHook).toEqual({ action: 'skipped' })
  })

  it('installs the Claude PreToolUse hook when .claude/ exists and settings do not', async () => {
    mkdirSync(join(tmpDir, '.claude'))
    const result = await scaffoldProject(tmpDir)
    const script = join(tmpDir, '.claude', 'hooks', 'vibecheck-protected.sh')
    expect(result.claudeHook).toEqual({ action: 'installed' })
    expect(readFileSync(script, 'utf-8')).toContain('vibecheck protected --file')
    expect(statSync(script).mode & 0o111).not.toBe(0)
    const settings = readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8')
    expect(settings).toContain('PreToolUse')
    expect(settings).toContain('vibecheck-protected.sh')
  })

  it('does not rewrite Claude settings that already exist', async () => {
    mkdirSync(join(tmpDir, '.claude'))
    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    writeFileSync(settingsPath, '{"hooks":{}}\n')
    const snippet = await scaffoldProject(tmpDir)
    expect(snippet.claudeHook).toEqual({ action: 'snippet' })
    expect(readFileSync(settingsPath, 'utf-8')).toBe('{"hooks":{}}\n')

    writeFileSync(settingsPath, '{"command":"sh .claude/hooks/vibecheck-protected.sh"}\n')
    const again = await scaffoldProject(tmpDir)
    expect(again.claudeHook).toEqual({ action: 'unchanged' })
    expect(readFileSync(settingsPath, 'utf-8')).toContain('vibecheck-protected.sh')
  })
})

