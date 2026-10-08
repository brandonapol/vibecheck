import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export type HookInstall = {
  path: string
  action: 'created' | 'appended' | 'unchanged' | 'skipped'
}

export type ClaudeHookInstall = {
  action: 'installed' | 'snippet' | 'unchanged' | 'skipped'
}

export type InitResult = {
  configCreated: boolean
  hiddenDirCreated: boolean
  ciCreated: boolean
  /** True when `.gitlab/vibecheck.yml` was copied. `.gitlab-ci.yml` is never rewritten. */
  gitlabCiCreated: boolean
  claudeSnippet: string
  hook: HookInstall
  commitMsgHook: HookInstall
  claudeHook: ClaudeHookInstall
}

const INLINE_CLAUDE_SETTINGS = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "sh .claude/hooks/vibecheck-protected.sh"
          }
        ]
      }
    ]
  }
}
`

const HOOK_LINE = 'npx --no-install vibecheck check --hook'
const COMMIT_MSG_LINE = 'npx --no-install vibecheck commit-msg --file "$1"'

const CONFIG_TEMPLATE = `import { defineConfig } from 'vibecheck-tdd'

export default defineConfig({
  threshold: 80,
  mutation: {
    enabled: true,
    tool: 'stryker',
    threshold: 80,
    perFileThreshold: 60,
  },
  semanticDiff: {
    enabled: true,
    enforcement: 'block',
  },
  reporters: ['console'],
})
`

function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url)
  return resolve(dirname(thisFile), '..', '..', 'templates')
}

export async function scaffoldProject(cwd: string): Promise<InitResult> {
  const result: InitResult = {
    configCreated: false,
    hiddenDirCreated: false,
    ciCreated: false,
    gitlabCiCreated: false,
    claudeSnippet: '',
    hook: { path: '.git/hooks/pre-commit', action: 'skipped' },
    commitMsgHook: { path: '.git/hooks/commit-msg', action: 'skipped' },
    claudeHook: { action: 'skipped' },
  }

  const configPath = join(cwd, 'vibecheck.config.ts')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, CONFIG_TEMPLATE)
    result.configCreated = true
  }

  const hiddenDir = join(cwd, '.vibecheck-hidden')
  if (!existsSync(hiddenDir)) {
    mkdirSync(hiddenDir, { recursive: true })
    writeFileSync(join(hiddenDir, '.gitkeep'), '')
    result.hiddenDirCreated = true
  }

  ensureGitignore(cwd)

  const workflowDir = join(cwd, '.github', 'workflows')
  const workflowPath = join(workflowDir, 'vibecheck.yml')
  if (existsSync(workflowDir) && !existsSync(workflowPath)) {
    const templatesDir = getTemplatesDir()
    const templatePath = join(templatesDir, 'github-actions.yml')
    if (existsSync(templatePath)) {
      copyFileSync(templatePath, workflowPath)
    } else {
      writeFileSync(workflowPath, getInlineWorkflowTemplate())
    }
    result.ciCreated = true
  }

  const templatesDir = getTemplatesDir()
  const claudePath = join(templatesDir, 'CLAUDE.md')
  result.claudeSnippet = existsSync(claudePath)
    ? readFileSync(claudePath, 'utf-8')
    : getInlineClaudeSnippet()
  result.gitlabCiCreated = installGitlabCi(cwd)
  result.hook = installHook(cwd)
  result.commitMsgHook = installCommitMsgHook(cwd)
  result.claudeHook = installClaudeHook(cwd)

  return result
}

/** When `.claude/` exists, install the PreToolUse hook. Never rewrite a settings file that is already there. */
export function installClaudeHook(cwd: string): ClaudeHookInstall {
  const claude = join(cwd, '.claude')
  if (!existsSync(claude)) return { action: 'skipped' }

  const hooksDir = join(claude, 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const script = join(hooksDir, 'vibecheck-protected.sh')
  const templatesDir = getTemplatesDir()
  if (!existsSync(script)) {
    const template = join(templatesDir, 'claude-protected.sh')
    if (existsSync(template)) copyFileSync(template, script)
    else writeFileSync(script, '#!/bin/sh\nexit 0\n')
    chmodSync(script, 0o755)
  }

  const settings = join(claude, 'settings.json')
  if (!existsSync(settings)) {
    const template = join(templatesDir, 'claude-settings.json')
    if (existsSync(template)) copyFileSync(template, settings)
    else writeFileSync(settings, INLINE_CLAUDE_SETTINGS)
    return { action: 'installed' }
  }
  const text = readFileSync(settings, 'utf-8')
  if (text.includes('vibecheck-protected.sh')) return { action: 'unchanged' }
  return { action: 'snippet' }
}

function packageHasHusky(cwd: string): boolean {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return 'husky' in { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return false
  }
}

function writeHook(file: string, display: string, line: string, marker: string): HookInstall {
  if (!existsSync(file)) {
    writeFileSync(file, `#!/bin/sh\n${line}\n`)
    chmodSync(file, 0o755)
    return { path: display, action: 'created' }
  }
  const text = readFileSync(file, 'utf-8')
  if (text.includes(marker)) return { path: display, action: 'unchanged' }
  writeFileSync(file, text.endsWith('\n') ? `${text}${line}\n` : `${text}\n${line}\n`)
  return { path: display, action: 'appended' }
}

