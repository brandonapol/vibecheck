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
    it('FIXED: renaming a test with weaker assertions is now caught', () => {
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
      // FIXED: weak-new-test detection catches the renamed test with only weak assertions
      const hasWeakNew = violations.some(v => v.pattern === 'weak-new-test')
      expect(hasWeakNew).toBe(true) // FIXED: renamed weak test caught
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
    it('CAUGHT: removing strong assertion but adding weak ones to maintain count', () => {
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

    it('FIXED: multiset comparison catches weak padding regardless of position', () => {
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
      // Sorted strengths: before [9, 9], after [9, 2, 2, 2].
      // Rank 1 dropped from 9 to 2 — no ordering or padding can hide it.
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      expect(hasPrecisionReduction).toBe(true) // FIXED: caught by multiset comparison
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
    it('FIXED: template literal with expression in name now parsed correctly', () => {
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
      const hasPrecisionReduction = violations.some(v => v.pattern === 'precision-reduction')
      // FIXED: brace scanning now starts after the regex match (past the test name),
      // so ${} braces in template literal names don't confuse the body extractor.
      expect(hasPrecisionReduction).toBe(true) // FIXED: template literal names parsed
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
    it('FIXED: brand new weak tests are now flagged via weak-new-test detection', () => {
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
      const hasWeakNew = violations.some(v => v.pattern === 'weak-new-test')
      expect(hasWeakNew).toBe(true) // FIXED: weak-new-test catches low-strength assertions
    })
  })

  // =========================================================================
  // ATTACK 9: Use .each() or test.concurrent which the regex could not parse
  // =========================================================================
  describe('ATTACK: Use it.each to evade parsing', () => {
    it('FIXED: it.each is parsed — weak replacement flagged as weak-new-test', () => {
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
      const deletions = violations.filter(v => v.pattern === 'test-deletion')
      expect(deletions.length).toBe(3) // Deletions flagged...
      // ...and the .each replacement is now parsed and flagged as weak
      const hasWeakNew = violations.some(v => v.pattern === 'weak-new-test')
      expect(hasWeakNew).toBe(true) // FIXED: .each tests are parsed by the AST
    })
  })

  // =========================================================================
  // ATTACK 10: Use indirection to hide the assertion method
  // =========================================================================
  describe('ATTACK: Hide the assertion method behind indirection', () => {
    it('FIXED: dynamic matcher calls fail closed as suspicious-assertion', () => {
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
      // The AST cannot resolve the matcher statically, so the call is treated
      // as suspicious rather than silently invisible.
      const hasSuspicious = violations.some(v => v.pattern === 'suspicious-assertion')
      expect(hasSuspicious).toBe(true) // FIXED: fail closed on dynamics
      // The dynamic call still counts as an assertion, so no spurious
      // count-reduction is reported on top.
      const hasCountReduction = violations.some(v => v.pattern === 'assertion-count-reduction')
      expect(hasCountReduction).toBe(false)
    })
  })

  // =========================================================================
  // ATTACK 11: Convert tests to variants the old regex could not see
  // =========================================================================
  describe('ATTACK: Convert to xit / it.todo to dodge skip detection', () => {
    it('FIXED: converting it to xit is flagged as skip-addition', () => {
      const before = `
        it('validates input', () => { expect(validate('')).toBe(false) })
      `
      const after = `
        xit('validates input', () => { expect(validate('')).toBe(false) })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'skip-addition')).toBe(true)
    })

    it('FIXED: converting it to it.todo is flagged as skip-addition', () => {
      const before = `
        it('validates input', () => { expect(validate('')).toBe(false) })
      `
      const after = `
        it.todo('validates input')
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'skip-addition')).toBe(true)
    })

    it('FIXED: wrapping tests in describe.skip is flagged as skip-addition', () => {
      const before = `
        it('validates input', () => { expect(validate('')).toBe(false) })
      `
      const after = `
        describe.skip('quarantined', () => {
          it('validates input', () => { expect(validate('')).toBe(false) })
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'skip-addition')).toBe(true)
    })

    it('FIXED: adding it.skipIf(condition) is flagged as skip-addition (fail closed)', () => {
      const before = `
        it('validates input', () => { expect(validate('')).toBe(false) })
      `
      const after = `
        it.skipIf(process.env.CI)('validates input', () => { expect(validate('')).toBe(false) })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'skip-addition')).toBe(true)
    })
  })

  // =========================================================================
  // ATTACK 12: Weaken async assertion chains (.resolves / .rejects / .not)
  // =========================================================================
  describe('ATTACK: Weaken through modifier chains', () => {
    it('FIXED: weakening a .resolves chain is caught', () => {
      const before = `
        it('loads user', async () => {
          await expect(loadUser(1)).resolves.toEqual({ id: 1, name: 'Alice' })
        })
      `
      const after = `
        it('loads user', async () => {
          await expect(loadUser(1)).resolves.toBeDefined()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
    })

    it('FIXED: weakening a .rejects error assertion is caught', () => {
      const before = `
        it('rejects bad input', async () => {
          await expect(save(null)).rejects.toThrowError('invalid input')
        })
      `
      const after = `
        it('rejects bad input', async () => {
          await expect(save(null)).rejects.toThrow()
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
    })
  })

  // =========================================================================
  // ATTACK 13: Exploit test-identity collisions across describe blocks
  // =========================================================================
  describe('ATTACK: Same-named tests in different describe blocks', () => {
    it('FIXED: weakening one of two same-named tests is attributed correctly', () => {
      const before = `
        describe('auth', () => {
          it('validates', () => { expect(a).toEqual({ ok: true }) })
        })
        describe('payments', () => {
          it('validates', () => { expect(b).toEqual({ ok: true }) })
        })
      `
      const after = `
        describe('auth', () => {
          it('validates', () => { expect(a).toEqual({ ok: true }) })
        })
        describe('payments', () => {
          it('validates', () => { expect(b).toBeDefined() })
        })
      `
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      const reductions = violations.filter(v => v.pattern === 'precision-reduction')
      expect(reductions).toHaveLength(1)
      expect(reductions[0].detail).toContain('payments')
    })
  })

  // =========================================================================
  // ATTACK 14: Keep the matcher, change what it checks (#73)
  // Strategy: rather than downgrading a matcher, edit its arguments, the
  // expect() input, a .not modifier, an it.each row, or a shared constant
  // until the buggy implementation passes. Strength ranking sees no change.
  // =========================================================================
  describe('ATTACK: Edit assertion arguments instead of matchers', () => {
    const cases: Array<[string, string, string]> = [
      ['expected value changed to match the bug', `expect(tax(100)).toBe(8.25)`, `expect(tax(100)).toBe(8)`],
      ['toBeCloseTo precision loosened', `expect(f()).toBeCloseTo(3.14159, 5)`, `expect(f()).toBeCloseTo(3.14159, 1)`],
      ['numeric bound widened', `expect(ms).toBeLessThan(50)`, `expect(ms).toBeLessThan(5000)`],
      ['.not flip to a trivially true negation', `expect(r).toBe(5)`, `expect(r).not.toBe(0)`],
      ['error message requirement dropped', `expect(() => f()).toThrow('Invalid amount')`, `expect(() => f()).toThrow()`],
      ['regex loosened', `expect(s).toMatch(/^\\d{3}-\\d{4}$/)`, `expect(s).toMatch(/\\d/)`],
      ['input swapped for an easy case', `expect(parse('1,234.5')).toBe(1234.5)`, `expect(parse('1234.5')).toBe(1234.5)`],
    ]

    for (const [name, beforeAssertion, afterAssertion] of cases) {
      it(`FIXED: ${name}`, () => {
        const before = `it('checks', () => { ${beforeAssertion} })`
        const after = `it('checks', () => { ${afterAssertion} })`
        const violations = detectWeakeningInDiff(before, after, 'test.ts')
        expect(violations.some(v => v.pattern === 'assertion-changed')).toBe(true)
      })
    }

    it('FIXED: input edited in a local variable instead of inside expect()', () => {
      const before = `it('parses', () => { const input = '1,234.5'; expect(parse(input)).toBe(1234.5) })`
      const after = `it('parses', () => { const input = '1234.5'; expect(parse(input)).toBe(1234.5) })`
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'test-body-changed')).toBe(true)
    })

    it('FIXED: expected value edited in an it.each table row', () => {
      const before = `it.each([[100, 8.25], [200, 16.5]])('tax %i', (a, b) => { expect(tax(a)).toBe(b) })`
      const after = `it.each([[100, 8], [200, 16.5]])('tax %i', (a, b) => { expect(tax(a)).toBe(b) })`
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'test-body-changed')).toBe(true)
    })

    it('FIXED: expected value edited in a shared top-level constant', () => {
      const before = `const EXPECTED = 8.25\nit('taxes', () => { expect(tax(100)).toBe(EXPECTED) })`
      const after = `const EXPECTED = 8\nit('taxes', () => { expect(tax(100)).toBe(EXPECTED) })`
      const violations = detectWeakeningInDiff(before, after, 'test.ts')
      expect(violations.some(v => v.pattern === 'setup-changed')).toBe(true)
    })
  })
})
