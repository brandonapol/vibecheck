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

describe('detectWeakeningInDiff — multiset strength comparison', () => {
  it('does not flag pure reordering of assertions', () => {
    const before = `
      it('checks parts', () => {
        expect(result.tags).toContain('a');
        expect(result.body).toEqual({ id: 1 });
      });
    `
    const after = `
      it('checks parts', () => {
        expect(result.body).toEqual({ id: 1 });
        expect(result.tags).toContain('a');
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'reorder.test.ts')
    expect(violations).toHaveLength(0)
  })

  it('does not flag inserting a weaker assertion before an existing strong one', () => {
    const before = `
      it('returns data', () => {
        expect(getData()).toEqual({ id: 1 });
      });
    `
    const after = `
      it('returns data', () => {
        expect(getData()).toBeDefined();
        expect(getData()).toEqual({ id: 1 });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'insert.test.ts')
    expect(violations).toHaveLength(0)
  })

  it('flags removing a strong assertion even when padded with weak ones', () => {
    const before = `
      it('processes payment', () => {
        expect(processPayment(100)).toEqual({ status: 'success' });
        expect(processPayment(-1)).toEqual({ status: 'error' });
      });
    `
    const after = `
      it('processes payment', () => {
        expect(processPayment(100)).toEqual({ status: 'success' });
        expect(processPayment(0)).toBeDefined();
        expect(processPayment(null)).toBeDefined();
        expect(processPayment(-1)).toBeDefined();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'pad.test.ts')
    expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
  })

  it('treats custom matchers as neutral — custom-to-custom is not weakening', () => {
    const before = `
      it('custom', () => { expect(a).toBeWithinRange(1, 10) });
    `
    const after = `
      it('custom', () => { expect(a).toBeInRangeOf(1, 10) });
    `
    const violations = detectWeakeningInDiff(before, after, 'custom.test.ts')
    expect(violations.filter(v => v.pattern === 'precision-reduction')).toHaveLength(0)
  })

  it('flags replacing a strong matcher with an unknown custom matcher', () => {
    const before = `
      it('precise', () => { expect(a).toStrictEqual({ id: 1 }) });
    `
    const after = `
      it('precise', () => { expect(a).toLookRoughlyRight() });
    `
    const violations = detectWeakeningInDiff(before, after, 'custom-weak.test.ts')
    expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
  })
})

describe('detectWeakeningInDiff — describe-block awareness', () => {
  it('does not flag moving an unchanged test to a different describe block', () => {
    const before = `
      describe('auth', () => {
        it('validates token', () => {
          expect(validateToken('abc')).toEqual({ valid: true });
        });
      });
    `
    const after = `
      describe('sessions', () => {
        it('validates token', () => {
          expect(validateToken('abc')).toEqual({ valid: true });
        });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'move.test.ts')
    expect(violations).toHaveLength(0)
  })

  it('flags weakening a test that moved between describe blocks', () => {
    const before = `
      describe('auth', () => {
        it('validates token', () => {
          expect(validateToken('abc')).toEqual({ valid: true });
        });
      });
    `
    const after = `
      describe('sessions', () => {
        it('validates token', () => {
          expect(validateToken('abc')).toBeDefined();
        });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'move-weak.test.ts')
    expect(violations.some(v => v.pattern === 'precision-reduction')).toBe(true)
    expect(violations.some(v => v.pattern === 'test-deletion')).toBe(false)
  })

  it('flags wrapping a test in describe.skip as skip-addition', () => {
    const before = `
      it('validates input', () => {
        expect(validate('')).toBe(false);
      });
    `
    const after = `
      describe.skip('legacy', () => {
        it('validates input', () => {
          expect(validate('')).toBe(false);
        });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'wrap-skip.test.ts')
    expect(violations.some(v => v.pattern === 'skip-addition')).toBe(true)
  })

  it('distinguishes same-named tests in different describe blocks', () => {
    const before = `
      describe('auth', () => {
        it('validates', () => { expect(a).toEqual({ ok: true }) });
      });
      describe('payments', () => {
        it('validates', () => { expect(b).toEqual({ ok: true }) });
      });
    `
    const after = `
      describe('auth', () => {
        it('validates', () => { expect(a).toEqual({ ok: true }) });
      });
      describe('payments', () => {
        it('validates', () => { expect(b).toBeDefined() });
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'collide.test.ts')
    const reductions = violations.filter(v => v.pattern === 'precision-reduction')
    expect(reductions).toHaveLength(1)
    expect(reductions[0].detail).toContain('payments')
  })
})

describe('detectWeakeningInDiff — suspicious assertions', () => {
  it('flags dynamic matcher calls as suspicious-assertion', () => {
    const before = `
      it('validates data', () => {
        expect(getData()).toEqual({ id: 1 });
      });
    `
    const after = `
      it('validates data', () => {
        const method = 'toBeDefined';
        expect(getData())[method]();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'dynamic.test.ts')
    expect(violations.some(v => v.pattern === 'suspicious-assertion')).toBe(true)
  })

  it('counts suspicious calls toward the assertion count', () => {
    const before = `
      it('validates data', () => {
        expect(getData()).toEqual({ id: 1 });
      });
    `
    const after = `
      it('validates data', () => {
        const method = 'toBeDefined';
        expect(getData())[method]();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'dynamic.test.ts')
    expect(violations.filter(v => v.pattern === 'assertion-count-reduction')).toHaveLength(0)
  })

  it('flags suspicious assertions in brand new tests', () => {
    const before = ''
    const after = `
      it('new dodgy test', () => {
        expect(result)[pick()]();
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'new-dynamic.test.ts')
    expect(violations.some(v => v.pattern === 'suspicious-assertion')).toBe(true)
  })
})

describe('detectWeakeningInDiff — conditional skips', () => {
  it('flags adding it.skipIf as skip-addition (fail closed)', () => {
    const before = `
      it('runs everywhere', () => {
        expect(run()).toBe(true);
      });
    `
    const after = `
      it.skipIf(process.env.CI)('runs everywhere', () => {
        expect(run()).toBe(true);
      });
    `
    const violations = detectWeakeningInDiff(before, after, 'skipif.test.ts')
    expect(violations.some(v => v.pattern === 'skip-addition')).toBe(true)
  })
})

describe('detectWeakeningInDiff — parameterized replacement', () => {
  it('flags replacing specific tests with a weak it.each as weak-new-test', () => {
    const before = `
      it('validates 1', () => { expect(validate(1)).toBe(true) })
      it('validates 2', () => { expect(validate(2)).toBe(true) })
      it('validates 3', () => { expect(validate(3)).toBe(true) })
    `
    const after = `
      it.each([1, 2, 3])('validates %i', (n) => { expect(validate(n)).toBeDefined() })
    `
    const violations = detectWeakeningInDiff(before, after, 'each-weak.test.ts')
    expect(violations.filter(v => v.pattern === 'test-deletion')).toHaveLength(3)
    expect(violations.some(v => v.pattern === 'weak-new-test')).toBe(true)
  })
})

describe('detectWeakeningInDiff — assertion-changed', () => {
  it('flags a changed expected value and shows before and after', () => {
    const before = `it('taxes', () => { expect(tax(100)).toBe(8.25) })`
    const after = `it('taxes', () => { expect(tax(100)).toBe(8) })`
    const violations = detectWeakeningInDiff(before, after, 'tax.test.ts')
    const changed = violations.filter(v => v.pattern === 'assertion-changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].detail).toContain('expect(tax(100)).toBe(8.25)')
    expect(changed[0].detail).toContain('expect(tax(100)).toBe(8)')
  })

  it('does not flag reformatting', () => {
    const before = `it('t', () => { expect(sum([1, 2])).toEqual({ total: 3 }) })`
    const after = `
      it('t', () => {
        expect(
          sum([1,2,]),
        ).toEqual({ "total": 3, });
      })
    `
    expect(detectWeakeningInDiff(before, after, 'fmt.test.ts')).toHaveLength(0)
  })

  it('does not flag adding a new assertion', () => {
    const before = `it('t', () => { expect(f()).toBe(1) })`
    const after = `it('t', () => { expect(f()).toBe(1); expect(g()).toEqual([2]) })`
    expect(detectWeakeningInDiff(before, after, 'add.test.ts')).toHaveLength(0)
  })

  it('does not flag replacing an already-weak assertion', () => {
    const before = `it('t', () => { expect(f()).toBeDefined() })`
    const after = `it('t', () => { expect(f()).toBe(42) })`
    expect(detectWeakeningInDiff(before, after, 'weak.test.ts')).toHaveLength(0)
  })

  it('flags a strong assertion rewritten into a different strong form', () => {
    const before = `it('t', () => { expect(list).toHaveLength(3) })`
    const after = `it('t', () => { expect(list.length > 0).toBe(true) })`
    const violations = detectWeakeningInDiff(before, after, 'rewrite.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-changed')).toBe(true)
  })

  it('reports a removed strong assertion as changed to nothing', () => {
    const before = `it('t', () => { expect(a).toBe(1); expect(b).toBe(2) })`
    const after = `it('t', () => { expect(a).toBe(1) })`
    const changed = detectWeakeningInDiff(before, after, 'rm.test.ts').filter(
      v => v.pattern === 'assertion-changed',
    )
    expect(changed).toHaveLength(1)
    expect(changed[0].detail).toContain('expect(b).toBe(2)')
    expect(changed[0].detail).toContain('removed')
  })

  it('does not apply to brand-new tests', () => {
    const before = ``
    const after = `it('t', () => { expect(f()).toBe(1) })`
    const violations = detectWeakeningInDiff(before, after, 'new.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-changed')).toBe(false)
  })
})

describe('detectWeakeningInDiff — test-body-changed', () => {
  it('flags an input edited outside the assertion', () => {
    const before = `it('parses', () => { const input = '1,234.5'; expect(parse(input)).toBe(1234.5) })`
    const after = `it('parses', () => { const input = '1234.5'; expect(parse(input)).toBe(1234.5) })`
    const violations = detectWeakeningInDiff(before, after, 'parse.test.ts')
    expect(violations.some(v => v.pattern === 'test-body-changed')).toBe(true)
  })

  it('flags an edited it.each table', () => {
    const before = `it.each([[100, 8.25]])('tax %i', (a, b) => { expect(tax(a)).toBe(b) })`
    const after = `it.each([[100, 8]])('tax %i', (a, b) => { expect(tax(a)).toBe(b) })`
    const violations = detectWeakeningInDiff(before, after, 'each.test.ts')
    expect(violations.some(v => v.pattern === 'test-body-changed')).toBe(true)
  })

  it('does not flag a body that only gained assertions', () => {
    const before = `it('t', () => { const x = f(); expect(x).toBe(1) })`
    const after = `it('t', () => { const x = f(); expect(x).toBe(1); expect(x).not.toBeNull() })`
    expect(detectWeakeningInDiff(before, after, 'grow.test.ts')).toHaveLength(0)
  })
})

describe('detectWeakeningInDiff — setup-changed', () => {
  it('flags an edited top-level constant used by tests', () => {
    const before = `
      const EXPECTED = 8.25
      it('t', () => { expect(tax(100)).toBe(EXPECTED) })
    `
    const after = `
      const EXPECTED = 8
      it('t', () => { expect(tax(100)).toBe(EXPECTED) })
    `
    const violations = detectWeakeningInDiff(before, after, 'const.test.ts')
    const changed = violations.filter(v => v.pattern === 'setup-changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].detail).toContain('const EXPECTED = 8.25')
  })

  it('flags an edited beforeEach hook', () => {
    const before = `
      describe('d', () => {
        beforeEach(() => { config.strict = true })
        it('t', () => { expect(run()).toBe(1) })
      })
    `
    const after = `
      describe('d', () => {
        beforeEach(() => { config.strict = false })
        it('t', () => { expect(run()).toBe(1) })
      })
    `
    const violations = detectWeakeningInDiff(before, after, 'hook.test.ts')
    expect(violations.some(v => v.pattern === 'setup-changed')).toBe(true)
  })

  it('does not flag added helpers or changed imports', () => {
    const before = `
      import { a } from './a'
      it('t', () => { expect(a()).toBe(1) })
    `
    const after = `
      import { a, b } from './a'
      const helper = () => b()
      it('t', () => { expect(a()).toBe(1) })
      it('u', () => { expect(helper()).toBe(2) })
    `
    expect(detectWeakeningInDiff(before, after, 'helpers.test.ts')).toHaveLength(0)
  })
})

describe('detectWeakeningInDiff — assertion-neutralized', () => {
  it('flags an existing assertion wrapped in a swallowing try/catch', () => {
    const before = `it('t', () => { expect(f()).toBe(1) })`
    const after = `it('t', () => { try { expect(f()).toBe(1) } catch {} })`
    const neutralized = detectWeakeningInDiff(before, after, 'try.test.ts').filter(
      v => v.pattern === 'assertion-neutralized',
    )
    expect(neutralized).toHaveLength(1)
    expect(neutralized[0].detail).toContain('expect(f()).toBe(1)')
  })

  it('flags an existing assertion moved behind an if guard', () => {
    const before = `it('t', () => { const r = f(); expect(r).toBe(1) })`
    const after = `it('t', () => { const r = f(); if (r !== undefined) expect(r).toBe(1) })`
    const violations = detectWeakeningInDiff(before, after, 'if.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-neutralized')).toBe(true)
  })

  it('does not flag an assertion that was already conditional on base', () => {
    const code = `it('t', () => { for (const c of cases) expect(f(c)).toBe(1) })`
    const before = code
    const after = `it('t', () => { for (const c of cases) expect(f(c)).toBe(1); expect(g()).toBe(2) })`
    const violations = detectWeakeningInDiff(before, after, 'loop.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-neutralized')).toBe(false)
  })

  it('does not flag a try whose catch rethrows', () => {
    const before = `it('t', () => { expect(f()).toBe(1) })`
    const after = `it('t', () => { try { expect(f()).toBe(1) } catch (e) { throw e } })`
    const violations = detectWeakeningInDiff(before, after, 'rethrow.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-neutralized')).toBe(false)
  })

  it('flags a new test whose assertions are all conditional', () => {
    const after = `it('t', () => { const r = f(); if (r) expect(r).toBe(1) })`
    const violations = detectWeakeningInDiff('', after, 'new.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-neutralized')).toBe(true)
  })

  it('does not flag a new test with at least one unconditional assertion', () => {
    const after = `it('t', () => { const r = f(); expect(r).toBeTruthy(); if (r) expect(r.id).toBe(1) })`
    const violations = detectWeakeningInDiff('', after, 'mixed.test.ts')
    expect(violations.some(v => v.pattern === 'assertion-neutralized')).toBe(false)
  })

  it('reports a self-comparison in a new test as tautological', () => {
    const after = `it('t', () => { const r = f(); expect(r).toBe(r) })`
    const violations = detectWeakeningInDiff('', after, 'self.test.ts')
    expect(violations.some(v => v.pattern === 'tautological-assertion')).toBe(true)
  })
})
