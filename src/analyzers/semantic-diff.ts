import {
  extractSetup,
  extractTests,
  type ExtractedAssertion,
  type ExtractedTest,
  type SetupStatement,
} from './test-ast.js'
import type { LanguageAdapter } from '../languages/types.js'

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
  | 'assertion-changed'
  | 'test-body-changed'
  | 'setup-changed'
  | 'assertion-neutralized'

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

export function typescriptAssertionStrength(matcher: string): number {
  return ASSERTION_STRENGTH[matcher] ?? UNKNOWN_MATCHER_STRENGTH
}

type Strength = (matcher: string) => number

function sortedStrengths(test: ExtractedTest, strengthOf: Strength): number[] {
  return test.assertions.map(a => strengthOf(a.matcher)).sort((a, b) => b - a)
}

function sortedMatchers(test: ExtractedTest, strengthOf: Strength): string[] {
  return [...test.assertions]
    .sort((a, b) => strengthOf(b.matcher) - strengthOf(a.matcher))
    .map(a => a.matcher)
}

// Suspicious (dynamic) calls still count as assertions so indirection is not
// additionally reported as a count reduction.
function assertionCount(test: ExtractedTest): number {
  return test.assertions.length + test.suspicious.length
}

const SNIPPET_LIMIT = 120

function snippet(source: string): string {
  const flat = source.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_LIMIT ? flat.slice(0, SNIPPET_LIMIT - 1) + '…' : flat
}

/** Removes and returns the first entry of `pool` whose key matches. */
function takeByKey<T extends { key: string }>(pool: T[], key: string): T | undefined {
  const index = pool.findIndex(item => item.key === key)
  return index === -1 ? undefined : pool.splice(index, 1)[0]
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
  strengthOf: Strength,
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
  const beforeStrengths = sortedStrengths(before, strengthOf)
  const afterStrengths = sortedStrengths(after, strengthOf)
  const beforeMatchers = sortedMatchers(before, strengthOf)
  const afterMatchers = sortedMatchers(after, strengthOf)

  for (let rank = 0; rank < Math.min(beforeStrengths.length, afterStrengths.length); rank++) {
    if (afterStrengths[rank] < beforeStrengths[rank]) {
      violations.push({
        file,
        pattern: 'precision-reduction',
        detail: `Test "${after.id}": .${beforeMatchers[rank]}() weakened to .${afterMatchers[rank]}()`,
      })
    }
  }

  reportChangedAssertions({ before, after }, file, violations, strengthOf)
  reportNeutralizedAssertions({ before, after }, file, violations)

  if (before.bodyKey !== after.bodyKey) {
    violations.push({
      file,
      pattern: 'test-body-changed',
      detail: `Test "${after.id}": setup or inputs changed outside the assertions`,
    })
  }
}

/** Any existing assertion without an exact structural match after the change
 *  is reported. Exempt: tautologies and argument-less weak matchers
 *  (`toBeDefined()`), which have nothing meaningful to loosen, and rewrites to
 *  a weaker matcher, which precision-reduction already reports. */
function reportChangedAssertions(
  { before, after }: MatchedPair,
  file: string,
  violations: WeakeningViolation[],
  strengthOf: Strength,
): void {
  const unmatchedAfter: ExtractedAssertion[] = [...after.assertions]
  const unmatchedBefore = before.assertions.filter(a => !takeByKey(unmatchedAfter, a.key))

  for (const original of unmatchedBefore) {
    if (original.tautological) continue
    if (!original.hasArguments && strengthOf(original.matcher) <= WEAK_THRESHOLD) continue
    const sameMatcher = unmatchedAfter.findIndex(a => a.matcher === original.matcher)
    const partnerIndex = sameMatcher === -1 ? 0 : sameMatcher
    const partner = unmatchedAfter.splice(partnerIndex, 1)[0]
    if (partner && strengthOf(partner.matcher) < strengthOf(original.matcher)) continue
    violations.push({
      file,
      pattern: 'assertion-changed',
      detail: `Test "${after.id}": ${snippet(original.source)} → ${partner ? snippet(partner.source) : '(removed)'}`,
    })
  }
}

/** An assertion that always ran on base but can now be skipped by a branch,
 *  loop, or swallowing try/catch. */
function reportNeutralizedAssertions(
  { before, after }: MatchedPair,
  file: string,
  violations: WeakeningViolation[],
): void {
  const unconditionalAfter = after.assertions.filter(a => !a.conditional)
  const conditionalAfter = after.assertions.filter(a => a.conditional)

  for (const original of before.assertions) {
    if (original.conditional) continue
    if (takeByKey(unconditionalAfter, original.key)) continue
    if (!takeByKey(conditionalAfter, original.key)) continue
    violations.push({
      file,
      pattern: 'assertion-neutralized',
      detail: `Test "${after.id}": ${snippet(original.source)} now runs only conditionally`,
    })
  }
}

function reportSetupChanges(
  before: SetupStatement[],
  after: SetupStatement[],
  file: string,
  violations: WeakeningViolation[],
): void {
  const remaining = [...after]
  for (const statement of before) {
    if (takeByKey(remaining, statement.key)) continue
    violations.push({
      file,
      pattern: 'setup-changed',
      detail: `Shared setup changed or removed: ${snippet(statement.source)}`,
    })
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

/** What an adapter extracted from one version of a test file. */
export type TestExtraction = {
  tests: ExtractedTest[]
  setup: SetupStatement[]
}

/** TypeScript entry point, kept synchronous for existing callers. */
export function detectWeakeningInDiff(
  before: string,
  after: string,
  file: string,
): WeakeningViolation[] {
  return compareExtractions(
    { tests: extractTests(before), setup: extractSetup(before) },
    { tests: extractTests(after), setup: extractSetup(after) },
    file,
    typescriptAssertionStrength,
  )
}

export async function detectWeakeningWithAdapter(
  before: string,
  after: string,
  file: string,
  adapter: LanguageAdapter,
): Promise<WeakeningViolation[]> {
  const [beforeTests, beforeSetup, afterTests, afterSetup] = await Promise.all([
    adapter.extractTests(before, file),
    adapter.extractSetup(before, file),
    adapter.extractTests(after, file),
    adapter.extractSetup(after, file),
  ])
  return compareExtractions(
    { tests: beforeTests, setup: beforeSetup },
    { tests: afterTests, setup: afterSetup },
    file,
    matcher => adapter.assertionStrength(matcher),
  )
}

export function compareExtractions(
  before: TestExtraction,
  after: TestExtraction,
  file: string,
  strengthOf: Strength,
): WeakeningViolation[] {
  const violations: WeakeningViolation[] = []
  const { pairs, deleted, added } = matchTests(before.tests, after.tests)

  for (const test of deleted) {
    violations.push({
      file,
      pattern: 'test-deletion',
      detail: `Test "${test.id}" was deleted`,
    })
  }

  reportSetupChanges(before.setup, after.setup, file, violations)

  for (const pair of pairs) {
    compareMatchedTest(pair, file, violations, strengthOf)
    reportSuspicious(pair.after, file, violations)
    reportTautologies(pair.after, file, violations)
  }

  for (const test of added) {
    reportSuspicious(test, file, violations)
    reportTautologies(test, file, violations)

    if (test.assertions.length === 0) continue
    if (test.assertions.every(a => a.conditional)) {
      violations.push({
        file,
        pattern: 'assertion-neutralized',
        detail: `Test "${test.id}": every assertion is behind a branch, loop, or swallowing try/catch`,
      })
    }
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
