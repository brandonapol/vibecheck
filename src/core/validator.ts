import type { Config } from '../config/schema.js'
import { detectAgentTrailers } from './detector.js'
import { matchesPatterns } from './resolver.js'

export type Violation = {
  file: string
  reason: 'protected-test-modified'
  phase: 'implementation'
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: Violation[]; enforcement: 'block' | 'warn'; matchedTrailer: string | null }

export type ValidateOptions = {
  getStagedFiles: () => Promise<string[]>
  getCommitMessage: () => Promise<string>
  getProtectedPaths: (stagedFiles: string[], testPatterns: string[], protectedBranch: string) => Promise<string[]>
}

export async function validate(config: Config, options: ValidateOptions): Promise<ValidationResult> {
  const commitMessage = await options.getCommitMessage()
  const detection = detectAgentTrailers(commitMessage, config.agentTrailers)
  const enforcementLevel = detection.isAgent ? config.enforcement.agents : config.enforcement.humans

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
    matchedTrailer: detection.matchedTrailer,
  }
}
