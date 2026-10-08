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
  claudeSnippet: string
  hook: HookInstall
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
    claudeSnippet: '',
    hook: { path: '.git/hooks/pre-commit', action: 'skipped' },
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
  result.hook = installHook(cwd)
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

function writeHook(file: string, display: string): HookInstall {
  if (!existsSync(file)) {
    writeFileSync(file, `#!/bin/sh\n${HOOK_LINE}\n`)
    chmodSync(file, 0o755)
    return { path: display, action: 'created' }
  }
  const text = readFileSync(file, 'utf-8')
  if (text.includes('vibecheck check --hook')) return { path: display, action: 'unchanged' }
  writeFileSync(file, text.endsWith('\n') ? `${text}${HOOK_LINE}\n` : `${text}\n${HOOK_LINE}\n`)
  return { path: display, action: 'appended' }
}

/** Husky when the project uses it; otherwise `.git/hooks`. Never replaces an existing hook. */
export function installHook(cwd: string): HookInstall {
  if (existsSync(join(cwd, '.husky')) || packageHasHusky(cwd)) {
    const dir = join(cwd, '.husky')
    mkdirSync(dir, { recursive: true })
    return writeHook(join(dir, 'pre-commit'), '.husky/pre-commit')
  }
  if (!existsSync(join(cwd, '.git'))) {
    return { path: '.git/hooks/pre-commit', action: 'skipped' }
  }
  const dir = join(cwd, '.git', 'hooks')
  mkdirSync(dir, { recursive: true })
  return writeHook(join(dir, 'pre-commit'), '.git/hooks/pre-commit')
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
