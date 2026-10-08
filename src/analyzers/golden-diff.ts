import { posix } from 'node:path'
import type { WeakeningViolation } from './semantic-diff.js'

const IMAGE = /\.(png|gif|jpe?g|webp)$/i

/** One test, reduced to what a golden pin depends on. */
export type GoldenSide = {
  id: string
  /** Assertion fingerprints, sorted so reordering is not a change. */
  assertionKeys: string[]
  bodyKey: string
  /** Repo-relative paths this test pins. Resolve them with `resolveRelatedFile` first. */
  relatedFiles: string[]
}

/** `matchesGoldenFile` paths are relative to the test file, like Flutter's default comparator. */
export function resolveRelatedFile(testFile: string, raw: string): string {
  const rel = raw.replace(/\\/g, '/').trim()
  const file = testFile.replace(/\\/g, '/')
  if (rel.startsWith('/')) return posix.normalize(rel.slice(1))
  return posix.normalize(posix.join(posix.dirname(file), rel))
}

/** Non-test Dart under `lib/`. A widget change lives here, not in the test. */
export function librarySourcesChanged(changedFiles: readonly string[]): boolean {
  return changedFiles.some(file => {
    const norm = file.replace(/\\/g, '/')
    return norm.startsWith('lib/') && norm.endsWith('.dart') && !norm.endsWith('_test.dart')
  })
}

/**
 * Test files that did not themselves change, but may pin an image that did.
 * Callers pass the worktree files that mention `matchesGoldenFile`.
 */
export function extraGoldenTestFiles(changedFiles: readonly string[], grepHits: readonly string[]): string[] {
  if (!changedFiles.some(file => IMAGE.test(file))) return []
  const changed = new Set(changedFiles)
  return grepHits.filter(file => file.endsWith('_test.dart') && !changed.has(file))
}

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameContract(before: GoldenSide, after: GoldenSide): boolean {
  return before.bodyKey === after.bodyKey && sameKeys(before.assertionKeys, after.assertionKeys)
}

/**
 * A golden image is an expected value stored outside the test. Updating it in
 * the same diff as the widget it covers, or pointing an existing test at a
 * different file, pins whatever the new code renders.
 *
 * A golden that shows up only on a new test is not reported: that is a new
 * pin, not a rewritten one.
 */
export function detectGoldenUpdates(input: {
  file: string
  before: GoldenSide[]
  after: GoldenSide[]
  changedFiles: readonly string[]
}): WeakeningViolation[] {
  const changed = new Set(input.changedFiles)
  const libChanged = librarySourcesChanged(input.changedFiles)
  const afterById = new Map(input.after.map(test => [test.id, test]))
  const violations: WeakeningViolation[] = []

  for (const before of input.before) {
    const after = afterById.get(before.id)
    if (!after) continue

    const updated = before.relatedFiles.filter(path => after.relatedFiles.includes(path) && changed.has(path))
    const removed = before.relatedFiles.filter(path => !after.relatedFiles.includes(path))
    const added = after.relatedFiles.filter(path => !before.relatedFiles.includes(path))

    // Assertions and inputs held still, or the widget under lib/ moved with the image.
    if (updated.length > 0 && (sameContract(before, after) || libChanged)) {
      violations.push({
        file: input.file,
        pattern: 'golden-updated',
        detail: `Test "${before.id}": golden ${updated.join(', ')} changed in this diff while the test still pins it`,
      })
    }

    if (removed.length > 0 && added.length > 0) {
      violations.push({
        file: input.file,
        pattern: 'golden-updated',
        detail: `Test "${before.id}": golden path changed from ${removed.join(', ')} to ${added.join(', ')}`,
      })
    }
  }

  return violations
}
