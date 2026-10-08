import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffoldProject } from './init.js'

const template = join(dirname(fileURLToPath(import.meta.url)), '../../templates/gitlab-ci.yml')

describe('GitLab CI template', () => {
  it('checks the merge-request base with a full clone', () => {
    const yaml = readFileSync(template, 'utf-8')
    expect(yaml).toContain('GIT_DEPTH: "0"')
    expect(yaml).toContain('npx vibecheck check')
    expect(yaml).toContain('--threshold')
    expect(yaml).toContain('--base')
    expect(yaml).toContain('CI_MERGE_REQUEST_TARGET_BRANCH_NAME')
    expect(yaml).toContain('.vibecheck')
  })
})

describe('scaffoldProject GitLab CI', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vibecheck-gitlab-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('copies the template when .gitlab-ci.yml already exists', async () => {
    writeFileSync(join(tmpDir, '.gitlab-ci.yml'), 'stages: [test]\n')
    const result = await scaffoldProject(tmpDir)
    expect(result.gitlabCiCreated).toBe(true)
    const copied = readFileSync(join(tmpDir, '.gitlab', 'vibecheck.yml'), 'utf-8')
    expect(copied).toContain('npx vibecheck check')
    expect(copied).toBe(readFileSync(template, 'utf-8'))
  })

  it('leaves a project alone when it has no .gitlab-ci.yml', async () => {
    const result = await scaffoldProject(tmpDir)
    expect(result.gitlabCiCreated).toBe(false)
  })

  it('does not overwrite .gitlab/vibecheck.yml', async () => {
    writeFileSync(join(tmpDir, '.gitlab-ci.yml'), 'stages: [test]\n')
    mkdirSync(join(tmpDir, '.gitlab'))
    writeFileSync(join(tmpDir, '.gitlab', 'vibecheck.yml'), 'existing')
    const result = await scaffoldProject(tmpDir)
    expect(readFileSync(join(tmpDir, '.gitlab', 'vibecheck.yml'), 'utf-8')).toBe('existing')
    expect(result.gitlabCiCreated).toBe(false)
  })
})