function installNamedHook(cwd: string, name: string, line: string, marker: string): HookInstall {
  if (existsSync(join(cwd, '.husky')) || packageHasHusky(cwd)) {
    const dir = join(cwd, '.husky')
    mkdirSync(dir, { recursive: true })
    return writeHook(join(dir, name), `.husky/${name}`, line, marker)
  }
  if (!existsSync(join(cwd, '.git'))) {
    return { path: `.git/hooks/${name}`, action: 'skipped' }
  }
  const dir = join(cwd, '.git', 'hooks')
  mkdirSync(dir, { recursive: true })
  return writeHook(join(dir, name), `.git/hooks/${name}`, line, marker)
}

/** Husky when the project uses it; otherwise `.git/hooks`. Never replaces an existing hook. */
export function installHook(cwd: string): HookInstall {
  return installNamedHook(cwd, 'pre-commit', HOOK_LINE, 'vibecheck check --hook')
}

/** Installed beside the pre-commit hook. Tagging stays off until `hooks.commitMsg` is true. */
export function installCommitMsgHook(cwd: string): HookInstall {
  return installNamedHook(cwd, 'commit-msg', COMMIT_MSG_LINE, 'vibecheck commit-msg')
}

function ensureGitignore(cwd: string): void {
  const path = join(cwd, '.gitignore')
  const required = ['.vibecheck-hidden/', '.vibecheck-cache/']
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const present = new Set(existing.split('\n').map(line => line.trim()))
  const missing = required.filter(line => !present.has(line))
  if (missing.length === 0) return
  const body = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`
  writeFileSync(path, `${body}${missing.join('\n')}\n`)
}

/** Copy the include template when this is already a GitLab project. Never edit `.gitlab-ci.yml`. */
export function installGitlabCi(cwd: string): boolean {
  if (!existsSync(join(cwd, '.gitlab-ci.yml'))) return false
  const dest = join(cwd, '.gitlab', 'vibecheck.yml')
  if (existsSync(dest)) return false
  mkdirSync(join(cwd, '.gitlab'), { recursive: true })
  const templatePath = join(getTemplatesDir(), 'gitlab-ci.yml')
  if (existsSync(templatePath)) copyFileSync(templatePath, dest)
  else writeFileSync(dest, getInlineGitlabTemplate())
  return true
}

function getInlineGitlabTemplate(): string {
  return `.vibecheck:
  stage: test
  image: node:20
  variables:
    GIT_DEPTH: "0"
    VIBECHECK_THRESHOLD: "80"
  script:
    - npx vibecheck check --threshold "$VIBECHECK_THRESHOLD" --base "origin/\${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"

vibecheck:
  extends: .vibecheck
`
}

function getInlineWorkflowTemplate(): string {
  return `name: Vibecheck Test Integrity

on:
  pull_request:
    branches: [main]

jobs:
  vibecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Load hidden-tests deploy key
        env:
          HIDDEN_KEY: \${{ secrets.hidden-tests-deploy-key }}
        run: |
          if [ -n "$HIDDEN_KEY" ]; then
            install -m 600 /dev/null "$RUNNER_TEMP/vibecheck-hidden-key"
            printf '%s\\n' "$HIDDEN_KEY" > "$RUNNER_TEMP/vibecheck-hidden-key"
            echo "VIBECHECK_HIDDEN_TESTS_KEY=$RUNNER_TEMP/vibecheck-hidden-key" >> "$GITHUB_ENV"
          fi
      - run: npx vibecheck check
`
}

function getInlineClaudeSnippet(): string {
  return `## Test Integrity Protocol

This project uses vibecheck to measure test quality, not just test existence.

Your tests will be evaluated by mutation testing, hidden tests, property-based tests, and semantic analysis.

- Prefer toBe / toEqual / toStrictEqual over toBeDefined / toBeTruthy
- Write property-based tests for pure functions
- Include edge cases: empty inputs, boundary values, error conditions
- Do not weaken existing assertions or add .skip to existing tests
`
}
