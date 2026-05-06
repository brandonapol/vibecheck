import { describe, it, expect } from 'vitest'
import { detectWeakeningInDiff } from '../../src/analyzers/semantic-diff.js'

/**
 * ADVERSARIAL TESTS: Attempts to evade the semantic diff analyzer.
 * Each test documents an attack vector. Tests that PASS represent loopholes.
 * Tests that FAIL mean the analyzer caught the evasion (good).
 */

describe('Semantic Diff Evasion Attacks', () => {

  // =========================================================================
  // ATTACK 1: Rename test to evade deletion detection
  // Strategy: Instead of deleting a test, rename it. The analyzer matches
  // by test name, so a renamed test looks like: old test deleted + new test added.
  // But the analyzer only flags deletions, not "is the new test equivalent?"
  // =========================================================================
  describe('ATTACK: Test rename to evade deletion', () => {
    it('LOOPHOLE: renaming a test with weaker assertions goes undetected', () => {
      const before = `
        it('validates user input strictly', () => {
          expect(validate('bad')).toEqual({ ok: false, error: 'invalid input' })
          expect(validate('good')).toEqual({ ok: true })
        })
      `
      const after = `
        it('checks user input', () => {
          expect(validate('bad')).toBeDefined()
          expect(validate('good')).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // The old test is "deleted" (flagged) but the new weak test is not examined
      // because it's a "new" test. The agent traded a strong test for a weak one
      // and only got a deletion warning — the weakness itself is invisible.
      const hasWeakeningViolation = violations.some(v => v.pattern === 'precision-reduction')
      expect(hasWeakeningViolation).toBe(false) // LOOPHOLE: no precision-reduction flagged
    })
  })

  // =========================================================================
  // ATTACK 2: Replace test body without changing name
  // Strategy: Keep the test name identical but completely rewrite the body
  // with trivial assertions. Only positional comparison is done.
  // =========================================================================
  describe('ATTACK: Gut test body while keeping name', () => {
    it('CAUGHT: replacing strong assertions with weak ones at same positions', () => {
      const before = `
        it('calculates tax correctly', () => {
          expect(calculateTax(100, 0.2)).toBe(20)
          expect(calculateTax(0, 0.2)).toBe(0)
          expect(calculateTax(100, 0)).toBe(0)
        })
      `
      const after = `
        it('calculates tax correctly', () => {
          expect(calculateTax(100, 0.2)).toBeDefined()
          expect(calculateTax(0, 0.2)).toBeDefined()
          expect(calculateTax(100, 0)).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.length).toBeGreaterThan(0) // Good: caught
      expect(violations[0].pattern).toBe('precision-reduction')
    })
  })

  // =========================================================================
  // ATTACK 3: Add padding assertions to hide removal
  // Strategy: Remove a strong assertion but add weak ones so the count
  // doesn't decrease. The positional check only compares up to min length.
  // =========================================================================
  describe('ATTACK: Pad with weak assertions to hide removal', () => {
    it('LOOPHOLE: removing strong assertion but adding weak ones to maintain count', () => {
      const before = `
        it('processes payment', () => {
          expect(processPayment(100)).toEqual({ status: 'success', amount: 100 })
          expect(processPayment(-1)).toEqual({ status: 'error', code: 'INVALID_AMOUNT' })
        })
      `
      // Remove the second strong assertion, replace with two weak ones
      const after = `
        it('processes payment', () => {
          expect(processPayment(100)).toEqual({ status: 'success', amount: 100 })
          expect(processPayment(-1)).toBeDefined()
          expect(processPayment(0)).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // Position 0 is fine (toEqual -> toEqual). Position 1 is toEqual -> toBeDefined (caught).
      // But if the agent reorders assertions cleverly...
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      expect(hasPrecisionReduction).toBe(true) // Caught in this case
    })

    it('LOOPHOLE: reordering to put weak assertions at the END evades positional check', () => {
      const before = `
        it('processes payment', () => {
          expect(processPayment(100)).toEqual({ status: 'success', amount: 100 })
          expect(processPayment(-1)).toEqual({ status: 'error', code: 'INVALID_AMOUNT' })
        })
      `
      // Keep first assertion, add weak ones AFTER, effectively replacing the second
      // strong assertion with padding. Count goes up, positions 0 matches.
      const after = `
        it('processes payment', () => {
          expect(processPayment(100)).toEqual({ status: 'success', amount: 100 })
          expect(processPayment(0)).toBeDefined()
          expect(processPayment(null)).toBeDefined()
          expect(processPayment(-1)).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // Position 0: toEqual -> toEqual (fine)
      // Position 1: toEqual -> toBeDefined (CAUGHT)
      // But count went UP (2 -> 4), so no assertion-count-reduction
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      expect(hasPrecisionReduction).toBe(true) // Still caught at position 1
    })
  })

  // =========================================================================
  // ATTACK 4: Use untracked assertion methods
  // Strategy: Use assertion methods not in the ASSERTION_STRENGTH map.
  // They default to strength 0, so replacing them is "no change."
  // =========================================================================
  describe('ATTACK: Use untracked assertion methods', () => {
    it('FIXED: toBeGreaterThan now has a strength score — weakening is caught', () => {
      const before = `
        it('counts items', () => {
          expect(getCount()).toBeGreaterThan(5)
        })
      `
      const after = `
        it('counts items', () => {
          expect(getCount()).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      expect(hasPrecisionReduction).toBe(true) // FIXED: now caught
    })

    it('FIXED: toBeGreaterThanOrEqual, toBeLessThan, toBeCloseTo are all tracked', () => {
      const before = `
        it('validates range', () => {
          expect(getTemp()).toBeGreaterThanOrEqual(0)
          expect(getTemp()).toBeLessThan(100)
          expect(getPI()).toBeCloseTo(3.14159, 5)
        })
      `
      const after = `
        it('validates range', () => {
          expect(getTemp()).toBeDefined()
          expect(getTemp()).toBeDefined()
          expect(getPI()).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.length).toBe(3) // FIXED: all three weakenings caught
    })
  })

  // =========================================================================
  // ATTACK 5: Comment out assertions instead of using .skip
  // Strategy: The analyzer detects .skip but not commented-out code.
  // =========================================================================
  describe('ATTACK: Comment out instead of .skip', () => {
    it('FIXED: commenting out expect() calls now detected via comment stripping', () => {
      const before = `
        it('validates email', () => {
          expect(isValid('test@example.com')).toBe(true)
          expect(isValid('bad')).toBe(false)
        })
      `
      const after = `
        it('validates email', () => {
          // expect(isValid('test@example.com')).toBe(true)
          // expect(isValid('bad')).toBe(false)
          expect(true).toBe(true)
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // FIXED: comments are now stripped before extraction. After block has
      // only 1 real assertion (the tautology), down from 2.
      const hasCountReduction = violations.some(v => v.pattern === 'assertion-count-reduction')
      expect(hasCountReduction).toBe(true) // FIXED: comment stripping catches this
    })

    it('FIXED: replacing real assertions with tautologies is now detected', () => {
      const before = `
        it('validates email', () => {
          expect(isValid('test@example.com')).toBe(true)
          expect(isValid('bad')).toBe(false)
        })
      `
      const after = `
        it('validates email', () => {
          // real assertions commented out, replaced with tautologies
          expect(true).toBe(true)
          expect(false).toBe(false)
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // FIXED: tautology detection catches expect(true).toBe(true) patterns
      const hasTautology = violations.some(v => v.pattern === 'tautological-assertion')
      expect(hasTautology).toBe(true) // FIXED
    })
  })

  // =========================================================================
  // ATTACK 6: Use template literals to confuse the regex parser
  // Strategy: The test name regex uses (['"`])(.*?)\3 — template literals
  // with expressions might confuse it.
  // =========================================================================
  describe('ATTACK: Template literal test names', () => {
    it('LOOPHOLE: template literal with expression in name breaks matching', () => {
      const before = `
        it(\`handles \${EDGE_CASE} correctly\`, () => {
          expect(handle(EDGE_CASE)).toEqual({ ok: true })
        })
      `
      const after = `
        it(\`handles \${EDGE_CASE} correctly\`, () => {
          expect(handle(EDGE_CASE)).toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // The regex (.*?) with backtick delimiter should still match...
      // but ${} in the name might cause issues with the non-greedy match
      // Let's see if it catches it
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      // LOOPHOLE: Template literals with ${expressions} break the test name regex.
      // The regex (['"`])(.*?)\3 uses non-greedy match with backtick delimiter,
      // but ${} is not handled — the match fails entirely, so neither the before
      // nor after version is parsed as a test block. Invisible to the analyzer.
      expect(hasPrecisionReduction).toBe(false) // LOOPHOLE: template literal names not parsed
    })
  })

  // =========================================================================
  // ATTACK 7: Nest tests inside describe blocks to change context
  // Strategy: The analyzer doesn't track describe() nesting. Moving a test
  // into a different describe block with the same name looks identical.
  // =========================================================================
  describe('ATTACK: Move test between describe blocks', () => {
    it('LOOPHOLE: moving a test to a different describe block is invisible', () => {
      const before = `
        describe('auth', () => {
          it('validates token', () => {
            expect(validateToken('abc')).toEqual({ valid: true, user: 'bob' })
          })
        })
        describe('payments', () => {
          it('processes charge', () => {
            expect(charge(100)).toEqual({ ok: true, id: '123' })
          })
        })
      `
      const after = `
        describe('payments', () => {
          it('validates token', () => {
            expect(validateToken('abc')).toBeDefined()
          })
          it('processes charge', () => {
            expect(charge(100)).toEqual({ ok: true, id: '123' })
          })
        })
      `
      // "validates token" still exists by name, but its assertions weakened.
      // The analyzer doesn't care about describe() context — it matches by name.
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      expect(hasPrecisionReduction).toBe(true) // Actually caught — name matching works
    })
  })

  // =========================================================================
  // ATTACK 8: Write weak tests from the start (no "before" to compare)
  // Strategy: If there's no prior version, semantic diff has nothing to flag.
  // The agent writes weak tests on the first commit — no weakening occurred.
  // =========================================================================
  describe('ATTACK: Write weak tests from scratch', () => {
    it('LOOPHOLE: brand new weak tests have no baseline to detect weakening', () => {
      const before = '' // new file, no prior version
      const after = `
        it('works', () => {
          expect(doEverything()).toBeDefined()
        })
        it('handles errors', () => {
          expect(doEverything()).toBeTruthy()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.length).toBe(0) // LOOPHOLE: no baseline = no detection
    })
  })

  // =========================================================================
  // ATTACK 9: Use .each() or test.concurrent which the regex may not parse
  // =========================================================================
  describe('ATTACK: Use it.each to evade parsing', () => {
    it('LOOPHOLE: it.each is not matched by the test regex', () => {
      const before = `
        it('validates 1', () => { expect(validate(1)).toBe(true) })
        it('validates 2', () => { expect(validate(2)).toBe(true) })
        it('validates 3', () => { expect(validate(3)).toBe(true) })
      `
      // Replace three specific tests with one it.each that uses weak assertions
      const after = `
        it.each([1, 2, 3])('validates %i', (n) => { expect(validate(n)).toBeDefined() })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // Three tests "deleted" — but the each is not parsed as a test
      const deletions = violations.filter(v => v.pattern === 'test-deletion')
      expect(deletions.length).toBe(3) // Deletions flagged...
      // ...but the replacement weak test via .each is invisible
      const parsed = violations.some(v => v.pattern === 'precision-reduction')
      expect(parsed).toBe(false) // LOOPHOLE: .each tests are not parsed
    })
  })

  // =========================================================================
  // ATTACK 10: Use string concatenation to break assertion regex
  // =========================================================================
  describe('ATTACK: Break assertion regex with indirection', () => {
    it('LOOPHOLE: calling assertion method via variable evades regex', () => {
      const before = `
        it('validates data', () => {
          expect(getData()).toEqual({ id: 1, name: 'test' })
        })
      `
      const after = `
        it('validates data', () => {
          const result = getData()
          const method = 'toBeDefined'
          expect(result)[method]()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      // The regex looks for .toBe, .toEqual etc. — dynamic method calls are invisible
      // Before: 1 assertion (toEqual). After: 0 assertions detected.
      const hasCountReduction = violations.some(v => v.pattern === 'assertion-count-reduction')
      expect(hasCountReduction).toBe(true) // Count reduction caught, but...
      // The actual weakening method is invisible
    })
  })
})
