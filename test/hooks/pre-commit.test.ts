import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, cpSync, chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOOK_PATH = join(__dirname, '../../hooks/pre-commit')

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-tdd-hook-test-'))
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })

  mkdirSync(join(dir, '.git/hooks'), { recursive: true })
  cpSync(HOOK_PATH, join(dir, '.git/hooks/pre-commit'))
  chmodSync(join(dir, '.git/hooks/pre-commit'), 0o755)

  writeFileSync(join(dir, '.gitkeep'), '')
  execSync('git add .gitkeep && git commit -m "init"', { cwd: dir })

  return dir
}

function git(dir: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: dir, encoding: 'utf-8' })
}

function writeAndStage(dir: string, filename: string, content = '// placeholder') {
  const filepath = join(dir, filename)
  mkdirSync(join(filepath, '..'), { recursive: true })
  writeFileSync(filepath, content)
  git(dir, `add ${filename}`)
}

describe('pre-commit hook', () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = setupRepo()
  })

  afterEach(() => {
    execSync(`rm -rf ${repoDir}`)
  })

  it('allows a commit with only test files', () => {
    writeAndStage(repoDir, 'src/foo.test.ts')
    expect(() => git(repoDir, 'commit -m "test: add tests"')).not.toThrow()
  })

  it('allows a commit with only implementation files', () => {
    writeAndStage(repoDir, 'src/foo.ts')
    expect(() => git(repoDir, 'commit -m "feat: add foo"')).not.toThrow()
  })

  it('blocks a commit with both test and implementation files', () => {
    writeAndStage(repoDir, 'src/foo.ts')
    writeAndStage(repoDir, 'src/foo.test.ts')
    expect(() => git(repoDir, 'commit -m "bad: mixed commit"')).toThrow(
      /Two-phase commit violation/
    )
  })

  it('blocks .spec.ts files mixed with implementation', () => {
    writeAndStage(repoDir, 'src/bar.ts')
    writeAndStage(repoDir, 'src/bar.spec.ts')
    expect(() => git(repoDir, 'commit -m "bad: mixed commit"')).toThrow(
      /Two-phase commit violation/
    )
  })

  it('allows non-ts files alongside anything', () => {
    writeAndStage(repoDir, 'src/foo.test.ts')
    writeAndStage(repoDir, 'README.md', '# hello')
    expect(() => git(repoDir, 'commit -m "test: with docs"')).not.toThrow()
  })

  it('allows config files alongside test files', () => {
    writeAndStage(repoDir, 'src/foo.test.ts')
    writeAndStage(repoDir, 'tsup.config.ts')
    expect(() => git(repoDir, 'commit -m "test: with config"')).not.toThrow()
  })

  it('allows empty commits (no staged files)', () => {
    expect(() => git(repoDir, 'commit --allow-empty -m "chore: empty"')).not.toThrow()
  })

  it('lists the offending files in the error message', () => {
    writeAndStage(repoDir, 'src/core/resolver.ts')
    writeAndStage(repoDir, 'src/core/resolver.test.ts')
    try {
      git(repoDir, 'commit -m "bad: mixed"')
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.stderr || e.message).toContain('src/core/resolver.ts')
      expect(e.stderr || e.message).toContain('src/core/resolver.test.ts')
    }
  })
})
