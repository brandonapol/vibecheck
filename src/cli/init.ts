import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export type InitResult = {
  configCreated: boolean
  hiddenDirCreated: boolean
  ciCreated: boolean
  claudeSnippet: string
}

const CONFIG_TEMPLATE = `import { defineConfig } from 'vibecheck-tdd'

export default defineConfig({
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
  if (existsSync(claudePath)) {
    result.claudeSnippet = readFileSync(claudePath, 'utf-8')
  } else {
    result.claudeSnippet = getInlineClaudeSnippet()
  }

  return result
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
