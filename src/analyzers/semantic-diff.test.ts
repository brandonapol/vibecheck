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
})
