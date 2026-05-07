import { describe, it, expect } from 'vitest'
import {
  ASSERTION_STRENGTH,
  detectWeakeningInDiff,
  type WeakeningViolation,
} from './semantic-diff.js'

describe('ASSERTION_STRENGTH', () => {
  it('ranks toBe higher than toBeDefined', () => {
    expect(ASSERTION_STRENGTH['toBe']).toBeGreaterThan(ASSERTION_STRENGTH['toBeDefined'])
  })

  it('ranks toEqual higher than toBeTruthy', () => {
    expect(ASSERTION_STRENGTH['toEqual']).toBeGreaterThan(ASSERTION_STRENGTH['toBeTruthy'])
  })

  it('ranks toThrowError higher than toThrow', () => {
    expect(ASSERTION_STRENGTH['toThrowError']).toBeGreaterThan(ASSERTION_STRENGTH['toThrow'])
  })

  it('includes numeric comparison matchers', () => {
    expect(ASSERTION_STRENGTH['toBeGreaterThan']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toBeGreaterThanOrEqual']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toBeLessThan']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toBeLessThanOrEqual']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toBeCloseTo']).toBeGreaterThan(0)
  })

  it('includes mock/spy matchers', () => {
    expect(ASSERTION_STRENGTH['toHaveBeenCalled']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toHaveBeenCalledWith']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toHaveBeenCalledTimes']).toBeGreaterThan(0)
  })

  it('includes type/instance matchers', () => {
    expect(ASSERTION_STRENGTH['toBeInstanceOf']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toBeNaN']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toHaveProperty']).toBeGreaterThan(0)
  })

  it('includes string/regex matchers', () => {
    expect(ASSERTION_STRENGTH['toMatch']).toBeGreaterThan(0)
  })

  it('includes snapshot matchers at low strength', () => {
    expect(ASSERTION_STRENGTH['toMatchSnapshot']).toBeGreaterThan(0)
    expect(ASSERTION_STRENGTH['toMatchInlineSnapshot']).toBeGreaterThan(0)
  })

  it('ranks toBeGreaterThan higher than toBeDefined', () => {
    expect(ASSERTION_STRENGTH['toBeGreaterThan']).toBeGreaterThan(ASSERTION_STRENGTH['toBeDefined'])
  })

  it('ranks toHaveBeenCalledWith higher than toHaveBeenCalled', () => {
    expect(ASSERTION_STRENGTH['toHaveBeenCalledWith']).toBeGreaterThan(ASSERTION_STRENGTH['toHaveBeenCalled'])
  })
})

