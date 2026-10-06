import micromatch from 'micromatch'
import type { Config } from '../config/schema.js'
import type { WeakeningViolation } from './semantic-diff.js'

export type ProtectedTestViolation = {
  file: string
  rule: 'protected-file-weakened' | 'protected-file-deleted' | 'required-reference-removed'
  detail: string
}

export type CheckProtectedTestsOptions = {
  config: Config
  /** Every file the branch changed relative to the base, deletions included. */
  changedFiles: string[]
  /** Unfiltered semantic diff findings: a disabled pattern still counts here. */
  semanticViolations: WeakeningViolation[]
  /** A file's content on the base ref, or null when it doesn't exist there. */
  readBase(file: string): Promise<string | null>
  /** A file's content in the working tree, or null when it was deleted. */
  readHead(file: string): Promise<string | null>
}

export function isProtectedTestFile(file: string, config: Config): boolean {
  const { files } = config.protectedTests
  return files.length > 0 && micromatch.isMatch(file, files)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function references(source: string, identifier: string): boolean {
  return new RegExp(`(?<![\\w$])${escapeRegExp(identifier)}(?![\\w$])`).test(source)
}

/** Tests that enforce a repo-wide rule, and conventions every test of a kind
 *  must keep. Each finding blocks, whatever the score or enforcement level. */
export async function checkProtectedTests({
  config,
  changedFiles,
  semanticViolations,
  readBase,
  readHead,
}: CheckProtectedTestsOptions): Promise<ProtectedTestViolation[]> {
  const { required } = config.protectedTests
  const violations: ProtectedTestViolation[] = []
  const isProtected = (file: string) => isProtectedTestFile(file, config)

  for (const v of semanticViolations) {
    if (isProtected(v.file)) {
      violations.push({ file: v.file, rule: 'protected-file-weakened', detail: `${v.pattern}: ${v.detail}` })
    }
  }

  for (const file of changedFiles) {
    const rules = required.filter(rule => micromatch.isMatch(file, rule.path))
    if (!isProtected(file) && rules.length === 0) continue

    // A file new on this branch has no protection to lose.
    const base = await readBase(file)
    if (base === null) continue
    const head = await readHead(file)

    if (head === null && isProtected(file)) {
      violations.push({ file, rule: 'protected-file-deleted', detail: 'Protected test file was deleted' })
    }
    for (const rule of rules) {
      for (const identifier of rule.references) {
        if (references(base, identifier) && (head === null || !references(head, identifier))) {
          violations.push({
            file,
            rule: 'required-reference-removed',
            detail: `'${identifier}' is no longer referenced`,
          })
        }
      }
    }
  }

  return violations
}
