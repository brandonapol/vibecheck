import type { Config } from '../config/schema.js'
import { detectAgent, detectAgentTrailers, type AgentIdentity } from './detector.js'
import { matchesPatterns } from './resolver.js'

export type Violation = {
  file: string
  reason: 'protected-test-modified'
  phase: 'implementation'
}

export type ValidationResult =
  | { ok: true }
  | {
      ok: false
      violations: Violation[]
      enforcement: 'block' | 'warn'
      identity: AgentIdentity
      matchedSignal: string | null
      matchedTrailer: string | null
    }

export type ValidateOptions = {
  getStagedFiles: () => Promise<string[]>
  getCommitMessage: () => Promise<string>
  getProtectedPaths: (stagedFiles: string[], testPatterns: string[], protectedBranch: string) => Promise<string[]>
  /** Where agent environment variables are read from; defaults to process.env. */
  env?: Record<string, string | undefined>
}

export async function validate(config: Config, options: ValidateOptions): Promise<ValidationResult> {
  // The message must be the one being committed (a commit-msg hook can read
  // it; a pre-commit hook cannot), or detection describes the wrong commit.
  const commitMessage = await options.getCommitMessage()
  const { identity, matchedSignal } = detectAgent({
    commitMessage,
    trailers: config.agentTrailers,
    env: options.env ?? process.env,
    envVars: config.agentEnvVars,
  })
  const enforcementLevel = identity === 'agent' ? config.enforcement.agents : config.enforcement.unknown

  if (enforcementLevel === 'off') return { ok: true }

  const staged = await options.getStagedFiles()
  const protectedFiles = await options.getProtectedPaths(staged, config.testPatterns, config.protectedBranch)

  if (protectedFiles.length === 0) return { ok: true }

  const implFiles = staged.filter(
    f => !matchesPatterns(f, config.testPatterns) && /\.(ts|tsx|js|jsx)$/.test(f),
  )

  if (implFiles.length === 0) return { ok: true }

  const violations: Violation[] = protectedFiles.map(file => ({
    file,
    reason: 'protected-test-modified' as const,
    phase: 'implementation' as const,
  }))

  return {
    ok: false,
    violations,
    enforcement: enforcementLevel,
    identity,
    matchedSignal,
    matchedTrailer: detectAgentTrailers(commitMessage, config.agentTrailers).matchedTrailer,
  }
}
