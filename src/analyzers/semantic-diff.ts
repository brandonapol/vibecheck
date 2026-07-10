import { extractTests, type ExtractedTest } from './test-ast.js'

export type WeakeningPattern =
  | 'precision-reduction'
  | 'error-relaxation'
  | 'bound-loosening'
  | 'test-deletion'
  | 'skip-addition'
  | 'assertion-count-reduction'
  | 'tautological-assertion'
  | 'weak-new-test'
  | 'suspicious-assertion'

export type WeakeningViolation = {
  file: string
  pattern: WeakeningPattern
  detail: string
}

export const ASSERTION_STRENGTH: Record<string, number> = {
  toBe: 10,
  toEqual: 9,
  toStrictEqual: 10,
  toMatchObject: 7,
  toHaveLength: 8,
  toContain: 6,
  toContainEqual: 7,
  toBeTruthy: 3,
  toBeFalsy: 3,
  toBeDefined: 2,
  toBeUndefined: 2,
  toBeNull: 3,
  toBeNaN: 3,
  toBeInstanceOf: 6,
  toBeGreaterThan: 7,
  toBeGreaterThanOrEqual: 7,
  toBeLessThan: 7,
  toBeLessThanOrEqual: 7,
  toBeCloseTo: 8,
  toMatch: 6,
  toMatchSnapshot: 4,
  toMatchInlineSnapshot: 5,
  toHaveProperty: 6,
  toHaveBeenCalled: 4,
  toHaveBeenCalledWith: 8,
  toHaveBeenCalledTimes: 7,
  toHaveBeenLastCalledWith: 8,
  toHaveBeenNthCalledWith: 8,
  toHaveReturned: 4,
  toHaveReturnedWith: 8,
  toHaveReturnedTimes: 7,
  toThrow: 4,
  toThrowError: 7,
}

// Custom matchers are neutral: not free (0) so swapping a strong matcher for an
// unknown one still reads as weakening, not flagged when swapped for each other.
const UNKNOWN_MATCHER_STRENGTH = 5
const WEAK_THRESHOLD = 4

function strengthOf(matcher: string): number {
  return ASSERTION_STRENGTH[matcher] ?? UNKNOWN_MATCHER_STRENGTH
}

function sortedStrengths(test: ExtractedTest): number[] {
  return test.assertions.map(a => strengthOf(a.matcher)).sort((a, b) => b - a)
}

function sortedMatchers(test: ExtractedTest): string[] {
  return [...test.assertions]
    .sort((a, b) => strengthOf(b.matcher) - strengthOf(a.matcher))
    .map(a => a.matcher)
}

// Suspicious (dynamic) calls still count as assertions so indirection is not
// additionally reported as a count reduction.
function assertionCount(test: ExtractedTest): number {
  return test.assertions.length + test.suspicious.length
}

type MatchedPair = { before: ExtractedTest; after: ExtractedTest }

/** Two-pass matching: exact id (describe path + name) first, then bare name
 *  among the leftovers so moving a test between describe blocks does not read
 *  as a deletion plus a new test. */
function matchTests(beforeTests: ExtractedTest[], afterTests: ExtractedTest[]): {
  pairs: MatchedPair[]
  deleted: ExtractedTest[]
  added: ExtractedTest[]
} {
  const pairs: MatchedPair[] = []
  const afterById = new Map(afterTests.map(t => [t.id, t]))
  const matchedAfter = new Set<ExtractedTest>()
  const unmatchedBefore: ExtractedTest[] = []

  for (const before of beforeTests) {
    const exact = afterById.get(before.id)
    if (exact && !matchedAfter.has(exact)) {
      pairs.push({ before, after: exact })
      matchedAfter.add(exact)
    } else {
      unmatchedBefore.push(before)
    }
  }

  const deleted: ExtractedTest[] = []
  for (const before of unmatchedBefore) {
    const byName = afterTests.find(t => !matchedAfter.has(t) && t.name === before.name)
    if (byName) {
      pairs.push({ before, after: byName })
      matchedAfter.add(byName)
    } else {
      deleted.push(before)
    }
  }

  const added = afterTests.filter(t => !matchedAfter.has(t))
  return { pairs, deleted, added }
}

function compareMatchedTest(
  { before, after }: MatchedPair,
  file: string,
  violations: WeakeningViolation[],
): void {
  if (!before.skipped && after.skipped) {
    violations.push({
      file,
      pattern: 'skip-addition',
      detail: `Test "${after.id}" was skipped`,
    })
    return
  }

  const beforeCount = assertionCount(before)
  const afterCount = assertionCount(after)
  if (afterCount < beforeCount) {
    violations.push({
      file,
      pattern: 'assertion-count-reduction',
      detail: `Test "${after.id}": assertions reduced from ${beforeCount} to ${afterCount}`,
    })
  }

  // Sorted-multiset comparison: rank-by-rank over descending strengths, so
  // reordering is not weakening and weak padding cannot hide a removed strong
  // assertion.
  const beforeStrengths = sortedStrengths(before)
  const afterStrengths = sortedStrengths(after)
  const beforeMatchers = sortedMatchers(before)
  const afterMatchers = sortedMatchers(after)

  for (let rank = 0; rank < Math.min(beforeStrengths.length, afterStrengths.length); rank++) {
    if (afterStrengths[rank] < beforeStrengths[rank]) {
      violations.push({
        file,
        pattern: 'precision-reduction',
        detail: `Test "${after.id}": .${beforeMatchers[rank]}() weakened to .${afterMatchers[rank]}()`,
      })
    }
  }
}

function reportSuspicious(test: ExtractedTest, file: string, violations: WeakeningViolation[]): void {
  for (const reason of test.suspicious) {
    violations.push({
      file,
      pattern: 'suspicious-assertion',
      detail: `Test "${test.id}": ${reason}`,
    })
  }
}

function reportTautologies(test: ExtractedTest, file: string, violations: WeakeningViolation[]): void {
  const count = test.assertions.filter(a => a.tautological).length
  if (count > 0) {
    violations.push({
      file,
      pattern: 'tautological-assertion',
      detail: `Test "${test.id}": ${count} tautological assertion(s) (e.g. expect(true).toBe(true))`,
    })
  }
}

export function detectWeakeningInDiff(
  before: string,
  after: string,
  file: string,
): WeakeningViolation[] {
  const violations: WeakeningViolation[] = []
  const { pairs, deleted, added } = matchTests(extractTests(before), extractTests(after))

  for (const test of deleted) {
    violations.push({
      file,
      pattern: 'test-deletion',
      detail: `Test "${test.id}" was deleted`,
    })
  }

  for (const pair of pairs) {
    compareMatchedTest(pair, file, violations)
    reportSuspicious(pair.after, file, violations)
    reportTautologies(pair.after, file, violations)
  }

  for (const test of added) {
    reportSuspicious(test, file, violations)
    reportTautologies(test, file, violations)

    if (test.assertions.length === 0) continue
    const maxStrength = Math.max(...test.assertions.map(a => strengthOf(a.matcher)))
    if (maxStrength <= WEAK_THRESHOLD) {
      violations.push({
        file,
        pattern: 'weak-new-test',
        detail: `Test "${test.id}": new test uses only weak assertions (max strength ${maxStrength})`,
      })
    }
  }

  return violations
}
