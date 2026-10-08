import { readFileSync, writeFileSync } from 'node:fs'
import type { Config } from '../config/schema.js'
import { getStagedFiles } from '../core/resolver.js'
import { patternsForConfig } from '../core/test-patterns.js'
import { classifyStaged } from './pre-commit.js'

export type Phase = 'phase1' | 'phase2'

/** Phase 1 is tests without implementation. Phase 2 is the reverse.
 *  A mix, or a commit with neither, is not tagged. */
export function commitPhase(files: string[], testPatterns: string[]): Phase | null {
  const { tests, impl } = classifyStaged(files, testPatterns)
  if (tests.length > 0 && impl.length === 0) return 'phase1'
  if (impl.length > 0 && tests.length === 0) return 'phase2'
  return null
}

export function tagCommitMessage(message: string, phase: Phase | null): string {
  if (!phase) return message
  const tag = `[vibecheck:${phase}]`
  if (message.includes(tag)) return message
  const body = message.replace(/\s*$/, '')
  return `${body}\n\n${tag}\n`
}

export function applyPhaseTag(
  message: string,
  files: string[],
  testPatterns: string[],
  enabled: boolean,
): string {
  if (!enabled) return message
  return tagCommitMessage(message, commitPhase(files, testPatterns))
}

/** Rewrites the commit message file when `hooks.commitMsg` is on. A no-op otherwise. */
export async function runCommitMsgHook(
  config: Config,
  messageFile: string,
  readStaged: () => Promise<string[]> = getStagedFiles,
): Promise<void> {
  const message = readFileSync(messageFile, 'utf-8')
  const next = applyPhaseTag(message, await readStaged(), patternsForConfig(config), config.hooks.commitMsg)
  if (next !== message) writeFileSync(messageFile, next)
}