describe('detectWeakeningInDiff', () => {
  it('detects precision reduction (toEqual -> toBeDefined)', () => {
    const before = `
      it('returns the user', () => {
        expect(getUser(1)).toEqual({ id: 1, name: 'Alice' });
      });
    `
    const after = `
      it('returns the user', () => {
        expect(getUser(1)).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'user.test.ts')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].pattern).toBe('precision-reduction')
  })

  it('detects value-to-existence downgrade (toBe -> toBeTruthy)', () => {
    const before = `
      it('calculates total', () => {
        expect(calculate(10)).toBe(100);
      });
    `
    const after = `
      it('calculates total', () => {
        expect(calculate(10)).toBeTruthy();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'calc.test.ts')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].pattern).toBe('precision-reduction')
  })

  it('does not flag when assertion stays the same', () => {
    const code = `
      it('returns true', () => {
        expect(isValid()).toBe(true);
      });
    `
    const violations = detectWeakeningInDiff(code, code, 'valid.test.ts')
    expect(violations).toHaveLength(0)
  })

  it('does not flag when assertion gets stronger', () => {
    const before = `
      it('has items', () => {
        expect(result).toBeDefined();
      });
    `
    const after = `
      it('has items', () => {
        expect(result).toEqual({ items: [1, 2, 3] });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'items.test.ts')
    expect(violations).toHaveLength(0)
  })

  it('detects test deletion', () => {
    const before = `
      it('handles edge case', () => {
        expect(process(null)).toBe(0);
      });
      it('handles normal case', () => {
        expect(process(5)).toBe(10);
      });
    `
    const after = `
      it('handles normal case', () => {
        expect(process(5)).toBe(10);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'process.test.ts')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some(v => v.pattern === 'test-deletion')).toBe(true)
  })

  it('detects skip addition', () => {
    const before = `
      it('validates input', () => {
        expect(validate('')).toBe(false);
      });
    `
    const after = `
      it.skip('validates input', () => {
        expect(validate('')).toBe(false);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'validate.test.ts')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].pattern).toBe('skip-addition')
  })

  it('detects assertion count reduction', () => {
    const before = `
      it('returns correct shape', () => {
        expect(result.id).toBe(1);
        expect(result.name).toBe('Alice');
        expect(result.email).toBe('alice@test.com');
      });
    `
    const after = `
      it('returns correct shape', () => {
        expect(result.id).toBe(1);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'shape.test.ts')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].pattern).toBe('assertion-count-reduction')
  })

  it('does not flag assertion count reduction when new assertions added', () => {
    const before = `
      it('checks value', () => {
        expect(result).toBe(5);
      });
    `
    const after = `
      it('checks value', () => {
        expect(result).toBe(5);
        expect(result).toBeGreaterThan(0);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'value.test.ts')
    expect(violations.filter(v => v.pattern === 'assertion-count-reduction')).toHaveLength(0)
  })

  it('returns file name in violations', () => {
    const before = `
      it('test', () => {
        expect(x).toBe(1);
      });
    `
    const after = `
      it('test', () => {
        expect(x).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'my-file.test.ts')
    expect(violations[0].file).toBe('my-file.test.ts')
  })

  it('detects weakening of toBeGreaterThan to toBeDefined', () => {
    const before = `
      it('checks range', () => {
        expect(getCount()).toBeGreaterThan(5);
      });
    `
    const after = `
      it('checks range', () => {
        expect(getCount()).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'range.test.ts')
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].pattern).toBe('precision-reduction')
  })

  it('ignores assertions inside comments', () => {
    const before = `
      it('validates', () => {
        expect(isValid('test@example.com')).toBe(true);
        expect(isValid('bad')).toBe(false);
      });
    `
    const after = `
      it('validates', () => {
        // expect(isValid('test@example.com')).toBe(true);
        // expect(isValid('bad')).toBe(false);
        expect(true).toBe(true);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'valid.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-count-reduction')).toBe(true)
  })

  it('ignores assertions inside block comments', () => {
    const before = `
      it('validates', () => {
        expect(x).toBe(1);
        expect(y).toBe(2);
      });
    `
    const after = `
      it('validates', () => {
        /* expect(x).toBe(1); */
        expect(y).toBe(2);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'block.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-count-reduction')).toBe(true)
  })

  it('detects tautological assertions', () => {
    const before = `
      it('validates email', () => {
        expect(isValid('test@example.com')).toBe(true);
        expect(isValid('bad')).toBe(false);
      });
    `
    const after = `
      it('validates email', () => {
        expect(true).toBe(true);
        expect(false).toBe(false);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'taut.test.ts')
    expect(violations.some(v => v.pattern === 'tautological-assertion')).toBe(true)
  })

  it('does not flag non-tautological assertions as tautological', () => {
    const code = `
      it('calculates', () => {
        expect(calculate(10)).toBe(100);
        expect(calculate(0)).toBe(0);
      });
    `
    const violations = detectWeakeningInDiff(code, code, 'calc.test.ts')
    expect(violations.some(v => v.pattern === 'tautological-assertion')).toBe(false)
  })

  it('handles template literal test names', () => {
    const before = `
      it(\`handles edge case correctly\`, () => {
        expect(handle('edge')).toEqual({ ok: true });
      });
    `
    const after = `
      it(\`handles edge case correctly\`, () => {
        expect(handle('edge')).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'template.test.ts')
    expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
  })

  it('handles template literal test names with ${expressions}', () => {
    const before = `
      it(\`handles \${EDGE_CASE} correctly\`, () => {
        expect(handle(EDGE_CASE)).toEqual({ ok: true });
      });
    `
    const after = `
      it(\`handles \${EDGE_CASE} correctly\`, () => {
        expect(handle(EDGE_CASE)).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'template-expr.test.ts')
    expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
  })

  it('flags new tests that only use weak assertions', () => {
    const before = ''
    const after = `
      it('works', () => {
        expect(doEverything()).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'new.test.ts')
    expect(violations.some(v => v.pattern === 'weak-new-test')).toBe(true)
  })

  it('does not flag new tests with strong assertions', () => {
    const before = ''
    const after = `
      it('validates data', () => {
        expect(getData()).toEqual({ id: 1, name: 'Alice' });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'new.test.ts')
    expect(violations.some(v => v.pattern === 'weak-new-test')).toBe(false)
  })

  it('flags renamed test that weakened assertions', () => {
    const before = `
      it('validates user input strictly', () => {
        expect(validate('bad')).toEqual({ ok: false, error: 'invalid input' });
        expect(validate('good')).toEqual({ ok: true });
      });
    `
    const after = `
      it('checks user input', () => {
        expect(validate('bad')).toBeDefined();
        expect(validate('good')).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'rename.test.ts')
    expect(violations.some(v => v.pattern === 'weak-new-test')).toBe(true)
  })

  it('parses it.each test blocks', () => {
    const before = `
      it('validates 1', () => { expect(validate(1)).toBe(true) })
      it('validates 2', () => { expect(validate(2)).toBe(true) })
    `
    const after = `
      it.each([1, 2])('validates %i', (n) => { expect(validate(n)).toBeDefined() })
    `
    const violations = detectWeakeningInDiff(before, after, 'each.test.ts')
    expect(violations.some(v => v.pattern === 'test-deletion')).toBe(true)
  })
})
