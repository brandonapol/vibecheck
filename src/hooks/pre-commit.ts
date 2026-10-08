import type { Config } from '../config/schema.js'
import { detectAgent, type AgentIdentity } from '../core/detector.js'
import { getProtectedPaths, getStagedFiles, matchesPatterns } from '../core/resolver.js'
import { isSupplementalTest } from '../core/supplemental-tests.js'
import { patternsForConfig } from '../core/test-patterns.js'
import { validate } from '../core/validator.js'

const CODE_FILE = /\.(ts|tsx|js|jsx)$/
const OTHER_IMPL = /\.(go|dart)$/
const CONFIG_FILE = /(^|\/)(vibecheck\.config\.(ts|js|mjs|cjs)|\.vibecheck\.config\.[^/]+)$/
const NOT_IMPL = new Set(['tsup.config.ts', 'vitest.config.ts'])

export type StagedKinds = {
  tests: string[]
  impl: string[]
  config: string[]
}

/** The shell hook's split, driven by `testPatterns` so Go and Dart tests count. */
export function classifyStaged(files: string[], testPatterns: string[]): StagedKinds {
  const tests: string[] = []
  const impl: string[] = []
  const config: string[] = []
  for (const file of files) {
    if (!file) continue
    if (CONFIG_FILE.test(file)) {
      config.push(file)
      continue
    }
    if (matchesPatterns(file, testPatterns) || isSupplementalTest(file)) {
      tests.push(file)
      continue
    }
    const base = file.split('/').pop() ?? file
    if ((CODE_FILE.test(file) && !NOT_IMPL.has(base)) || OTHER_IMPL.test(file)) impl.push(file)
  }
  return { tests, impl, config }
}

export type HookInput = {
  staged: string[]
  /** Empty during pre-commit: the message does not exist yet. Env still counts. */
  commitMessage: string
  env: Record<string, string | undefined>
  protectedPaths: string[]
}

export type HookResult = {
  exitCode: number
  message: string
}

function identityLine(identity: AgentIdentity, signal: string | null, level: string): string {
  const why = identity === 'agent'
    ? `agent (${signal ?? 'matched signal'})`
    : 'unknown (no agent signal; nothing proves this commit is human)'
  return `vibecheck: enforcement ${level} — ${why}`
}

/**
 * Local guardrail run by `vibecheck check --hook`. Block rejects the commit,
 * warn prints and allows it, off skips. CI is still the enforcement boundary.
 */
export async function runPreCommit(config: Config, input: HookInput): Promise<HookResult> {
  if (!config.hooks.preCommit) return { exitCode: 0, message: '' }

  const { identity, matchedSignal } = detectAgent({
    commitMessage: input.commitMessage,
    trailers: config.agentTrailers,
    env: input.env,
    envVars: config.agentEnvVars,
  })
  const level = identity === 'agent' ? config.enforcement.agents : config.enforcement.unknown
  if (level === 'off') return { exitCode: 0, message: '' }

  const { tests, impl, config: configFiles } = classifyStaged(input.staged, patternsForConfig(config))
  const sections: string[] = []

  if (tests.length > 0 && impl.length > 0) {
    sections.push(
      [
        'vibecheck: Two-phase commit violation',
        '',
        '  A commit must contain EITHER test files OR implementation files, not both.',
        '',
        '  Test files staged:',
        ...tests.map(file => `    ${file}`),
        '',
        '  Implementation files staged:',
        ...impl.map(file => `    ${file}`),
        '',
        '  Split this into two commits:',
        '    1. Commit tests first:          git commit -m "test: ..."',
        '    2. Commit implementation second: git commit -m "feat: ..."',
      ].join('\n'),
    )
  }

  if (configFiles.length > 0 && impl.length > 0) {
    sections.push(
      [
        'vibecheck: Config protection violation',
        '',
        '  vibecheck config files must not be modified in the same commit as',
        '  implementation files. Config changes should be reviewed separately.',
        '',
        '  Config files staged:',
        ...configFiles.map(file => `    ${file}`),
        '',
        '  Implementation files staged:',
        ...impl.map(file => `    ${file}`),
      ].join('\n'),
    )
  }

  const protectedResult = await validate(config, {
    getStagedFiles: async () => input.staged,
    getCommitMessage: async () => input.commitMessage,
    getProtectedPaths: async () => input.protectedPaths,
    env: input.env,
  })
  if (!protectedResult.ok) {
    sections.push(
      [
        'vibecheck: Protected test modified',
        '',
        '  These files exist on the protected branch. Changing them in this',
        '  commit is blocked; review the edit instead of landing it here.',
        '',
        ...protectedResult.violations.map(v => `    ${v.file}`),
      ].join('\n'),
    )
  }

  if (sections.length === 0) return { exitCode: 0, message: '' }

  const header = identityLine(identity, matchedSignal, level)
  const tail = level === 'warn' ? '\n\n(commit allowed: enforcement is warn)' : ''
  return {
    exitCode: level === 'block' ? 1 : 0,
    message: `${header}\n\n${sections.join('\n\n')}${tail}`,
  }
}

/** What `vibecheck check --hook` runs against the real git index. */
export async function runInstalledHook(config: Config, env: Record<string, string | undefined> = process.env): Promise<HookResult> {
  const staged = await getStagedFiles({ noRenames: true })
  const protectedPaths = await getProtectedPaths(staged, patternsForConfig(config), config.protectedBranch)
  return runPreCommit(config, { staged, commitMessage: '', env, protectedPaths })
}
